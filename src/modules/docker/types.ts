export type DockerPortMapping = {
  ip: string | null;
  private_port: number;
  public_port: number | null;
  port_type: string;
};

export type DockerContainerInfo = {
  id: string;
  short_id: string;
  names: string[];
  image: string;
  image_id: string;
  command: string;
  created: number;
  state: "running" | "exited" | "paused" | "restarting" | string;
  status: string;
  ports: DockerPortMapping[];
  compose_project: string | null;
  compose_service: string | null;
};

export type DockerContainerStats = {
  id: string;
  name: string;
  cpu_percent: number;
  memory_usage_bytes: number;
  memory_limit_bytes: number;
  memory_percent: number;
  net_rx_bytes: number;
  net_tx_bytes: number;
  block_read_bytes: number;
  block_write_bytes: number;
  pids_current: number;
};

export type DockerDaemonStatus = {
  connected: boolean;
  version: string | null;
  os: string | null;
  containers_running: number;
  containers_total: number;
  images_count: number;
  driver: string | null;
  error: string | null;
};
