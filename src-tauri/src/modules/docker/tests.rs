#[cfg(test)]
mod docker_stats_tests {
    use crate::modules::docker::stats::calculate_container_stats;
    use bollard::container::Stats;

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

        let stats: Stats =
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
}
