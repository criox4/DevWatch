/**
 * Dashboard state management - simplified types for webview context
 */

export interface ProcessData {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
  status: string;
  isOrphan: boolean;
  ports: number[];
  startTime: number;
  category: 'VS Code' | 'Dev Servers' | 'Tools' | 'Docker' | 'Other';
}

export interface PortData {
  port: number;
  pid: number;
  protocol: string;
  state: string;
  processName: string | null;
  label?: string;
}

export interface AlertData {
  id: string;
  type: 'crash' | 'orphan' | 'threshold' | 'port-conflict';
  message: string;
  severity: 'error' | 'warning' | 'info';
  pid?: number;
}

export interface ResourceHistory {
  cpu: number[];
  memory: number[];
  timestamps: number[];
}

export interface FilterState {
  text: string;
  chips: Set<string>;
}

export class DashboardState {
  processes: ProcessData[] = [];
  ports: PortData[] = [];
  resourceHistory = new Map<number, ResourceHistory>(); // per-process history for sparklines
  aggregateHistory: ResourceHistory = { cpu: [], memory: [], timestamps: [] }; // combined
  alerts: AlertData[] = [];
  dismissedAlerts = new Set<string>();
  filter: FilterState = { text: '', chips: new Set() };
  timeWindow = 300000; // 5 minutes default
  sessionStart = Date.now();

  /**
   * Update state with new data from extension host
   */
  update(data: {
    processes: any[];
    ports: any[];
    resourceHistory?: Record<string, ResourceHistory>;
    aggregateHistory?: ResourceHistory;
    timestamp: number;
  }): void {
    // Convert and categorize processes
    this.processes = data.processes.map(p => ({
      pid: p.pid,
      ppid: p.ppid,
      name: p.name,
      command: p.command,
      cpu: p.cpu,
      memory: p.memory,
      status: p.status,
      isOrphan: p.isOrphan ?? false,
      ports: data.ports.filter(port => port.pid === p.pid).map(port => port.port),
      startTime: p.startTime ?? Date.now(),
      category: this.categorizeProcess(p)
    }));

    // Convert ports
    this.ports = data.ports.map(p => ({
      port: p.port,
      pid: p.pid,
      protocol: p.protocol,
      state: p.state,
      processName: p.processName ?? null,
      label: p.label
    }));

    // Update resource history from extension host (comes as plain object, convert to Map)
    if (data.resourceHistory) {
      this.resourceHistory.clear();
      for (const [pidStr, history] of Object.entries(data.resourceHistory)) {
        const pid = parseInt(pidStr, 10);
        this.resourceHistory.set(pid, history);
      }
    }

    // Update aggregate history from extension host
    if (data.aggregateHistory) {
      this.aggregateHistory = data.aggregateHistory;
    }

    // Generate active alerts
    this.alerts = this.getActiveAlerts();
  }

  /**
   * Trim history arrays to keep only data within time window
   */
  private trimHistory(history: ResourceHistory): void {
    const cutoff = Date.now() - this.timeWindow;
    let firstValidIndex = 0;

    for (let i = 0; i < history.timestamps.length; i++) {
      if (history.timestamps[i] >= cutoff) {
        firstValidIndex = i;
        break;
      }
    }

    if (firstValidIndex > 0) {
      history.cpu = history.cpu.slice(firstValidIndex);
      history.memory = history.memory.slice(firstValidIndex);
      history.timestamps = history.timestamps.slice(firstValidIndex);
    }
  }

  /**
   * Categorize a process based on name and command patterns
   */
  private categorizeProcess(proc: any): ProcessData['category'] {
    const name = proc.name.toLowerCase();
    const command = proc.command.toLowerCase();

    // VS Code
    if (/code|electron|extensionhost/i.test(name)) {
      return 'VS Code';
    }

    // Docker
    if (/docker|containerd/i.test(name)) {
      return 'Docker';
    }

    // Dev Servers (has ports and matches dev runtime patterns)
    const hasPorts = proc.ports?.length > 0;
    if (hasPorts && /node|python|java|ruby|go|rust|deno|bun/i.test(name)) {
      return 'Dev Servers';
    }

    // Tools
    if (/esbuild|webpack|vite|tsc|eslint|prettier|jest|vitest/i.test(name)) {
      return 'Tools';
    }

    return 'Other';
  }

  /**
   * Get processes filtered by current filter state
   */
  getFilteredProcesses(): ProcessData[] {
    let filtered = this.processes;

    // Apply text search
    if (this.filter.text) {
      const search = this.filter.text.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(search) ||
        p.command.toLowerCase().includes(search) ||
        p.pid.toString().includes(search) ||
        p.ports.some(port => port.toString().includes(search))
      );
    }

    // Apply chip filters
    if (this.filter.chips.has('running')) {
      filtered = filtered.filter(p => p.status === 'running' || p.status === 'sleeping');
    }
    if (this.filter.chips.has('orphans')) {
      filtered = filtered.filter(p => p.isOrphan);
    }
    if (this.filter.chips.has('with-ports')) {
      filtered = filtered.filter(p => p.ports.length > 0);
    }

    return filtered;
  }

  /**
   * Get ports filtered by current filter state
   */
  getFilteredPorts(): PortData[] {
    let filtered = this.ports;

    if (this.filter.text) {
      const search = this.filter.text.toLowerCase();
      filtered = filtered.filter(p =>
        p.port.toString().includes(search) ||
        (p.processName && p.processName.toLowerCase().includes(search)) ||
        p.protocol.toLowerCase().includes(search) ||
        p.pid.toString().includes(search)
      );
    }

    return filtered;
  }

  /**
   * Get processes grouped by category
   */
  getProcessesByCategory(): Map<ProcessData['category'], ProcessData[]> {
    const grouped = new Map<ProcessData['category'], ProcessData[]>();
    const categories: ProcessData['category'][] = ['VS Code', 'Dev Servers', 'Tools', 'Docker', 'Other'];

    for (const cat of categories) {
      grouped.set(cat, []);
    }

    const filtered = this.getFilteredProcesses();
    for (const proc of filtered) {
      const arr = grouped.get(proc.category);
      if (arr) {
        arr.push(proc);
      }
    }

    return grouped;
  }

  /**
   * Generate active alerts based on current state
   */
  getActiveAlerts(): AlertData[] {
    const alerts: AlertData[] = [];

    // Orphan alert (consolidated)
    const orphans = this.processes.filter(p => p.isOrphan);
    if (orphans.length > 0) {
      const alertId = 'orphans-detected';
      if (!this.dismissedAlerts.has(alertId)) {
        alerts.push({
          id: alertId,
          type: 'orphan',
          message: `${orphans.length} orphaned process${orphans.length > 1 ? 'es' : ''} detected`,
          severity: 'warning'
        });
      }
    }

    // High-resource processes (>90% CPU or >1GB memory)
    for (const proc of this.processes) {
      if (proc.cpu > 90) {
        const alertId = `high-cpu-${proc.pid}`;
        if (!this.dismissedAlerts.has(alertId)) {
          alerts.push({
            id: alertId,
            type: 'threshold',
            message: `${proc.name} using ${proc.cpu.toFixed(1)}% CPU`,
            severity: 'error',
            pid: proc.pid
          });
        }
      }
      if (proc.memory > 1024 * 1024 * 1024) {
        const alertId = `high-mem-${proc.pid}`;
        if (!this.dismissedAlerts.has(alertId)) {
          const memGB = (proc.memory / (1024 * 1024 * 1024)).toFixed(1);
          alerts.push({
            id: alertId,
            type: 'threshold',
            message: `${proc.name} using ${memGB}GB memory`,
            severity: 'error',
            pid: proc.pid
          });
        }
      }
    }

    return alerts;
  }

  /**
   * Dismiss an alert by ID
   */
  dismissAlert(id: string): void {
    this.dismissedAlerts.add(id);
    this.alerts = this.getActiveAlerts();
  }

  /**
   * Get visible aggregate history (within time window)
   */
  getVisibleAggregateHistory(): ResourceHistory {
    return this.filterHistoryByTimeWindow(this.aggregateHistory);
  }

  /**
   * Get visible process history (within time window)
   */
  getVisibleProcessHistory(pid: number): ResourceHistory | undefined {
    const history = this.resourceHistory.get(pid);
    if (!history) return undefined;
    return this.filterHistoryByTimeWindow(history);
  }

  /**
   * Filter history to only include data within current time window
   */
  private filterHistoryByTimeWindow(history: ResourceHistory): ResourceHistory {
    const cutoff = Date.now() - this.timeWindow;
    const filtered: ResourceHistory = { cpu: [], memory: [], timestamps: [] };

    for (let i = 0; i < history.timestamps.length; i++) {
      if (history.timestamps[i] >= cutoff) {
        filtered.cpu.push(history.cpu[i]);
        filtered.memory.push(history.memory[i]);
        filtered.timestamps.push(history.timestamps[i]);
      }
    }

    return filtered;
  }
}
