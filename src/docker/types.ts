export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: 'running' | 'paused' | 'exited' | 'created' | 'restarting' | 'removing' | 'dead';
  status: string;         // Human-readable status like "Up 2 hours"
  ports: Array<{ hostPort: number; containerPort: number; protocol: string }>;
  composeProject?: string;  // Docker Compose project name
  composeService?: string;  // Docker Compose service name
}

export interface ComposeProject {
  name: string;
  containers: ContainerInfo[];
}
