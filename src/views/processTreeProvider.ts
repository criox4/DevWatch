import * as vscode from 'vscode';
import type { ProcessRegistry } from '../services/processRegistry';
import type { PortScanner } from '../services/portScanner';
import type { ProcessTree } from '../types/process';
import { ProcessItem, ProcessGroupItem } from './items/processItem';

/**
 * TreeDataProvider for process hierarchy with VS Code/External grouping
 */
export class ProcessTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private showInfraProcesses: boolean;
  private rootPid: number;
  private readonly infraProcessNames = new Set([
    'bash',
    'zsh',
    'sh',
    'fish',
    'login',
    'sshd',
    'Code Helper',
    'Code Helper (Renderer)',
    'Code Helper (GPU)',
    'Code Helper (Plugin)',
    'electron',
    '.electron-wrapped',
  ]);

  // Cached grouped tree data
  private vscodeRoots: ProcessTree[] = [];
  private externalRoots: ProcessTree[] = [];

  // Pinning support
  private pinnedPids = new Set<number>();
  private context?: vscode.ExtensionContext;

  // Filtering support
  private activeFilter: string = 'all';

  constructor(
    private readonly processRegistry: ProcessRegistry,
    private readonly portScanner: PortScanner,
    context?: vscode.ExtensionContext
  ) {
    // Read initial config
    const config = vscode.workspace.getConfiguration('devwatch');
    this.showInfraProcesses = config.get<boolean>('showInfraProcesses', false);

    // Initialize to extension host's parent (VS Code main process)
    this.rootPid = process.ppid;

    // Load pinned PIDs from workspace state
    this.context = context;
    if (context) {
      const saved = context.workspaceState.get<number[]>('devwatch.pinnedProcesses', []);
      this.pinnedPids = new Set(saved);
    }
  }

  /**
   * Set the root PID (VS Code window process) for grouping logic
   */
  setRootPid(pid: number): void {
    this.rootPid = pid;
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    // Re-read config
    const config = vscode.workspace.getConfiguration('devwatch');
    this.showInfraProcesses = config.get<boolean>('showInfraProcesses', false);

    // Fire change event
    this._onDidChangeTreeData.fire();
  }

  /**
   * Toggle pin state for a process
   */
  togglePin(pid: number): void {
    if (this.pinnedPids.has(pid)) {
      this.pinnedPids.delete(pid);
    } else {
      this.pinnedPids.add(pid);
    }

    // Persist to workspace state
    if (this.context) {
      this.context.workspaceState.update('devwatch.pinnedProcesses', Array.from(this.pinnedPids));
    }

    // Refresh tree
    this.refresh();
  }

  /**
   * Check if a process is pinned
   */
  isPinned(pid: number): boolean {
    return this.pinnedPids.has(pid);
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
      const processTree = this.processRegistry.getProcessTree();

      // Separate into VS Code and External groups
      const vscodeGroup: ProcessTree[] = [];
      const externalGroup: ProcessTree[] = [];

      for (const root of processTree) {
        if (root.process.ppid === this.rootPid) {
          vscodeGroup.push(root);
        } else {
          externalGroup.push(root);
        }
      }

      // Apply infrastructure filtering
      let filteredVscode = this.filterInfraProcesses(vscodeGroup);
      let filteredExternal = this.filterInfraProcesses(externalGroup);

      // Apply active filter
      filteredVscode = this.applyActiveFilter(filteredVscode);
      filteredExternal = this.applyActiveFilter(filteredExternal);

      this.vscodeRoots = filteredVscode;
      this.externalRoots = filteredExternal;

      // Build group items
      const groups: vscode.TreeItem[] = [];
      if (this.vscodeRoots.length > 0) {
        groups.push(new ProcessGroupItem('VS Code Processes', this.vscodeRoots.length, 'vscode'));
      }
      if (this.externalRoots.length > 0) {
        groups.push(new ProcessGroupItem('External Processes', this.externalRoots.length, 'external'));
      }

      return groups;
    }

    // Group level: return process items for that group
    if (element instanceof ProcessGroupItem) {
      const roots = element.groupId === 'vscode' ? this.vscodeRoots : this.externalRoots;

      // Sort: pinned first, then by name
      const sorted = [...roots].sort((a, b) => {
        const aPin = this.isPinned(a.process.pid);
        const bPin = this.isPinned(b.process.pid);
        if (aPin && !bPin) return -1;
        if (!aPin && bPin) return 1;
        return a.process.name.localeCompare(b.process.name);
      });

      return sorted.map(root => {
        const ports = this.portScanner.getPortsByPid(root.process.pid);
        const item = new ProcessItem(root.process, ports, root.children.length > 0);

        // Set contextValue based on orphan + pin status
        const isPinned = this.isPinned(root.process.pid);
        item.contextValue = this.getContextValue(root.process.isOrphan, isPinned);

        // Add pin indicator to description if pinned
        if (isPinned) {
          item.description = `$(pinned) ${item.description}`;
        }

        return item;
      });
    }

    // Process level: return child processes
    if (element instanceof ProcessItem) {
      const processTree = this.findProcessTree(element.process.pid);
      if (!processTree) {
        return [];
      }

      // Sort: pinned first, then by name
      const sorted = [...processTree.children].sort((a, b) => {
        const aPin = this.isPinned(a.process.pid);
        const bPin = this.isPinned(b.process.pid);
        if (aPin && !bPin) return -1;
        if (!aPin && bPin) return 1;
        return a.process.name.localeCompare(b.process.name);
      });

      return sorted.map(child => {
        const ports = this.portScanner.getPortsByPid(child.process.pid);
        const item = new ProcessItem(child.process, ports, child.children.length > 0);

        // Set contextValue based on orphan + pin status
        const isPinned = this.isPinned(child.process.pid);
        item.contextValue = this.getContextValue(child.process.isOrphan, isPinned);

        // Add pin indicator to description if pinned
        if (isPinned) {
          item.description = `$(pinned) ${item.description}`;
        }

        return item;
      });
    }

    return [];
  }

  /**
   * Get context value for a process based on orphan and pin status
   */
  private getContextValue(isOrphan: boolean, isPinned: boolean): string {
    if (isOrphan && isPinned) {
      return 'pinnedOrphanProcess';
    }
    if (isOrphan && !isPinned) {
      return 'orphanProcess';
    }
    if (!isOrphan && isPinned) {
      return 'pinnedProcess';
    }
    return 'process';
  }

  /**
   * Apply active filter to process trees
   */
  private applyActiveFilter(trees: ProcessTree[]): ProcessTree[] {
    if (this.activeFilter === 'all') {
      return trees;
    }

    if (this.activeFilter === 'running') {
      // Only show running or sleeping processes
      return trees.filter(tree => {
        const status = tree.process.status;
        return status === 'running' || status === 'sleeping';
      });
    }

    if (this.activeFilter === 'with-ports') {
      // Only show processes with associated ports
      return trees.filter(tree => {
        const ports = this.portScanner.getPortsByPid(tree.process.pid);
        return ports.length > 0;
      });
    }

    if (this.activeFilter === 'orphans') {
      // Only show orphaned processes
      return trees.filter(tree => tree.process.isOrphan);
    }

    return trees;
  }

  /**
   * Filter out infrastructure processes if config is disabled
   */
  private filterInfraProcesses(trees: ProcessTree[]): ProcessTree[] {
    if (this.showInfraProcesses) {
      return trees;
    }

    return trees.filter(tree => {
      const nameLower = tree.process.name.toLowerCase();
      const isInfra = this.infraProcessNames.has(tree.process.name) ||
                      Array.from(this.infraProcessNames).some(infra => nameLower.includes(infra.toLowerCase()));

      // Keep if not infra, or if infra but has children (preserve tree structure)
      return !isInfra || tree.children.length > 0;
    });
  }

  /**
   * Find a ProcessTree node by PID in cached data
   */
  private findProcessTree(pid: number): ProcessTree | undefined {
    const search = (trees: ProcessTree[]): ProcessTree | undefined => {
      for (const tree of trees) {
        if (tree.process.pid === pid) {
          return tree;
        }
        const found = search(tree.children);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    return search([...this.vscodeRoots, ...this.externalRoots]);
  }
}
