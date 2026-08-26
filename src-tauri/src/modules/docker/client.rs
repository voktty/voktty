use bollard::Docker;

pub fn create_docker_client(custom_host: Option<&str>) -> Result<Docker, String> {
    if let Some(host) = custom_host {
        let trimmed = host.trim();
        if !trimmed.is_empty() {
            if trimmed.starts_with("tcp://")
                || trimmed.starts_with("http://")
                || trimmed.starts_with("https://")
            {
                return Docker::connect_with_http(trimmed, 120, bollard::API_DEFAULT_VERSION)
                    .map_err(|e| format!("Failed to connect to Docker via HTTP: {e}"));
            }

            #[cfg(windows)]
            {
                if trimmed.starts_with("npipe://")
                    || trimmed.starts_with("//./pipe/")
                    || trimmed.starts_with(r"\\.\pipe\")
                {
                    return Docker::connect_with_named_pipe(
                        trimmed,
                        120,
                        bollard::API_DEFAULT_VERSION,
                    )
                    .map_err(|e| format!("Failed to connect to Docker via Named Pipe: {e}"));
                }
            }

            #[cfg(unix)]
            {
                if trimmed.starts_with("unix://") || trimmed.starts_with('/') {
                    return Docker::connect_with_unix(trimmed, 120, bollard::API_DEFAULT_VERSION)
                        .map_err(|e| format!("Failed to connect to Docker via Unix Socket: {e}"));
                }
            }

            return Docker::connect_with_socket(trimmed, 120, bollard::API_DEFAULT_VERSION)
                .map_err(|e| format!("Failed to connect to Docker via socket: {e}"));
        }
    }

    // Default multiplatform connection:
    // Windows -> Named Pipe (\\.\pipe\docker_engine)
    // Linux/macOS -> Unix socket (/var/run/docker.sock) or DOCKER_HOST env
    Docker::connect_with_local_defaults()
        .map_err(|e| format!("Failed to connect to local Docker daemon: {e}"))
}
