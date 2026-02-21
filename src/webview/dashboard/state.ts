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
  filter: FilterState = { text: '', chips: new Set() };
  timeWindow = 300000; // 5 minutes default
  sessionStart = Date.now();

  /**
   * Update state with new data from extension host
   */
  update(data: {
    processes: any[];
    ports: any[];
    orphans?: number[];
    timestamp: number;
  }): void {
    const orphanSet = new Set(data.orphans ?? []);

    // Convert and categorize processes
    this.processes = data.processes.map(p => ({
      pid: p.pid,
      ppid: p.ppid,
      name: p.name,
      command: p.command,
      cpu: p.cpu,
      memory: p.memory,
      status: p.status,
      isOrphan: orphanSet.has(p.pid),
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

    // Update resource history
    const timestamp = data.timestamp;
    let totalCpu = 0;
    let totalMemory = 0;

    for (const proc of this.processes) {
      // Get or create history for this process
      let history = this.resourceHistory.get(proc.pid);
      if (!history) {
        history = { cpu: [], memory: [], timestamps: [] };
        this.resourceHistory.set(proc.pid, history);
      }

      // Append current sample
      history.cpu.push(proc.cpu);
      history.memory.push(proc.memory);
      history.timestamps.push(timestamp);

      // Trim old data beyond time window
      this.trimHistory(history);

      // Accumulate for aggregate
      totalCpu += proc.cpu;
      totalMemory += proc.memory;
    }

    // Update aggregate history
    this.aggregateHistory.cpu.push(totalCpu);
    this.aggregateHistory.memory.push(totalMemory);
    this.aggregateHistory.timestamps.push(timestamp);
    this.trimHistory(this.aggregateHistory);

    // Clean up history for processes that no longer exist
    const currentPids = new Set(this.processes.map(p => p.pid));
    for (const pid of this.resourceHistory.keys()) {
      if (!currentPids.has(pid)) {
        this.resourceHistory.delete(pid);
      }
    }
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
}
