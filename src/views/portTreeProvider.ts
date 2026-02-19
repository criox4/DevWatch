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

  // Pinning support
  private pinnedPorts = new Set<number>();
  private context?: vscode.ExtensionContext;

  // Filtering support
  private activeFilter: string = 'all';

  constructor(
    private readonly portScanner: PortScanner,
    private readonly portLabeler: PortLabeler,
    private readonly processRegistry: ProcessRegistry,
    context?: vscode.ExtensionContext
  ) {
    // Load pinned ports from workspace state
    this.context = context;
    if (context) {
      const saved = context.workspaceState.get<number[]>('devwatch.pinnedPorts', []);
      this.pinnedPorts = new Set(saved);
    }
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Toggle pin state for a port
   */
  togglePin(port: number): void {
    if (this.pinnedPorts.has(port)) {
      this.pinnedPorts.delete(port);
    } else {
      this.pinnedPorts.add(port);
    }

    // Persist to workspace state
    if (this.context) {
      this.context.workspaceState.update('devwatch.pinnedPorts', Array.from(this.pinnedPorts));
    }

    // Refresh tree
    this.refresh();
  }

  /**
   * Check if a port is pinned
   */
  isPinned(port: number): boolean {
    return this.pinnedPorts.has(port);
  }

  /**
   * Set active filter and refresh tree
   */
  setFilter(filter: string): void {
    this.activeFilter = filter;
    this.refresh();
  }

  /**
   * Get current filter
   */
  getFilter(): string {
    return this.activeFilter;
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
      let workspace: PortInfo[] = [];
      let other: PortInfo[] = [];

      for (const port of allPorts) {
        if (workspacePids.has(port.pid)) {
          workspace.push(port);
        } else {
          other.push(port);
        }
      }

      // Apply active filter
      workspace = this.applyActiveFilter(workspace);
      other = this.applyActiveFilter(other);

      // Sort: pinned first, then by port number
      const sortPorts = (ports: PortInfo[]) => {
        ports.sort((a, b) => {
          const aPin = this.isPinned(a.port);
          const bPin = this.isPinned(b.port);
          if (aPin && !bPin) return -1;
          if (!aPin && bPin) return 1;
          return a.port - b.port;
        });
      };

      sortPorts(workspace);
      sortPorts(other);

      // Cache for group children
      this.workspacePorts = workspace;
      this.otherPorts = other;

      // Build group items
      const groups: vscode.TreeItem[] = [];
      if (this.workspacePorts.length > 0) {
        groups.push(new PortGroupItem('Workspace Ports', this.workspacePorts.length, 'workspace'));
      }
      // Only show "Other Ports" if filter is not 'workspace'
      if (this.otherPorts.length > 0 && this.activeFilter !== 'workspace') {
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
        const item = new PortItem(port, label, isWorkspace);

        // Set contextValue for pinned items
        if (this.isPinned(port.port)) {
          item.contextValue = 'pinnedPort';
          // Add pin indicator to description
          item.description = `$(pinned) ${item.description}`;
        }

        return item;
      });
    }

    return [];
  }

  /**
   * Apply active filter to ports
   */
  private applyActiveFilter(ports: PortInfo[]): PortInfo[] {
    if (this.activeFilter === 'all') {
      return ports;
    }

    if (this.activeFilter === 'listening') {
      // Only show listening ports
      return ports.filter(port => port.state === 'LISTEN');
    }

    if (this.activeFilter === 'workspace') {
      // This is already handled in getChildren by filtering groups
      // But we still need to return all workspace ports here
      return ports;
    }

    return ports;
  }
}
