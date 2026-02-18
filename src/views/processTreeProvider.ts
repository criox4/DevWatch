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

  constructor(
    private readonly processRegistry: ProcessRegistry,
    private readonly portScanner: PortScanner
  ) {
    // Read initial config
    const config = vscode.workspace.getConfiguration('devwatch');
    this.showInfraProcesses = config.get<boolean>('showInfraProcesses', false);

    // Initialize to extension host's parent (VS Code main process)
    this.rootPid = process.ppid;
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
      this.vscodeRoots = this.filterInfraProcesses(vscodeGroup);
      this.externalRoots = this.filterInfraProcesses(externalGroup);

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
      return roots.map(root => {
        const ports = this.portScanner.getPortsByPid(root.process.pid);
        return new ProcessItem(root.process, ports, root.children.length > 0);
      });
    }

    // Process level: return child processes
    if (element instanceof ProcessItem) {
      const processTree = this.findProcessTree(element.process.pid);
      if (!processTree) {
        return [];
      }

      return processTree.children.map(child => {
        const ports = this.portScanner.getPortsByPid(child.process.pid);
        return new ProcessItem(child.process, ports, child.children.length > 0);
      });
    }

    return [];
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
