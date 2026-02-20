import * as vscode from 'vscode';
import { HistoryEvent, SessionSummary } from '../types/history';

export class SessionSummaryService {
  private crashCount = 0;
  private thresholdBreaches = 0;
  private orphansDetected = 0;
  private processNames = new Set<string>();
  private cpuSamples: Array<{ name: string; cpu: number; memory: number }> = [];

  constructor(
    private readonly sessionStart: number,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Record a history event and update session statistics incrementally.
   * Called for every event logged by HistoryLogger.
   */
  recordEvent(event: HistoryEvent): void {
    switch (event.type) {
      case 'crash':
        this.crashCount++;
        break;

      case 'threshold-breach':
        this.thresholdBreaches++;
        break;

      case 'orphan-detected':
        this.orphansDetected++;
        break;

      case 'start':
        this.processNames.add(event.name);
        break;

      case 'resource-snapshot':
        // Keep only last 100 samples per process to cap memory
        this.cpuSamples.push({
          name: event.name,
          cpu: event.cpu,
          memory: event.memory,
        });
        // Simple trimming - keep last 1000 total samples
        if (this.cpuSamples.length > 1000) {
          this.cpuSamples = this.cpuSamples.slice(-1000);
        }
        break;
    }
  }

  /**
   * Quick check if session has anomalies worth reporting.
   * Used by deactivate() to decide whether to show summary.
   */
  get hasAnomalies(): boolean {
    return this.crashCount > 0 || this.thresholdBreaches >= 3;
  }

  /**
   * Generate session summary synchronously.
   * Fast operation - all stats tracked incrementally.
   */
  generateSummary(): SessionSummary {
    const sessionEnd = Date.now();

    // Calculate top consumers from CPU samples
    const topConsumers = this.calculateTopConsumers();

    return {
      sessionStart: this.sessionStart,
      sessionEnd,
      totalProcesses: this.processNames.size,
      crashCount: this.crashCount,
      thresholdBreaches: this.thresholdBreaches,
      orphansDetected: this.orphansDetected,
      hasAnomalies: this.hasAnomalies,
      topConsumers,
    };
  }

  /**
   * Calculate top 3 CPU consumers from resource snapshots.
   * Groups by process name, computes average CPU and peak memory.
   */
  private calculateTopConsumers(): Array<{
    name: string;
    avgCpu: number;
    peakMemory: number;
  }> {
    if (this.cpuSamples.length === 0) {
      return [];
    }

    // Group samples by process name
    const byProcess = new Map<
      string,
      { cpuSum: number; cpuCount: number; peakMemory: number }
    >();

    for (const sample of this.cpuSamples) {
      const existing = byProcess.get(sample.name) ?? {
        cpuSum: 0,
        cpuCount: 0,
        peakMemory: 0,
      };

      existing.cpuSum += sample.cpu;
      existing.cpuCount++;
      existing.peakMemory = Math.max(existing.peakMemory, sample.memory);

      byProcess.set(sample.name, existing);
    }

    // Calculate averages and sort by avgCpu descending
    const results = Array.from(byProcess.entries())
      .map(([name, stats]) => ({
        name,
        avgCpu: stats.cpuSum / stats.cpuCount,
        peakMemory: stats.peakMemory,
      }))
      .sort((a, b) => b.avgCpu - a.avgCpu);

    // Return top 3
    return results.slice(0, 3);
  }
}
