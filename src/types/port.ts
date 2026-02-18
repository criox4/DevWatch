export interface PortInfo {
  port: number;
  pid: number;
  protocol: 'TCP' | 'UDP';
  state: PortState;
  address: string;
  processName?: string;
}

export type PortState = 'LISTEN' | 'ESTABLISHED' | 'CLOSE_WAIT' | 'TIME_WAIT' | 'unknown';
