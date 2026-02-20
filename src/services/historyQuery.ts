import * as vscode from 'vscode';
import { HistoryEvent, HistoryFilters, AggregateStats, SessionSummary } from '../types/history';

export class HistoryQuery {
  private storageUri: vscode.Uri;
  private outputChannel: vscode.OutputChannel;

  constructor(storageUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
    this.storageUri = storageUri;
    this.outputChannel = outputChannel;
  }

  /**
   * Query history events with optional filters.
   * Returns newest events first, limited to 1000 max for performance.
   */
  async queryEvents(filters: HistoryFilters): Promise<HistoryEvent[]> {
    try {
      const allEvents = await this.loadAllEvents();
      let filtered = allEvents;

      // Apply filters in sequence
      if (filters.processName) {
        const searchName = filters.processName.toLowerCase();
        filtered = filtered.filter(e => e.name.toLowerCase().includes(searchName));
      }

      if (filters.port !== undefined) {
        filtered = filtered.filter(e => {
          // Check ports array for all events
          if (e.ports.includes(filters.port!)) {
            return true;
          }
          // Also check port-specific fields for port-bind and port-release events
          if ((e.type === 'port-bind' || e.type === 'port-release') && 'port' in e) {
            return e.port === filters.port;
          }
          return false;
        });
      }

      if (filters.eventType) {
        filtered = filtered.filter(e => e.type === filters.eventType);
      }

      if (filters.dateRange) {
        const { start, end } = filters.dateRange;
        filtered = filtered.filter(e => e.timestamp >= start && e.timestamp <= end);
      }

      // Sort by timestamp descending (newest first)
      filtered.sort((a, b) => b.timestamp - a.timestamp);

      // Limit to 1000 events to prevent memory issues
      if (filtered.length > 1000) {
        this.outputChannel.appendLine(`[HistoryQuery] Limiting results from ${filtered.length} to 1000 events`);
        filtered = filtered.slice(0, 1000);
      }

      return filtered;
    } catch (err) {
      this.outputChannel.appendLine(`[HistoryQuery] Query failed: ${err}`);
      return [];
    }
  }

  /**
   * Compute aggregate statistics from history events.
   * Optionally apply filters before aggregation.
   */
  async getAggregateStats(filters?: HistoryFilters): Promise<AggregateStats> {
    try {
      const events = filters ? await this.queryEvents(filters) : await this.loadAllEvents();

      // Initialize counters
      const portBindCounts = new Map<number, number>();
      const crashCounts = new Map<string, number>();
      let cpuSum = 0;
      let cpuCount = 0;
      let peakMemory = 0;

      // Track process lifetimes: start time by PID
      const processStarts = new Map<number, number>();
      const lifetimes: number[] = [];

      // Single pass over events
      for (const event of events) {
        // Count port binds
        if (event.type === 'port-bind' && 'port' in event) {
          const count = portBindCounts.get(event.port) || 0;
          portBindCounts.set(event.port, count + 1);
        }

        // Count crashes per process name
        if (event.type === 'crash') {
          const count = crashCounts.get(event.name) || 0;
          crashCounts.set(event.name, count + 1);
        }

        // Aggregate CPU from resource snapshots
        if (event.type === 'resource-snapshot' && 'cpu' in event) {
          cpuSum += event.cpu;
          cpuCount++;
        }

        // Track peak memory from resource snapshots
        if (event.type === 'resource-snapshot' && 'memory' in event) {
          peakMemory = Math.max(peakMemory, event.memory);
        }

        // Track process lifetimes
        if (event.type === 'start') {
          processStarts.set(event.pid, event.timestamp);
        }
        if ((event.type === 'stop' || event.type === 'crash') && processStarts.has(event.pid)) {
          const startTime = processStarts.get(event.pid)!;
          const lifetime = event.timestamp - startTime;
          lifetimes.push(lifetime);
          processStarts.delete(event.pid);
        }
      }

      // Build top 10 most-used ports sorted by count descending
      const mostUsedPorts = Array.from(portBindCounts.entries())
        .map(([port, count]) => ({ port, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Build top 5 crashers sorted by count descending
      const topCrashers = Array.from(crashCounts.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      // Compute averages
      const avgCpu = cpuCount > 0 ? cpuSum / cpuCount : 0;
      const avgLifetime = lifetimes.length > 0
        ? lifetimes.reduce((sum, lt) => sum + lt, 0) / lifetimes.length
        : 0;

      const totalEvents = events.length;
      const crashCount = crashCounts.size > 0
        ? Array.from(crashCounts.values()).reduce((sum, c) => sum + c, 0)
        : 0;

      return {
        mostUsedPorts,
        topCrashers,
        avgCpu,
        peakMemory,
        avgLifetime,
        totalEvents,
        crashCount
      };
    } catch (err) {
      this.outputChannel.appendLine(`[HistoryQuery] Aggregate stats failed: ${err}`);
      return {
        mostUsedPorts: [],
        topCrashers: [],
        avgCpu: 0,
        peakMemory: 0,
        avgLifetime: 0,
        totalEvents: 0,
        crashCount: 0
      };
    }
  }

  /**
   * Get a summary of the current session from sessionStart to now.
   */
  async getSessionSummary(sessionStart: number): Promise<SessionSummary> {
    try {
      const sessionEnd = Date.now();
      const events = await this.queryEvents({
        dateRange: { start: sessionStart, end: sessionEnd }
      });

      // Count unique PIDs from start events
      const uniquePids = new Set<number>();
      let crashCount = 0;
      let thresholdBreaches = 0;
      let orphansDetected = 0;

      for (const event of events) {
        if (event.type === 'start') {
          uniquePids.add(event.pid);
        }
        if (event.type === 'crash') {
          crashCount++;
        }
        if (event.type === 'threshold-breach') {
          thresholdBreaches++;
        }
        if (event.type === 'orphan-detected') {
          orphansDetected++;
        }
      }

      const hasAnomalies = crashCount > 0 || thresholdBreaches >= 3;

      // Compute top 3 consumers from resource snapshots
      const processCpu = new Map<string, number[]>();
      const processMemory = new Map<string, number[]>();

      for (const event of events) {
        if (event.type === 'resource-snapshot' && 'cpu' in event && 'memory' in event) {
          const cpuValues = processCpu.get(event.name) || [];
          cpuValues.push(event.cpu);
          processCpu.set(event.name, cpuValues);

          const memValues = processMemory.get(event.name) || [];
          memValues.push(event.memory);
          processMemory.set(event.name, memValues);
        }
      }

      const topConsumers = Array.from(processCpu.entries())
        .map(([name, cpuValues]) => {
          const avgCpu = cpuValues.reduce((sum, v) => sum + v, 0) / cpuValues.length;
          const memValues = processMemory.get(name) || [];
          const peakMemory = memValues.length > 0 ? Math.max(...memValues) : 0;
          return { name, avgCpu, peakMemory };
        })
        .sort((a, b) => b.avgCpu - a.avgCpu)
        .slice(0, 3);

      return {
        sessionStart,
        sessionEnd,
        totalProcesses: uniquePids.size,
        crashCount,
        thresholdBreaches,
        orphansDetected,
        hasAnomalies,
        topConsumers
      };
    } catch (err) {
      this.outputChannel.appendLine(`[HistoryQuery] Session summary failed: ${err}`);
      return {
        sessionStart,
        sessionEnd: Date.now(),
        totalProcesses: 0,
        crashCount: 0,
        thresholdBreaches: 0,
        orphansDetected: 0,
        hasAnomalies: false,
        topConsumers: []
      };
    }
  }

  /**
   * Load all history events from current and rotated NDJSON files.
   * Returns all events unsorted.
   */
  private async loadAllEvents(): Promise<HistoryEvent[]> {
    const events: HistoryEvent[] = [];

    try {
      // Read all NDJSON files in storage directory
      const files = await vscode.workspace.fs.readDirectory(this.storageUri);
      const historyFiles = files
        .filter(([name, type]) =>
          type === vscode.FileType.File &&
          (name === 'history.ndjson' || name.startsWith('history-'))
        )
        .map(([name]) => name);

      for (const filename of historyFiles) {
        try {
          const fileUri = vscode.Uri.joinPath(this.storageUri, filename);
          const bytes = await vscode.workspace.fs.readFile(fileUri);
          const content = new TextDecoder().decode(bytes);

          // Parse NDJSON: split by newline, filter empty, parse each line
          const lines = content.split('\n').filter(line => line.trim().length > 0);

          for (const line of lines) {
            try {
              const event = JSON.parse(line) as HistoryEvent;
              events.push(event);
            } catch (parseErr) {
              // Skip malformed lines, log warning
              this.outputChannel.appendLine(`[HistoryQuery] Skipping malformed line in ${filename}: ${parseErr}`);
            }
          }
        } catch (fileErr) {
          this.outputChannel.appendLine(`[HistoryQuery] Failed to read ${filename}: ${fileErr}`);
        }
      }

      this.outputChannel.appendLine(`[HistoryQuery] Loaded ${events.length} events from ${historyFiles.length} file(s)`);
    } catch (err) {
      this.outputChannel.appendLine(`[HistoryQuery] Failed to load history files: ${err}`);
    }

    return events;
  }
}
