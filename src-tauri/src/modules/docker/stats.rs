use crate::modules::docker::types::DockerContainerStats;
use bollard::models::ContainerStatsResponse;

pub fn calculate_container_stats(
    id: String,
    name: String,
    stats: &ContainerStatsResponse,
) -> DockerContainerStats {
    let cpu_stats = stats.cpu_stats.as_ref().cloned().unwrap_or_default();
    let pre_cpu_stats = stats.precpu_stats.as_ref().cloned().unwrap_or_default();
    let cpu_usage = cpu_stats.cpu_usage.as_ref().cloned().unwrap_or_default();
    let pre_cpu_usage = pre_cpu_stats
        .cpu_usage
        .as_ref()
        .cloned()
        .unwrap_or_default();
    let cpu_delta =
        cpu_usage.total_usage.unwrap_or(0) as f64 - pre_cpu_usage.total_usage.unwrap_or(0) as f64;

    let system_delta = cpu_stats.system_cpu_usage.unwrap_or(0) as f64
        - pre_cpu_stats.system_cpu_usage.unwrap_or(0) as f64;

    let num_cpus = cpu_stats.online_cpus.unwrap_or_else(|| {
        cpu_usage
            .percpu_usage
            .as_ref()
            .map(|v| v.len() as u32)
            .unwrap_or(1)
    }) as f64;

    let cpu_percent = if system_delta > 0.0 && cpu_delta > 0.0 {
        ((cpu_delta / system_delta) * num_cpus * 100.0).max(0.0)
    } else {
        0.0
    };

    let memory_stats = stats.memory_stats.as_ref().cloned().unwrap_or_default();
    let memory_usage_bytes = memory_stats.usage.unwrap_or(0);
    let memory_limit_bytes = memory_stats.limit.unwrap_or(0);
    let memory_percent = if memory_limit_bytes > 0 {
        ((memory_usage_bytes as f64 / memory_limit_bytes as f64) * 100.0).min(100.0)
    } else {
        0.0
    };

    let mut net_rx_bytes = 0u64;
    let mut net_tx_bytes = 0u64;
    if let Some(networks) = &stats.networks {
        for net in networks.values() {
            net_rx_bytes += net.rx_bytes.unwrap_or(0);
            net_tx_bytes += net.tx_bytes.unwrap_or(0);
        }
    }

    let mut block_read_bytes = 0u64;
    let mut block_write_bytes = 0u64;
    if let Some(io_service) = stats
        .blkio_stats
        .as_ref()
        .and_then(|stats| stats.io_service_bytes_recursive.as_ref())
    {
        for entry in io_service {
            match entry
                .op
                .as_deref()
                .unwrap_or_default()
                .to_lowercase()
                .as_str()
            {
                "read" => block_read_bytes += entry.value.unwrap_or(0),
                "write" => block_write_bytes += entry.value.unwrap_or(0),
                _ => {}
            }
        }
    }

    let pids_current = stats
        .pids_stats
        .as_ref()
        .and_then(|stats| stats.current)
        .unwrap_or(0);

    DockerContainerStats {
        id,
        name,
        cpu_percent: (cpu_percent * 100.0).round() / 100.0,
        memory_usage_bytes,
        memory_limit_bytes,
        memory_percent: (memory_percent * 100.0).round() / 100.0,
        net_rx_bytes,
        net_tx_bytes,
        block_read_bytes,
        block_write_bytes,
        pids_current,
    }
}
