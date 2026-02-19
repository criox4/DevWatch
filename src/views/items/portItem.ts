import * as vscode from 'vscode';
import type { PortInfo } from '../../types/port';

/**
 * Group header for port sections (Workspace Ports / Other Ports)
 */
export class PortGroupItem extends vscode.TreeItem {
  public readonly groupId: 'workspace' | 'other';

  constructor(label: string, childCount: number, groupId: 'workspace' | 'other') {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.groupId = groupId;
    this.description = `(${childCount})`;
    this.iconPath = new vscode.ThemeIcon(
      groupId === 'workspace' ? 'plug' : 'cloud'
    );
    this.contextValue = 'portGroup';
  }
}

/**
 * TreeItem for individual port in the list
 */
export class PortItem extends vscode.TreeItem {
  public readonly port: PortInfo;

  constructor(port: PortInfo, label: string | undefined, isWorkspace: boolean) {
    // Label: use label if available, otherwise just port number
    const displayLabel = label ? `${label} (:${port.port})` : `:${port.port}`;
    super(displayLabel, vscode.TreeItemCollapsibleState.None);

    this.port = port;

    // Description: process name and PID, optionally with address
    let description = `${port.processName ?? 'unknown'} (PID ${port.pid})`;
    if (port.address !== '0.0.0.0') {
      description += ` | ${port.address}`;
    }
    this.description = description;

    // Tooltip: full port details in markdown
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**Port:** ${port.port}\n\n`);
    tooltip.appendMarkdown(`**Protocol:** ${port.protocol}\n\n`);
    tooltip.appendMarkdown(`**Address:** ${port.address}\n\n`);
    tooltip.appendMarkdown(`**Process:** ${port.processName ?? 'unknown'} (PID ${port.pid})\n\n`);
    tooltip.appendMarkdown(`**Label:** ${label ?? 'None'}\n\n`);
    tooltip.appendMarkdown(`**State:** ${port.state}\n\n`);
    this.tooltip = tooltip;

    // Icon: workspace ports use blue, external ports use green
    if (port.state === 'LISTEN') {
      if (isWorkspace) {
        this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
      } else {
        this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.green'));
      }
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    }

    this.contextValue = 'port';
  }
}
