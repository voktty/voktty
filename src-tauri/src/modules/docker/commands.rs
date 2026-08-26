use bollard::container::{
    KillContainerOptions, ListContainersOptions, LogsOptions, RemoveContainerOptions,
    RestartContainerOptions, StartContainerOptions, StatsOptions, StopContainerOptions,
};
use futures_util::StreamExt;
use std::collections::HashMap;

use super::client::create_docker_client;
use super::stats::calculate_container_stats;
use super::types::{
    DockerContainerInfo, DockerContainerStats, DockerDaemonStatus, DockerPortMapping,
};

#[tauri::command]
pub async fn docker_ping(custom_host: Option<String>) -> Result<DockerDaemonStatus, String> {
    let docker = match create_docker_client(custom_host.as_deref()) {
        Ok(client) => client,
        Err(err) => {
            return Ok(DockerDaemonStatus {
                connected: false,
                version: None,
                os: None,
                containers_running: 0,
                containers_total: 0,
                images_count: 0,
                driver: None,
                error: Some(err),
            });
        }
    };

    let version_info = docker.version().await.map_err(|e| e.to_string());
    let sys_info = docker.info().await.map_err(|e| e.to_string());

    match (version_info, sys_info) {
        (Ok(v), Ok(info)) => Ok(DockerDaemonStatus {
            connected: true,
            version: v.version,
            os: v.os.or(info.operating_system),
            containers_running: info.containers_running.unwrap_or(0) as usize,
            containers_total: info.containers.unwrap_or(0) as usize,
            images_count: info.images.unwrap_or(0) as usize,
            driver: info.driver,
            error: None,
        }),
        (Ok(v), Err(_)) => Ok(DockerDaemonStatus {
            connected: true,
            version: v.version,
            os: v.os,
            containers_running: 0,
            containers_total: 0,
            images_count: 0,
            driver: None,
            error: None,
        }),
        (Err(e), _) => Ok(DockerDaemonStatus {
            connected: false,
            version: None,
            os: None,
            containers_running: 0,
            containers_total: 0,
            images_count: 0,
            driver: None,
            error: Some(e),
        }),
    }
}

#[tauri::command]
pub async fn docker_list_containers(
    all: Option<bool>,
    custom_host: Option<String>,
) -> Result<Vec<DockerContainerInfo>, String> {
    let docker = create_docker_client(custom_host.as_deref())?;

    let options = ListContainersOptions::<String> {
        all: all.unwrap_or(true),
        ..Default::default()
    };

    let containers = docker
        .list_containers(Some(options))
        .await
        .map_err(|e| format!("Failed to list docker containers: {e}"))?;

    let mut result = Vec::with_capacity(containers.len());

    for c in containers {
        let full_id = c.id.clone().unwrap_or_default();
        let short_id = if full_id.len() >= 12 {
            full_id[..12].to_string()
        } else {
            full_id.clone()
        };

        let raw_names = c.names.unwrap_or_default();
        let cleaned_names: Vec<String> = raw_names
            .into_iter()
            .map(|n| n.trim_start_matches('/').to_string())
            .collect();

        let labels: HashMap<String, String> = c.labels.unwrap_or_default();
        let compose_project = labels
            .get("com.docker.compose.project")
            .cloned()
            .or_else(|| labels.get("io.podman.compose.project").cloned());
        let compose_service = labels
            .get("com.docker.compose.service")
            .cloned()
            .or_else(|| labels.get("io.podman.compose.service").cloned());

        let ports: Vec<DockerPortMapping> = c
            .ports
            .unwrap_or_default()
            .into_iter()
            .map(|p| DockerPortMapping {
                ip: p.ip,
                private_port: p.private_port,
                public_port: p.public_port,
                port_type: p
                    .typ
                    .map(|t| t.to_string())
                    .unwrap_or_else(|| "tcp".to_string()),
            })
            .collect();

        result.push(DockerContainerInfo {
            id: full_id,
            short_id,
            names: cleaned_names,
            image: c.image.unwrap_or_default(),
            image_id: c.image_id.unwrap_or_default(),
            command: c.command.unwrap_or_default(),
            created: c.created.unwrap_or(0),
            state: c
                .state
                .map(|s| s.to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            status: c.status.unwrap_or_default(),
            ports,
            compose_project,
            compose_service,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn docker_container_action(
    container_id: String,
    action: String,
    custom_host: Option<String>,
) -> Result<(), String> {
    let docker = create_docker_client(custom_host.as_deref())?;

    match action.to_lowercase().as_str() {
        "start" => {
            docker
                .start_container(&container_id, None::<StartContainerOptions<String>>)
                .await
                .map_err(|e| format!("Failed to start container {container_id}: {e}"))?;
        }
        "stop" => {
            docker
                .stop_container(&container_id, None::<StopContainerOptions>)
                .await
                .map_err(|e| format!("Failed to stop container {container_id}: {e}"))?;
        }
        "restart" => {
            docker
                .restart_container(&container_id, None::<RestartContainerOptions>)
                .await
                .map_err(|e| format!("Failed to restart container {container_id}: {e}"))?;
        }
        "pause" => {
            docker
                .pause_container(&container_id)
                .await
                .map_err(|e| format!("Failed to pause container {container_id}: {e}"))?;
        }
        "unpause" => {
            docker
                .unpause_container(&container_id)
                .await
                .map_err(|e| format!("Failed to unpause container {container_id}: {e}"))?;
        }
        "kill" => {
            docker
                .kill_container(&container_id, None::<KillContainerOptions<String>>)
                .await
                .map_err(|e| format!("Failed to kill container {container_id}: {e}"))?;
        }
        "remove" | "rm" => {
            docker
                .remove_container(
                    &container_id,
                    Some(RemoveContainerOptions {
                        force: true,
                        ..Default::default()
                    }),
                )
                .await
                .map_err(|e| format!("Failed to remove container {container_id}: {e}"))?;
        }
        other => return Err(format!("Unknown docker container action: {other}")),
    }

    Ok(())
}

#[tauri::command]
pub async fn docker_get_stats(
    container_id: String,
    custom_host: Option<String>,
) -> Result<DockerContainerStats, String> {
    let docker = create_docker_client(custom_host.as_deref())?;

    let options = StatsOptions {
        stream: false,
        one_shot: true,
    };

    let mut stream = docker.stats(&container_id, Some(options));
    if let Some(res) = stream.next().await {
        let stats = res.map_err(|e| format!("Failed to fetch stats for {container_id}: {e}"))?;
        Ok(calculate_container_stats(
            container_id.clone(),
            stats.name.clone(),
            &stats,
        ))
    } else {
        Err(format!("No stats returned for container {container_id}"))
    }
}

#[tauri::command]
pub async fn docker_get_logs(
    container_id: String,
    tail: Option<usize>,
    custom_host: Option<String>,
) -> Result<String, String> {
    let docker = create_docker_client(custom_host.as_deref())?;

    let tail_str = tail
        .map(|t| t.to_string())
        .unwrap_or_else(|| "100".to_string());
    let options = LogsOptions::<String> {
        stdout: true,
        stderr: true,
        tail: tail_str,
        timestamps: false,
        ..Default::default()
    };

    let mut stream = docker.logs(&container_id, Some(options));
    let mut output = String::new();

    while let Some(res) = stream.next().await {
        match res {
            Ok(output_chunk) => {
                output.push_str(&output_chunk.to_string());
            }
            Err(e) => {
                return Err(format!("Error reading logs for {container_id}: {e}"));
            }
        }
    }

    Ok(output)
}
