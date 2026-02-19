import * as vscode from 'vscode';
import type { ProcessRegistry } from '../services/processRegistry';
import type { PortScanner } from '../services/portScanner';
import type { ProcessInfo } from '../types/process';
import { formatBytes } from '../utils/format';

/**
 * DevWatch status bar item showing process/port counts with alert coloring and tooltips
 */
export class DevWatchStatusBar implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;

  constructor(
    private readonly processRegistry: ProcessRegistry,
    private readonly portScanner: PortScanner
  ) {
    // Create status bar item on the left side
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );

    // Set command for click handling (will be registered in Plan 05)
    this.statusBarItem.command = 'devwatch.openOverview';

    // Show immediately
    this.statusBarItem.show();
  }

  /**
   * Update status bar text, tooltip, and alert colors based on current state
   */
  update(): void {
    const processCount = this.processRegistry.count;
    const portCount = this.portScanner.count;

    // 1. Set text with codicon counts
    this.statusBarItem.text = `$(pulse) ${processCount} · $(plug) ${portCount}`;

    // 2. Build tooltip with top 3 resource consumers
    this.statusBarItem.tooltip = this.buildTooltip();

    // 3. Apply alert colors based on zombie process detection
    this.applyAlertColors();
  }

  /**
   * Build markdown tooltip showing top 3 CPU consumers
   */
  private buildTooltip(): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    tooltip.isTrusted = true;
    tooltip.supportHtml = false;

    tooltip.appendMarkdown('**DevWatch**\n\n');

    const processes = this.processRegistry.getProcesses();

    if (processes.length === 0) {
      tooltip.appendMarkdown('No processes being monitored\n\n');
      tooltip.appendMarkdown('Click to open DevWatch overview');
      return tooltip;
    }

    // Sort by CPU descending, take top 3
    const topProcesses = processes
      .slice()
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, 3);

    tooltip.appendMarkdown('**Top Resource Consumers**\n\n');
    tooltip.appendMarkdown('| Process | CPU | Memory |\n');
    tooltip.appendMarkdown('|---------|-----|--------|\n');

    for (const proc of topProcesses) {
      const cpu = proc.cpu.toFixed(1);
      const memory = formatBytes(proc.memory);
      tooltip.appendMarkdown(`| ${proc.name} | ${cpu}% | ${memory} |\n`);
    }

    tooltip.appendMarkdown('\nClick to open DevWatch overview');

    return tooltip;
  }

  /**
   * Apply alert background colors based on zombie process detection
   * - Normal (default): No special color
   * - Warning (yellow): Any zombie process detected
   * - Error (red): 3+ zombie processes
   */
  private applyAlertColors(): void {
    const processes = this.processRegistry.getProcesses();
    const zombieProcesses = processes.filter(p => p.status === 'zombie');
    const zombieCount = zombieProcesses.length;

    if (zombieCount >= 3) {
      // Error state: 3+ zombies
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground'
      );
    } else if (zombieCount > 0) {
      // Warning state: Any zombies
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
    } else {
      // Normal state: No zombies
      this.statusBarItem.backgroundColor = undefined;
    }
  }

  /**
   * Dispose the status bar item
   */
  dispose(): void {
    this.statusBarItem.dispose();
  }
}
