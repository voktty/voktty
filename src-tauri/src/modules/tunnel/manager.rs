use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use shared_child::SharedChild;
use tauri::{AppHandle, Emitter};

use super::types::{SshTunnelConfig, TunnelStatus, TunnelStatusEvent, TunnelType};

pub struct RunningTunnel {
    pub config: SshTunnelConfig,
    pub child: Arc<SharedChild>,
    pub started_at: u64,
    pub status: TunnelStatus,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct TunnelManager {
    tunnels: Arc<RwLock<HashMap<String, RunningTunnel>>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            tunnels: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn now_millis() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn emit_status(app: &AppHandle, event: TunnelStatusEvent) {
        let _ = app.emit("ssh-tunnel://status-changed", event);
    }

    fn build_forward_spec(config: &SshTunnelConfig) -> Result<(String, String), String> {
        match config.tunnel_type {
            TunnelType::Local => {
                let local_bind = config.local_host.as_deref().unwrap_or("127.0.0.1").trim();
                let remote_dest = config.remote_host.as_deref().unwrap_or("127.0.0.1").trim();
                let remote_port = config.remote_port.ok_or_else(|| {
                    "Remote port is required for local port forwarding".to_string()
                })?;
                let spec = format!(
                    "{local_bind}:{}:{remote_dest}:{remote_port}",
                    config.local_port
                );
                Ok(("-L".to_string(), spec))
            }
            TunnelType::Remote => {
                let local_dest = config.local_host.as_deref().unwrap_or("127.0.0.1").trim();
                let remote_bind = config.remote_host.as_deref().unwrap_or("").trim();
                let remote_port = config.remote_port.ok_or_else(|| {
                    "Remote port is required for remote port forwarding".to_string()
                })?;
                let spec = if remote_bind.is_empty() {
                    format!("{remote_port}:{local_dest}:{}", config.local_port)
                } else {
                    format!(
                        "{remote_bind}:{remote_port}:{local_dest}:{}",
                        config.local_port
                    )
                };
                Ok(("-R".to_string(), spec))
            }
            TunnelType::Dynamic => {
                let local_bind = config.local_host.as_deref().unwrap_or("127.0.0.1").trim();
                let spec = format!("{local_bind}:{}", config.local_port);
                Ok(("-D".to_string(), spec))
            }
        }
    }

    fn build_ssh_args(config: &SshTunnelConfig) -> Result<Vec<String>, String> {
        let (flag, spec) = Self::build_forward_spec(config)?;
        let mut args = vec![
            "-N".to_string(), // Do not execute a remote shell
            "-T".to_string(), // Disable PTY allocation
            "-o".to_string(),
            "ExitOnReply=no".to_string(),
            "-o".to_string(),
            "BatchMode=yes".to_string(),
            "-o".to_string(),
            "ServerAliveInterval=15".to_string(),
            "-o".to_string(),
            "ServerAliveCountMax=3".to_string(),
            "-o".to_string(),
            "StrictHostKeyChecking=accept-new".to_string(),
            flag,
            spec,
        ];

        if let Some(port) = config.port.filter(|p| *p != 22) {
            args.extend(["-p".to_string(), port.to_string()]);
        }

        if let Some(identity_file) = config
            .identity_file
            .as_deref()
            .filter(|p| !p.trim().is_empty())
        {
            args.extend(["-i".to_string(), identity_file.trim().to_string()]);
        }

        if let Some(extra) = config.extra_args.as_deref() {
            args.extend(extra.split_whitespace().map(str::to_string));
        }

        let destination = match config.user.as_deref().filter(|u| !u.is_empty()) {
            Some(u) => format!("{u}@{}", config.host.trim()),
            None => config.host.trim().to_string(),
        };
        args.push(destination);

        Ok(args)
    }

    pub fn start_tunnel(
        &self,
        app: AppHandle,
        config: SshTunnelConfig,
    ) -> Result<TunnelStatusEvent, String> {
        let tunnel_id = config.id.clone();

        // If already running, stop it first
        let _ = self.stop_tunnel(&tunnel_id);

        let args = Self::build_ssh_args(&config)?;

        let mut cmd = Command::new("ssh");
        cmd.args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        crate::modules::proc::hide_console(&mut cmd);

        let child = Arc::new(
            SharedChild::spawn(&mut cmd)
                .map_err(|e| format!("Failed to start SSH tunnel process: {e}"))?,
        );

        let started_at = Self::now_millis();

        {
            let mut map = self.tunnels.write().map_err(|e| e.to_string())?;
            map.insert(
                tunnel_id.clone(),
                RunningTunnel {
                    config: config.clone(),
                    child: Arc::clone(&child),
                    started_at,
                    status: TunnelStatus::Connecting,
                    error: None,
                },
            );
        }

        let initial_event = TunnelStatusEvent {
            id: tunnel_id.clone(),
            status: TunnelStatus::Connecting,
            error: None,
            started_at: Some(started_at),
        };
        Self::emit_status(&app, initial_event.clone());

        // Spawn background monitor
        let tunnels_ref = Arc::clone(&self.tunnels);
        let app_handle = app.clone();
        let mon_id = tunnel_id.clone();
        let mon_child = Arc::clone(&child);

        std::thread::Builder::new()
            .name(format!("ssh-tunnel-{mon_id}"))
            .spawn(move || {
                // Monitor startup grace period (~800ms) to detect immediate launch failures
                let probe_duration = std::time::Duration::from_millis(800);
                let start_time = std::time::Instant::now();

                let mut early_exit = false;
                while start_time.elapsed() < probe_duration {
                    if let Ok(Some(status)) = mon_child.try_wait() {
                        early_exit = true;
                        let err_str = if !status.success() {
                            format!(
                                "SSH process exited with code {}",
                                status.code().unwrap_or(-1)
                            )
                        } else {
                            "SSH process exited unexpectedly".to_string()
                        };

                        if let Ok(mut map) = tunnels_ref.write() {
                            if let Some(t) = map.get_mut(&mon_id) {
                                t.status = TunnelStatus::Error;
                                t.error = Some(err_str.clone());
                            }
                        }

                        Self::emit_status(
                            &app_handle,
                            TunnelStatusEvent {
                                id: mon_id.clone(),
                                status: TunnelStatus::Error,
                                error: Some(err_str),
                                started_at: None,
                            },
                        );
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }

                if !early_exit {
                    // Tunnel survived grace period, mark as Active!
                    if let Ok(mut map) = tunnels_ref.write() {
                        if let Some(t) = map.get_mut(&mon_id) {
                            t.status = TunnelStatus::Active;
                        }
                    }

                    Self::emit_status(
                        &app_handle,
                        TunnelStatusEvent {
                            id: mon_id.clone(),
                            status: TunnelStatus::Active,
                            error: None,
                            started_at: Some(started_at),
                        },
                    );

                    // Wait for normal termination or disconnect
                    if let Ok(status) = mon_child.wait() {
                        let (final_status, final_error) = if status.success() {
                            (TunnelStatus::Stopped, None)
                        } else {
                            (
                                TunnelStatus::Error,
                                Some(format!(
                                    "SSH connection terminated (code {})",
                                    status.code().unwrap_or(-1)
                                )),
                            )
                        };

                        if let Ok(mut map) = tunnels_ref.write() {
                            if let Some(t) = map.get_mut(&mon_id) {
                                t.status = final_status.clone();
                                t.error = final_error.clone();
                            }
                        }

                        Self::emit_status(
                            &app_handle,
                            TunnelStatusEvent {
                                id: mon_id,
                                status: final_status,
                                error: final_error,
                                started_at: None,
                            },
                        );
                    }
                }
            })
            .map_err(|e| format!("Failed to spawn tunnel monitor thread: {e}"))?;

        Ok(initial_event)
    }

    pub fn stop_tunnel(&self, id: &str) -> Result<(), String> {
        let mut map = self.tunnels.write().map_err(|e| e.to_string())?;
        if let Some(mut tunnel) = map.remove(id) {
            let _ = tunnel.child.kill();
            tunnel.status = TunnelStatus::Stopped;
        }
        Ok(())
    }

    pub fn stop_all_tunnels(&self) -> Result<(), String> {
        let mut map = self.tunnels.write().map_err(|e| e.to_string())?;
        for (_, tunnel) in map.drain() {
            let _ = tunnel.child.kill();
        }
        Ok(())
    }

    pub fn list_active_tunnels(&self) -> Result<Vec<TunnelStatusEvent>, String> {
        let map = self.tunnels.read().map_err(|e| e.to_string())?;
        let list = map
            .iter()
            .map(|(id, t)| TunnelStatusEvent {
                id: id.clone(),
                status: t.status.clone(),
                error: t.error.clone(),
                started_at: if t.status == TunnelStatus::Active
                    || t.status == TunnelStatus::Connecting
                {
                    Some(t.started_at)
                } else {
                    None
                },
            })
            .collect();
        Ok(list)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::tunnel::types::TunnelType;

    #[test]
    fn builds_local_forward_spec() {
        let config = SshTunnelConfig {
            id: "tun-1".to_string(),
            name: "MySQL".to_string(),
            tunnel_type: TunnelType::Local,
            local_host: Some("127.0.0.1".to_string()),
            local_port: 3307,
            remote_host: Some("10.0.0.5".to_string()),
            remote_port: Some(3306),
            host: "server.example.com".to_string(),
            port: Some(2222),
            user: Some("ubuntu".to_string()),
            identity_file: Some("~/.ssh/id_rsa".to_string()),
            extra_args: None,
        };

        let (flag, spec) = TunnelManager::build_forward_spec(&config).unwrap();
        assert_eq!(flag, "-L");
        assert_eq!(spec, "127.0.0.1:3307:10.0.0.5:3306");

        let args = TunnelManager::build_ssh_args(&config).unwrap();
        assert!(args.contains(&"-L".to_string()));
        assert!(args.contains(&"127.0.0.1:3307:10.0.0.5:3306".to_string()));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"2222".to_string()));
        assert_eq!(args.last().unwrap(), "ubuntu@server.example.com");
    }

    #[test]
    fn builds_remote_forward_spec() {
        let config = SshTunnelConfig {
            id: "tun-2".to_string(),
            name: "Vite Dev".to_string(),
            tunnel_type: TunnelType::Remote,
            local_host: Some("127.0.0.1".to_string()),
            local_port: 5173,
            remote_host: Some("0.0.0.0".to_string()),
            remote_port: Some(8080),
            host: "192.168.1.50".to_string(),
            port: None,
            user: None,
            identity_file: None,
            extra_args: Some("-v".to_string()),
        };

        let (flag, spec) = TunnelManager::build_forward_spec(&config).unwrap();
        assert_eq!(flag, "-R");
        assert_eq!(spec, "0.0.0.0:8080:127.0.0.1:5173");

        let args = TunnelManager::build_ssh_args(&config).unwrap();
        assert!(args.contains(&"-R".to_string()));
        assert!(args.contains(&"0.0.0.0:8080:127.0.0.1:5173".to_string()));
        assert!(args.contains(&"-v".to_string()));
        assert_eq!(args.last().unwrap(), "192.168.1.50");
    }

    #[test]
    fn builds_dynamic_forward_spec() {
        let config = SshTunnelConfig {
            id: "tun-3".to_string(),
            name: "SOCKS5".to_string(),
            tunnel_type: TunnelType::Dynamic,
            local_host: Some("127.0.0.1".to_string()),
            local_port: 1080,
            remote_host: None,
            remote_port: None,
            host: "proxy.internal".to_string(),
            port: None,
            user: Some("root".to_string()),
            identity_file: None,
            extra_args: None,
        };

        let (flag, spec) = TunnelManager::build_forward_spec(&config).unwrap();
        assert_eq!(flag, "-D");
        assert_eq!(spec, "127.0.0.1:1080");

        let args = TunnelManager::build_ssh_args(&config).unwrap();
        assert!(args.contains(&"-D".to_string()));
        assert!(args.contains(&"127.0.0.1:1080".to_string()));
        assert_eq!(args.last().unwrap(), "root@proxy.internal");
    }
}
