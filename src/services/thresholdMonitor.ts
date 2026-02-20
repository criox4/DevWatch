import * as vscode from 'vscode';
import type { ProcessInfo } from '../types/process';
import type { AlertManager } from './alertManager';
import type { ProcessActionService } from './processActionService';

export interface ThresholdBreach {
  pid: number;
  name: string;
  type: 'cpu' | 'memory';
  value: number;
  threshold: number;
  isCritical: boolean;
  consecutiveBreaches: number;
}

export class ThresholdMonitor implements vscode.Disposable {
  // Track consecutive breach counts per process per metric
  // Key: "${pid}-${type}" e.g., "1234-cpu"
  private breachCounts = new Map<string, number>();

  // Track which processes had breaches last tick (for clearing stale entries)
  private activeBreaches = new Set<string>();

  constructor(
    private readonly alertManager: AlertManager,
    private readonly actionService: ProcessActionService,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Check all processes against configured thresholds.
   * Called on every poll tick.
   * Only alerts after 2+ consecutive breaches (sustained).
   */
  checkProcesses(processes: ProcessInfo[]): void {
    const config = vscode.workspace.getConfiguration('devwatch');
    const cpuThreshold = config.get<number>('alertThresholdCpu', 80);
    const memoryThresholdMB = config.get<number>('alertThresholdMemoryMB', 500);
    const memoryThresholdBytes = memoryThresholdMB * 1024 * 1024;

    // Critical thresholds (hardcoded per requirements)
    const criticalCpuThreshold = 90;
    const criticalMemoryBytes = 1024 * 1024 * 1024; // 1GB

    const currentBreaches = new Set<string>();

    for (const proc of processes) {
      // CPU check
      if (proc.cpu >= cpuThreshold) {
        const key = `${proc.pid}-cpu`;
        const count = (this.breachCounts.get(key) ?? 0) + 1;
        this.breachCounts.set(key, count);
        currentBreaches.add(key);

        const isCritical = proc.cpu >= criticalCpuThreshold;

        // Alert after 2+ consecutive breaches (sustained), or immediately if critical
        if (count >= 2 || isCritical) {
          this.alertManager.notify(
            'threshold-cpu',
            `threshold-cpu-${proc.pid}`,
            `${proc.name} (PID ${proc.pid}) CPU at ${proc.cpu.toFixed(1)}% (threshold: ${cpuThreshold}%)`,
            isCritical ? 'error' : 'warning',
            [
              { label: 'Kill Process', callback: () => this.actionService.gracefulKill(proc.pid) },
              { label: 'Dismiss', callback: () => {} }
            ],
            isCritical
          );
        }
      }

      // Memory check
      if (proc.memory >= memoryThresholdBytes) {
        const key = `${proc.pid}-memory`;
        const count = (this.breachCounts.get(key) ?? 0) + 1;
        this.breachCounts.set(key, count);
        currentBreaches.add(key);

        const isCritical = proc.memory >= criticalMemoryBytes;

        if (count >= 2 || isCritical) {
          const memMB = (proc.memory / (1024 * 1024)).toFixed(0);
          this.alertManager.notify(
            'threshold-memory',
            `threshold-memory-${proc.pid}`,
            `${proc.name} (PID ${proc.pid}) using ${memMB}MB RAM (threshold: ${memoryThresholdMB}MB)`,
            isCritical ? 'error' : 'warning',
            [
              { label: 'Kill Process', callback: () => this.actionService.gracefulKill(proc.pid) },
              { label: 'Dismiss', callback: () => {} }
            ],
            isCritical
          );
        }
      }
    }

    // Clean up stale breach counts (processes no longer breaching)
    for (const key of this.breachCounts.keys()) {
      if (!currentBreaches.has(key)) {
        this.breachCounts.delete(key);
      }
    }
  }

  dispose(): void {
    this.breachCounts.clear();
    this.activeBreaches.clear();
  }
}
