export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
  cwd?: string;
  startTime?: number;
  status: ProcessStatus;
}

export type ProcessStatus = 'running' | 'sleeping' | 'zombie' | 'stopped' | 'unknown';

export interface ProcessTree {
  process: ProcessInfo;
  children: ProcessTree[];
}
