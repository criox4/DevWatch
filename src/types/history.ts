export type HistoryEventType =
  | 'start'
  | 'stop'
  | 'crash'
  | 'port-bind'
  | 'port-release'
  | 'resource-snapshot'
  | 'orphan-detected'
  | 'threshold-breach';

export interface BaseHistoryEvent {
  type: HistoryEventType;
  timestamp: number; // UTC milliseconds via Date.now()
  pid: number;
  name: string;
  command: string;
  cwd: string | null;
  ports: number[];
}

export interface StartEvent extends BaseHistoryEvent {
  type: 'start';
}

export interface StopEvent extends BaseHistoryEvent {
  type: 'stop';
  exitReason: 'user-kill' | 'exited';
}

export interface CrashEvent extends BaseHistoryEvent {
  type: 'crash';
}

export interface PortBindEvent extends BaseHistoryEvent {
  type: 'port-bind';
  port: number;
  protocol: 'TCP' | 'UDP';
}

export interface PortReleaseEvent extends BaseHistoryEvent {
  type: 'port-release';
  port: number;
}

export interface ResourceSnapshotEvent extends BaseHistoryEvent {
  type: 'resource-snapshot';
  cpu: number;
  memory: number;
}

export interface OrphanDetectedEvent extends BaseHistoryEvent {
  type: 'orphan-detected';
  ppid: number;
}

export interface ThresholdBreachEvent extends BaseHistoryEvent {
  type: 'threshold-breach';
  metric: 'cpu' | 'memory';
  value: number;
  threshold: number;
}

export type HistoryEvent =
  | StartEvent
  | StopEvent
  | CrashEvent
  | PortBindEvent
  | PortReleaseEvent
  | ResourceSnapshotEvent
  | OrphanDetectedEvent
  | ThresholdBreachEvent;

export interface HistoryFilters {
  processName?: string; // partial match
  port?: number; // exact match
  eventType?: HistoryEventType;
  dateRange?: {
    start: number; // UTC ms
    end: number; // UTC ms
  };
}

export interface AggregateStats {
  mostUsedPorts: Array<{ port: number; count: number }>; // top 10
  topCrashers: Array<{ name: string; count: number }>; // top 5
  avgCpu: number;
  peakMemory: number;
  avgLifetime: number; // ms
  totalEvents: number;
  crashCount: number;
}

export interface SessionSummary {
  sessionStart: number; // UTC ms
  sessionEnd: number; // UTC ms
  totalProcesses: number;
  crashCount: number;
  thresholdBreaches: number;
  orphansDetected: number;
  hasAnomalies: boolean;
  topConsumers: Array<{
    name: string;
    avgCpu: number;
    peakMemory: number;
  }>; // top 3
}
