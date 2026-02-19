import * as vscode from 'vscode';
import type { ProcessInfo } from '../../types/process';
import type { PortInfo } from '../../types/port';
import { formatBytes } from '../../utils/format';

/**
 * Group header for process tree sections (VS Code Processes / External Processes)
 */
export class ProcessGroupItem extends vscode.TreeItem {
  public readonly groupId: 'vscode' | 'external';

  constructor(label: string, childCount: number, groupId: 'vscode' | 'external') {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.groupId = groupId;
    this.description = `(${childCount})`;
    this.iconPath = new vscode.ThemeIcon(
      groupId === 'vscode' ? 'symbol-folder' : 'globe'
    );
    this.contextValue = 'processGroup';
  }
}

/**
 * TreeItem for individual process in the tree
 */
export class ProcessItem extends vscode.TreeItem {
  public readonly process: ProcessInfo;

  constructor(process: ProcessInfo, ports: PortInfo[], hasChildren: boolean) {
    // Label: process name, optionally with port label prefix
    const label = process.name;
    super(label, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

    this.process = process;

    // Description: ultra-compact for narrow sidebar
    let description = `${process.cpu.toFixed(1)}% · ${formatBytes(process.memory)}`;
    if (ports.length > 0) {
      description += ` · :${ports.map(p => p.port).join(',')}`;
    }
    this.description = description;

    // Tooltip: full process details in markdown
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**PID:** ${process.pid}\n\n`);
    tooltip.appendMarkdown(`**Parent PID:** ${process.ppid}\n\n`);
    tooltip.appendMarkdown(`**Command:** ${process.command}\n\n`);
    tooltip.appendMarkdown(`**CPU:** ${process.cpu.toFixed(1)}%\n\n`);
    tooltip.appendMarkdown(`**Memory:** ${formatBytes(process.memory)}\n\n`);
    if (ports.length > 0) {
      tooltip.appendMarkdown(`**Ports:** ${ports.map(p => p.port).join(', ')}\n\n`);
    }
    tooltip.appendMarkdown(`**Status:** ${process.status}\n\n`);
    this.tooltip = tooltip;

    // Icon: status-aware with distinct shapes and colors
    switch (process.status) {
      case 'running':
      case 'sleeping':
        this.iconPath = new vscode.ThemeIcon('run', new vscode.ThemeColor('charts.green'));
        break;
      case 'zombie':
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
        break;
      case 'stopped':
        this.iconPath = new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('descriptionForeground'));
        break;
      case 'unknown':
        this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('charts.yellow'));
        break;
    }

    this.contextValue = 'process';
  }
}
