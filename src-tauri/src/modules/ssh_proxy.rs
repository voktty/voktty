//! Cross-platform SSH Proxy Connector for Voktty.
//!
//! Provides support for routing SSH connections through:
//! - HTTP / HTTPS CONNECT proxies (RFC 7231 / RFC 2817) with optional Basic Authentication
//! - SOCKS5 proxies (RFC 1928 / RFC 1929) with optional Username/Password Authentication
//! - SOCKS4 / SOCKS4a proxies
//!
//! Supports both:
//! 1. CLI mode (`maybe_run`): Executed by OpenSSH via `ProxyCommand`, bridging stdin/stdout.
//! 2. Async mode (`connect_via_proxy`): Used directly by `ssh_native` (`russh`).

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

use base64::Engine;

use crate::modules::ssh_native::types::{SshErrorCode, SshNativeError, SshNativeProxy};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

/// Builds the OpenSSH `ProxyCommand` string invoking the Voktty binary in `ssh-proxy` mode.
pub fn build_proxy_command(
    proxy: &crate::modules::remote::RemoteSshProxy,
) -> Result<String, String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("cannot resolve current executable path for ProxyCommand: {e}"))?;
    let exe_str = exe.to_string_lossy().replace('\\', "/");

    let mut parts = vec![
        format!("\"{exe_str}\""),
        "ssh-proxy".to_string(),
        "--type".to_string(),
        proxy.proxy_type.clone(),
        "--proxy-host".to_string(),
        proxy.host.clone(),
        "--proxy-port".to_string(),
        proxy.port.to_string(),
    ];

    if let Some(u) = &proxy.user {
        let trimmed = u.trim();
        if !trimmed.is_empty() {
            parts.push("--user".to_string());
            parts.push(trimmed.to_string());
        }
    }

    if let Some(p) = &proxy.password {
        let trimmed = p.trim();
        if !trimmed.is_empty() {
            parts.push("--password".to_string());
            parts.push(trimmed.to_string());
        }
    }

    parts.push("%h".to_string());
    parts.push("%p".to_string());
    Ok(parts.join(" "))
}

/// Invoked from `main()` before GUI initialization if invoked in `ssh-proxy` mode.
pub fn maybe_run() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 || args[1] != "ssh-proxy" {
        return None;
    }

    Some(match run_cli_proxy(&args[2..]) {
        Ok(()) => 0,
        Err(err) => {
            eprintln!("[voktty ssh-proxy] error: {err}");
            1
        }
    })
}

fn run_cli_proxy(args: &[String]) -> Result<(), String> {
    let mut proxy_type = "http".to_string();
    let mut proxy_host = String::new();
    let mut proxy_port: u16 = 8080;
    let mut proxy_user: Option<String> = None;
    let mut proxy_password: Option<String> = None;
    let mut positionals = Vec::new();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--type" => {
                i += 1;
                if i < args.len() {
                    proxy_type = args[i].clone();
                }
            }
            "--proxy-host" => {
                i += 1;
                if i < args.len() {
                    proxy_host = args[i].clone();
                }
            }
            "--proxy-port" => {
                i += 1;
                if i < args.len() {
                    proxy_port = args[i].parse().unwrap_or(8080);
                }
            }
            "--user" => {
                i += 1;
                if i < args.len() {
                    proxy_user = Some(args[i].clone());
                }
            }
            "--password" => {
                i += 1;
                if i < args.len() {
                    proxy_password = Some(args[i].clone());
                }
            }
            other => {
                if !other.starts_with("--") {
                    positionals.push(other.to_string());
                }
            }
        }
        i += 1;
    }

    if positionals.len() < 2 {
        return Err(format!(
            "insufficient arguments: expected target host and port, got {:?}",
            positionals
        ));
    }

    let target_host = &positionals[0];
    let target_port: u16 = positionals[1]
        .parse()
        .map_err(|_| format!("invalid target port: {}", positionals[1]))?;

    let stream = connect_sync(
        &proxy_type,
        &proxy_host,
        proxy_port,
        target_host,
        target_port,
        proxy_user.as_deref(),
        proxy_password.as_deref(),
    )?;

    relay_sync(stream)
}

fn relay_sync(mut socket: TcpStream) -> Result<(), String> {
    let mut socket_read = socket
        .try_clone()
        .map_err(|e| format!("failed to clone socket: {e}"))?;

    let t1 = std::thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 8192];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if socket.write_all(&buf[..n]).is_err() {
                        break;
                    }
                    let _ = socket.flush();
                }
                Err(_) => break,
            }
        }
    });

    let mut stdout = std::io::stdout();
    let mut buf = [0u8; 8192];
    loop {
        match socket_read.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if stdout.write_all(&buf[..n]).is_err() {
                    break;
                }
                let _ = stdout.flush();
            }
            Err(_) => break,
        }
    }

    let _ = t1.join();
    Ok(())
}

/// Connects synchronously to a proxy and performs the handshake.
pub fn connect_sync(
    proxy_type: &str,
    proxy_host: &str,
    proxy_port: u16,
    target_host: &str,
    target_port: u16,
    user: Option<&str>,
    password: Option<&str>,
) -> Result<TcpStream, String> {
    let addr = format!("{proxy_host}:{proxy_port}");
    let socket_addrs: Vec<SocketAddr> = addr
        .to_socket_addrs()
        .map_err(|e| format!("cannot resolve proxy address {addr}: {e}"))?
        .collect();

    if socket_addrs.is_empty() {
        return Err(format!("proxy address {addr} resolved to zero IPs"));
    }

    let mut stream = TcpStream::connect_timeout(&socket_addrs[0], CONNECT_TIMEOUT)
        .map_err(|e| format!("failed to connect to proxy {addr}: {e}"))?;

    stream
        .set_read_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|e| e.to_string())?;
    stream
        .set_write_timeout(Some(HANDSHAKE_TIMEOUT))
        .map_err(|e| e.to_string())?;

    match proxy_type.to_ascii_lowercase().as_str() {
        "socks5" => {
            socks5_handshake_sync(&mut stream, target_host, target_port, user, password)?;
        }
        "socks4" | "socks4a" => {
            socks4_handshake_sync(&mut stream, target_host, target_port, user)?;
        }
        _ => {
            // "http" or "https" (HTTP CONNECT)
            http_connect_handshake_sync(&mut stream, target_host, target_port, user, password)?;
        }
    }

    // Reset timeouts so relay can block indefinitely.
    let _ = stream.set_read_timeout(None);
    let _ = stream.set_write_timeout(None);

    Ok(stream)
}

fn http_connect_handshake_sync(
    stream: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    user: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    let mut req = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nUser-Agent: Voktty-SSH-Proxy\r\nProxy-Connection: Keep-Alive\r\n"
    );

    if let Some(u) = user {
        let p = password.unwrap_or("");
        let raw = format!("{u}:{p}");
        let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
        req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }

    req.push_str("\r\n");

    stream
        .write_all(req.as_bytes())
        .map_err(|e| format!("failed to write HTTP CONNECT request: {e}"))?;
    stream.flush().map_err(|e| e.to_string())?;

    let mut response_buf = [0u8; 4096];
    let mut total_read = 0;

    while total_read < response_buf.len() {
        let n = stream
            .read(&mut response_buf[total_read..])
            .map_err(|e| format!("failed to read HTTP CONNECT response: {e}"))?;
        if n == 0 {
            return Err("proxy closed connection prematurely during HTTP CONNECT".into());
        }
        total_read += n;

        if let Some(pos) = find_header_end(&response_buf[..total_read]) {
            let header_str = String::from_utf8_lossy(&response_buf[..pos]);
            let first_line = header_str.lines().next().unwrap_or("");
            if !first_line.contains(" 200") {
                if first_line.contains(" 407") {
                    return Err(
                        "HTTP proxy authentication failed (407 Proxy Authentication Required)"
                            .into(),
                    );
                }
                return Err(format!("HTTP proxy CONNECT failed: {first_line}"));
            }
            return Ok(());
        }
    }

    Err("HTTP proxy response header exceeded 4KB limit".into())
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    for i in 3..buf.len() {
        if buf[i - 3] == b'\r' && buf[i - 2] == b'\n' && buf[i - 1] == b'\r' && buf[i] == b'\n' {
            return Some(i + 1);
        }
    }
    None
}

fn socks5_handshake_sync(
    stream: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    user: Option<&str>,
    password: Option<&str>,
) -> Result<(), String> {
    let has_auth = user.is_some() || password.is_some();
    if has_auth {
        // Version 5, 2 methods: 0 (NoAuth), 2 (Username/Password)
        stream
            .write_all(&[0x05, 0x02, 0x00, 0x02])
            .map_err(|e| e.to_string())?;
    } else {
        // Version 5, 1 method: 0 (NoAuth)
        stream
            .write_all(&[0x05, 0x01, 0x00])
            .map_err(|e| e.to_string())?;
    }
    stream.flush().map_err(|e| e.to_string())?;

    let mut method_resp = [0u8; 2];
    stream
        .read_exact(&mut method_resp)
        .map_err(|e| format!("SOCKS5 greeting failed: {e}"))?;
    if method_resp[0] != 0x05 {
        return Err(format!(
            "invalid SOCKS version in response: {}",
            method_resp[0]
        ));
    }

    if method_resp[1] == 0x02 {
        // Username/Password authentication (RFC 1929)
        let u = user.unwrap_or("");
        let p = password.unwrap_or("");
        let mut auth_pkt = vec![0x01, u.len() as u8];
        auth_pkt.extend_from_slice(u.as_bytes());
        auth_pkt.push(p.len() as u8);
        auth_pkt.extend_from_slice(p.as_bytes());

        stream.write_all(&auth_pkt).map_err(|e| e.to_string())?;
        stream.flush().map_err(|e| e.to_string())?;

        let mut auth_resp = [0u8; 2];
        stream
            .read_exact(&mut auth_resp)
            .map_err(|e| format!("SOCKS5 auth read failed: {e}"))?;
        if auth_resp[1] != 0x00 {
            return Err("SOCKS5 username/password authentication failed".into());
        }
    } else if method_resp[1] != 0x00 {
        return Err(format!(
            "no acceptable SOCKS5 authentication method (got 0x{:02x})",
            method_resp[1]
        ));
    }

    // Connect request: [0x05, 0x01 (CONNECT), 0x00 (RSV), ATYP, ADDR, PORT]
    let mut connect_pkt = vec![0x05, 0x01, 0x00];
    if let Ok(ip4) = target_host.parse::<Ipv4Addr>() {
        connect_pkt.push(0x01);
        connect_pkt.extend_from_slice(&ip4.octets());
    } else if let Ok(ip6) = target_host.parse::<std::net::Ipv6Addr>() {
        connect_pkt.push(0x04);
        connect_pkt.extend_from_slice(&ip6.octets());
    } else {
        connect_pkt.push(0x03);
        let host_bytes = target_host.as_bytes();
        if host_bytes.len() > 255 {
            return Err("target host name is too long for SOCKS5".into());
        }
        connect_pkt.push(host_bytes.len() as u8);
        connect_pkt.extend_from_slice(host_bytes);
    }
    connect_pkt.extend_from_slice(&target_port.to_be_bytes());

    stream.write_all(&connect_pkt).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    let mut resp_header = [0u8; 4];
    stream
        .read_exact(&mut resp_header)
        .map_err(|e| format!("SOCKS5 connect response failed: {e}"))?;
    if resp_header[0] != 0x05 {
        return Err("invalid SOCKS5 connect response version".into());
    }
    if resp_header[1] != 0x00 {
        let msg = match resp_header[1] {
            0x01 => "general SOCKS server failure",
            0x02 => "connection not allowed by ruleset",
            0x03 => "network unreachable",
            0x04 => "host unreachable",
            0x05 => "connection refused",
            0x06 => "TTL expired",
            0x07 => "command not supported",
            0x08 => "address type not supported",
            other => return Err(format!("SOCKS5 error code 0x{other:02x}")),
        };
        return Err(format!("SOCKS5 connection rejected: {msg}"));
    }

    // Discard bind address from response
    match resp_header[3] {
        0x01 => {
            let mut discard = [0u8; 4 + 2];
            stream.read_exact(&mut discard).map_err(|e| e.to_string())?;
        }
        0x04 => {
            let mut discard = [0u8; 16 + 2];
            stream.read_exact(&mut discard).map_err(|e| e.to_string())?;
        }
        0x03 => {
            let mut len_buf = [0u8; 1];
            stream.read_exact(&mut len_buf).map_err(|e| e.to_string())?;
            let mut discard = vec![0u8; len_buf[0] as usize + 2];
            stream.read_exact(&mut discard).map_err(|e| e.to_string())?;
        }
        other => return Err(format!("unsupported SOCKS5 address type 0x{other:02x}")),
    }

    Ok(())
}

fn socks4_handshake_sync(
    stream: &mut TcpStream,
    target_host: &str,
    target_port: u16,
    user: Option<&str>,
) -> Result<(), String> {
    let mut pkt = vec![0x04, 0x01];
    pkt.extend_from_slice(&target_port.to_be_bytes());

    if let Ok(ip4) = target_host.parse::<Ipv4Addr>() {
        pkt.extend_from_slice(&ip4.octets());
        if let Some(u) = user {
            pkt.extend_from_slice(u.as_bytes());
        }
        pkt.push(0x00);
    } else {
        // SOCKS4a for domain names: IP is 0.0.0.x where x != 0
        pkt.extend_from_slice(&[0, 0, 0, 1]);
        if let Some(u) = user {
            pkt.extend_from_slice(u.as_bytes());
        }
        pkt.push(0x00);
        pkt.extend_from_slice(target_host.as_bytes());
        pkt.push(0x00);
    }

    stream.write_all(&pkt).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    let mut resp = [0u8; 8];
    stream
        .read_exact(&mut resp)
        .map_err(|e| format!("SOCKS4 response failed: {e}"))?;
    if resp[1] != 0x5a {
        return Err(format!(
            "SOCKS4 request rejected or failed (code 0x{:02x})",
            resp[1]
        ));
    }

    Ok(())
}

/// Asynchronously connects through a proxy for `ssh_native` (russh).
pub async fn connect_via_proxy(
    proxy: &SshNativeProxy,
    target_host: &str,
    target_port: u16,
) -> Result<tokio::net::TcpStream, SshNativeError> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let proxy_addr = format!("{}:{}", proxy.host, proxy.port);
    let mut stream =
        tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(&proxy_addr))
            .await
            .map_err(|_| {
                SshNativeError::new(
                    SshErrorCode::Timeout,
                    format!("connection to proxy {proxy_addr} timed out"),
                )
            })?
            .map_err(|e| {
                SshNativeError::new(
                    SshErrorCode::Unreachable,
                    format!("cannot connect to proxy {proxy_addr}: {e}"),
                )
            })?;

    match proxy.proxy_type.to_ascii_lowercase().as_str() {
        "socks5" => {
            let has_auth = proxy.user.is_some() || proxy.password.is_some();
            if has_auth {
                stream
                    .write_all(&[0x05, 0x02, 0x00, 0x02])
                    .await
                    .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;
            } else {
                stream
                    .write_all(&[0x05, 0x01, 0x00])
                    .await
                    .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;
            }
            stream
                .flush()
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;

            let mut method_resp = [0u8; 2];
            stream.read_exact(&mut method_resp).await.map_err(|e| {
                SshNativeError::new(
                    SshErrorCode::Protocol,
                    format!("SOCKS5 greeting failed: {e}"),
                )
            })?;

            if method_resp[1] == 0x02 {
                let u = proxy.user.as_deref().unwrap_or("");
                let p = proxy.password.as_deref().unwrap_or("");
                let mut auth_pkt = vec![0x01, u.len() as u8];
                auth_pkt.extend_from_slice(u.as_bytes());
                auth_pkt.push(p.len() as u8);
                auth_pkt.extend_from_slice(p.as_bytes());

                stream
                    .write_all(&auth_pkt)
                    .await
                    .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;
                stream
                    .flush()
                    .await
                    .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;

                let mut auth_resp = [0u8; 2];
                stream.read_exact(&mut auth_resp).await.map_err(|e| {
                    SshNativeError::new(SshErrorCode::Protocol, format!("SOCKS5 auth failed: {e}"))
                })?;
                if auth_resp[1] != 0x00 {
                    return Err(SshNativeError::new(
                        SshErrorCode::AuthFailed,
                        "SOCKS5 proxy username/password authentication rejected",
                    ));
                }
            } else if method_resp[1] != 0x00 {
                return Err(SshNativeError::new(
                    SshErrorCode::AuthFailed,
                    format!(
                        "no acceptable SOCKS5 authentication method (0x{:02x})",
                        method_resp[1]
                    ),
                ));
            }

            let mut connect_pkt = vec![0x05, 0x01, 0x00];
            if let Ok(ip4) = target_host.parse::<Ipv4Addr>() {
                connect_pkt.push(0x01);
                connect_pkt.extend_from_slice(&ip4.octets());
            } else if let Ok(ip6) = target_host.parse::<std::net::Ipv6Addr>() {
                connect_pkt.push(0x04);
                connect_pkt.extend_from_slice(&ip6.octets());
            } else {
                connect_pkt.push(0x03);
                let host_bytes = target_host.as_bytes();
                if host_bytes.len() > 255 {
                    return Err(SshNativeError::new(
                        SshErrorCode::Config,
                        "target host name too long for SOCKS5",
                    ));
                }
                connect_pkt.push(host_bytes.len() as u8);
                connect_pkt.extend_from_slice(host_bytes);
            }
            connect_pkt.extend_from_slice(&target_port.to_be_bytes());

            stream
                .write_all(&connect_pkt)
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;
            stream
                .flush()
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;

            let mut resp_header = [0u8; 4];
            stream.read_exact(&mut resp_header).await.map_err(|e| {
                SshNativeError::new(
                    SshErrorCode::Protocol,
                    format!("SOCKS5 connect response failed: {e}"),
                )
            })?;

            if resp_header[1] != 0x00 {
                return Err(SshNativeError::new(
                    SshErrorCode::Unreachable,
                    format!(
                        "SOCKS5 proxy connect failed with error code 0x{:02x}",
                        resp_header[1]
                    ),
                ));
            }

            // Drain bind address
            match resp_header[3] {
                0x01 => {
                    let mut discard = [0u8; 6];
                    stream
                        .read_exact(&mut discard)
                        .await
                        .map_err(|e| SshNativeError::new(SshErrorCode::Protocol, e.to_string()))?;
                }
                0x04 => {
                    let mut discard = [0u8; 18];
                    stream
                        .read_exact(&mut discard)
                        .await
                        .map_err(|e| SshNativeError::new(SshErrorCode::Protocol, e.to_string()))?;
                }
                0x03 => {
                    let mut len = [0u8; 1];
                    stream
                        .read_exact(&mut len)
                        .await
                        .map_err(|e| SshNativeError::new(SshErrorCode::Protocol, e.to_string()))?;
                    let mut discard = vec![0u8; len[0] as usize + 2];
                    stream
                        .read_exact(&mut discard)
                        .await
                        .map_err(|e| SshNativeError::new(SshErrorCode::Protocol, e.to_string()))?;
                }
                _ => {}
            }
        }
        "socks4" | "socks4a" => {
            let mut pkt = vec![0x04, 0x01];
            pkt.extend_from_slice(&target_port.to_be_bytes());
            if let Ok(ip4) = target_host.parse::<Ipv4Addr>() {
                pkt.extend_from_slice(&ip4.octets());
                if let Some(u) = &proxy.user {
                    pkt.extend_from_slice(u.as_bytes());
                }
                pkt.push(0x00);
            } else {
                pkt.extend_from_slice(&[0, 0, 0, 1]);
                if let Some(u) = &proxy.user {
                    pkt.extend_from_slice(u.as_bytes());
                }
                pkt.push(0x00);
                pkt.extend_from_slice(target_host.as_bytes());
                pkt.push(0x00);
            }

            stream
                .write_all(&pkt)
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;
            stream
                .flush()
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;

            let mut resp = [0u8; 8];
            stream.read_exact(&mut resp).await.map_err(|e| {
                SshNativeError::new(
                    SshErrorCode::Protocol,
                    format!("SOCKS4 response error: {e}"),
                )
            })?;
            if resp[1] != 0x5a {
                return Err(SshNativeError::new(
                    SshErrorCode::Unreachable,
                    format!("SOCKS4 request rejected (code 0x{:02x})", resp[1]),
                ));
            }
        }
        _ => {
            // HTTP / HTTPS CONNECT
            let mut req = format!(
                "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nUser-Agent: Voktty-SSH-Proxy\r\nProxy-Connection: Keep-Alive\r\n"
            );

            if let Some(u) = &proxy.user {
                let p = proxy.password.as_deref().unwrap_or("");
                let raw = format!("{u}:{p}");
                let encoded = base64::engine::general_purpose::STANDARD.encode(raw);
                req.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
            }
            req.push_str("\r\n");

            stream
                .write_all(req.as_bytes())
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;
            stream
                .flush()
                .await
                .map_err(|e| SshNativeError::new(SshErrorCode::Unreachable, e.to_string()))?;

            let mut response_buf = [0u8; 4096];
            let mut total_read = 0;

            loop {
                let n = stream
                    .read(&mut response_buf[total_read..])
                    .await
                    .map_err(|e| {
                        SshNativeError::new(
                            SshErrorCode::Protocol,
                            format!("failed reading HTTP response: {e}"),
                        )
                    })?;
                if n == 0 {
                    return Err(SshNativeError::new(
                        SshErrorCode::Unreachable,
                        "proxy closed connection during HTTP CONNECT handshake",
                    ));
                }
                total_read += n;

                if let Some(pos) = find_header_end(&response_buf[..total_read]) {
                    let header_str = String::from_utf8_lossy(&response_buf[..pos]);
                    let first_line = header_str.lines().next().unwrap_or("");
                    if !first_line.contains(" 200") {
                        if first_line.contains(" 407") {
                            return Err(SshNativeError::new(
                                SshErrorCode::AuthFailed,
                                "HTTP proxy authentication failed (407 Proxy Authentication Required)",
                            ));
                        }
                        return Err(SshNativeError::new(
                            SshErrorCode::Unreachable,
                            format!("HTTP proxy CONNECT failed: {first_line}"),
                        ));
                    }
                    break;
                }

                if total_read >= response_buf.len() {
                    return Err(SshNativeError::new(
                        SshErrorCode::Protocol,
                        "HTTP proxy response header exceeded limit",
                    ));
                }
            }
        }
    }

    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_ssh_proxy_command_with_all_parameters() {
        let proxy = crate::modules::remote::RemoteSshProxy {
            enabled: true,
            proxy_type: "socks5".to_string(),
            host: "10.0.0.1".to_string(),
            port: 1080,
            user: Some("proxyuser".to_string()),
            password: Some("proxypass".to_string()),
        };

        let cmd = build_proxy_command(&proxy).unwrap();
        assert!(cmd.contains("ssh-proxy"));
        assert!(cmd.contains("--type socks5"));
        assert!(cmd.contains("--proxy-host 10.0.0.1"));
        assert!(cmd.contains("--proxy-port 1080"));
        assert!(cmd.contains("--user proxyuser"));
        assert!(cmd.contains("--password proxypass"));
        assert!(cmd.ends_with("%h %p"));
    }

    #[test]
    fn find_header_end_detects_crlf_crlf() {
        let data = b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\nremainder";
        assert_eq!(find_header_end(data), Some(38));
    }
}
