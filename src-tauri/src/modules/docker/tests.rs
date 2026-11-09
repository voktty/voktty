#[cfg(test)]
mod docker_stats_tests {
    use crate::modules::docker::stats::calculate_container_stats;
    use bollard::models::ContainerStatsResponse;

    #[test]
    fn test_calculate_container_stats_from_json() {
        let json_data = r#"{
            "read": "2026-08-22T00:00:00Z",
            "preread": "2026-08-22T00:00:00Z",
            "num_procs": 4,
            "storage_stats": {},
            "pids_stats": { "current": 4 },
            "memory_stats": { "usage": 104857600, "limit": 1073741824 },
            "blkio_stats": { "io_service_bytes_recursive": [] },
            "cpu_stats": {
                "cpu_usage": {
                    "total_usage": 200000000,
                    "usage_in_kernelmode": 50000000,
                    "usage_in_usermode": 150000000
                },
                "system_cpu_usage": 1000000000,
                "online_cpus": 2,
                "throttling_data": {
                    "periods": 0,
                    "throttled_periods": 0,
                    "throttled_time": 0
                }
            },
            "precpu_stats": {
                "cpu_usage": {
                    "total_usage": 100000000,
                    "usage_in_kernelmode": 25000000,
                    "usage_in_usermode": 75000000
                },
                "system_cpu_usage": 500000000,
                "throttling_data": {
                    "periods": 0,
                    "throttled_periods": 0,
                    "throttled_time": 0
                }
            },
            "name": "/web-server",
            "id": "c12345678901"
        }"#;

        let stats: ContainerStatsResponse =
            serde_json::from_str(json_data).expect("failed to deserialize stats json");
        let res =
            calculate_container_stats("c12345678901".to_string(), "web-server".to_string(), &stats);

        assert_eq!(res.id, "c12345678901");
        assert_eq!(res.name, "web-server");
        assert_eq!(res.pids_current, 4);
        assert_eq!(res.memory_usage_bytes, 104857600);
        assert_eq!(res.memory_limit_bytes, 1073741824);
        assert!((res.memory_percent - 9.77).abs() < 0.1);
        assert!((res.cpu_percent - 40.0).abs() < 0.1);
    }

    #[tokio::test]
    async fn test_docker_ping_and_list_live_or_fallback() {
        use crate::modules::docker::commands::{docker_list_containers, docker_ping};

        let status = docker_ping(None).await.expect("ping should return status");
        if status.connected {
            assert!(status.version.is_some());
            assert!(status.os.is_some());
            let containers = docker_list_containers(Some(true), None)
                .await
                .expect("listing containers on connected daemon should succeed");
            assert_eq!(containers.len(), status.containers_total);
        } else {
            assert!(status.error.is_some());
        }
    }

    #[test]
    fn test_docker_real_pty_spawn_input_output_cwd() {
        use portable_pty::{native_pty_system, PtySize};
        use std::io::{Read, Write};

        struct DockerCleanup(String);
        impl Drop for DockerCleanup {
            fn drop(&mut self) {
                let _ = std::process::Command::new("docker")
                    .args(["rm", "-f", &self.0])
                    .output();
            }
        }

        let container_name = format!("voktty_u5_pty_{}", std::process::id());
        let start = std::process::Command::new("docker")
            .args([
                "run",
                "-d",
                "--rm",
                "--name",
                &container_name,
                "-w",
                "/tmp",
                "alpine",
                "sleep",
                "30",
            ])
            .output();

        let Ok(output) = start else {
            // Docker daemon not accessible or docker binary missing in environment
            return;
        };

        if !output.status.success() {
            // Docker daemon not running or access denied in environment
            return;
        }

        let _guard = DockerCleanup(container_name.clone());

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize::default()).expect("openpty");
        let cmd = crate::modules::pty::shell_init::build_command(
            None,
            crate::modules::workspace::WorkspaceEnv::Docker {
                container_id: container_name.clone(),
                container_name: Some(container_name.clone()),
                image: Some("alpine".into()),
                shell: Some("/bin/sh".into()),
                user: None,
                workdir: Some("/tmp".into()),
            },
            false,
            None,
            None,
        )
        .expect("build docker command");

        let mut child = pair.slave.spawn_command(cmd).expect("spawn command");
        drop(pair.slave);

        let mut writer = pair.master.take_writer().expect("take_writer");
        let mut reader = pair.master.try_clone_reader().expect("try_clone_reader");

        std::thread::sleep(std::time::Duration::from_millis(150));

        writeln!(writer, "pwd").expect("write pwd");
        writeln!(writer, "echo U5_DOCKER_VERIFIED").expect("write echo");
        writeln!(writer, "exit").expect("write exit");
        writer.flush().expect("flush writer");

        let mut output_str = String::new();
        let mut buf = [0u8; 1024];
        let start_read = std::time::Instant::now();
        while start_read.elapsed() < std::time::Duration::from_secs(5) {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    output_str.push_str(&String::from_utf8_lossy(&buf[..n]));
                    if output_str.contains("U5_DOCKER_VERIFIED") && output_str.contains("/tmp") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }

        let _ = child.wait();
        assert!(
            output_str.contains("/tmp"),
            "PTY cwd /tmp should be in output: {output_str}"
        );
        assert!(
            output_str.contains("U5_DOCKER_VERIFIED"),
            "Echo verification should be in output: {output_str}"
        );
    }
}
