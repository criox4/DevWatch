import * as vscode from 'vscode';
import type { PortScanner } from '../services/portScanner';
import type { PortLabeler } from '../services/portLabeler';
import type { ProcessRegistry } from '../services/processRegistry';
import type { PortInfo } from '../types/port';
import { PortItem, PortGroupItem } from './items/portItem';

/**
 * TreeDataProvider for port listing with Workspace/Other grouping
 */
export class PortTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Cached grouped port data
  private workspacePorts: PortInfo[] = [];
  private otherPorts: PortInfo[] = [];

  constructor(
    private readonly portScanner: PortScanner,
    private readonly portLabeler: PortLabeler,
    private readonly processRegistry: ProcessRegistry
  ) {}

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    // Root level: return group headers
    if (!element) {
      const allPorts = this.portScanner.getPorts();

      // Get workspace process PIDs
      const workspaceProcesses = this.processRegistry.getProcesses();
      const workspacePids = new Set(workspaceProcesses.map(p => p.pid));

      // Split ports into workspace and other groups
      const workspace: PortInfo[] = [];
      const other: PortInfo[] = [];

      for (const port of allPorts) {
        if (workspacePids.has(port.pid)) {
          workspace.push(port);
        } else {
          other.push(port);
        }
      }

      // Sort by port number
      workspace.sort((a, b) => a.port - b.port);
      other.sort((a, b) => a.port - b.port);

      // Cache for group children
      this.workspacePorts = workspace;
      this.otherPorts = other;

      // Build group items
      const groups: vscode.TreeItem[] = [];
      if (this.workspacePorts.length > 0) {
        groups.push(new PortGroupItem('Workspace Ports', this.workspacePorts.length, 'workspace'));
      }
      if (this.otherPorts.length > 0) {
        groups.push(new PortGroupItem('Other Ports', this.otherPorts.length, 'other'));
      }

      return groups;
    }

    // Group level: return port items for that group
    if (element instanceof PortGroupItem) {
      const ports = element.groupId === 'workspace' ? this.workspacePorts : this.otherPorts;
      const isWorkspace = element.groupId === 'workspace';
      return ports.map(port => {
        const label = this.portLabeler.getLabel(port.port, port.processName ?? '');
        return new PortItem(port, label, isWorkspace);
      });
    }

    return [];
  }
}
