import * as vscode from 'vscode';
import type { IPlatformAdapter } from '../types/platform';
import type { ProcessInfo, ProcessTree } from '../types/process';

export class ProcessRegistry implements vscode.Disposable {
  private processes: Map<number, ProcessInfo> = new Map();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  constructor(
    private readonly adapter: IPlatformAdapter,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async refresh(rootPid: number, workspaceFolders: string[]): Promise<void> {
    const newProcesses = await this.adapter.getWorkspaceProcesses(rootPid, workspaceFolders);
    const newMap = new Map<number, ProcessInfo>();

    for (const proc of newProcesses) {
      newMap.set(proc.pid, proc);
    }

    // Diff: detect added, removed, changed
    const added: ProcessInfo[] = [];
    const removed: ProcessInfo[] = [];
    const changed: ProcessInfo[] = [];

    // Find added and changed
    for (const [pid, newProc] of newMap) {
      const oldProc = this.processes.get(pid);
      if (!oldProc) {
        added.push(newProc);
      } else if (this.hasChanged(oldProc, newProc)) {
        changed.push(newProc);
      }
    }

    // Find removed
    for (const [pid, oldProc] of this.processes) {
      if (!newMap.has(pid)) {
        removed.push(oldProc);
      }
    }

    // Log changes
    if (added.length > 0) {
      this.outputChannel.appendLine(`[ProcessRegistry] Added ${added.length} process(es):`);
      for (const proc of added) {
        this.outputChannel.appendLine(`  + PID ${proc.pid}: ${proc.name}`);
      }
    }

    if (removed.length > 0) {
      this.outputChannel.appendLine(`[ProcessRegistry] Removed ${removed.length} process(es):`);
      for (const proc of removed) {
        this.outputChannel.appendLine(`  - PID ${proc.pid}: ${proc.name}`);
      }
    }

    if (changed.length > 0) {
      this.outputChannel.appendLine(`[ProcessRegistry] Changed ${changed.length} process(es):`);
      for (const proc of changed) {
        this.outputChannel.appendLine(`  ~ PID ${proc.pid}: ${proc.name}`);
      }
    }

    // Replace with new data
    this.processes = newMap;

    // Fire change event
    if (added.length > 0 || removed.length > 0 || changed.length > 0) {
      this._onDidChange.fire();
    }
  }

  getProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  getProcess(pid: number): ProcessInfo | undefined {
    return this.processes.get(pid);
  }

  getProcessTree(): ProcessTree[] {
    const processMap = new Map<number, ProcessInfo>();
    const childrenMap = new Map<number, number[]>();

    // Build maps
    for (const proc of this.processes.values()) {
      processMap.set(proc.pid, proc);

      if (!childrenMap.has(proc.ppid)) {
        childrenMap.set(proc.ppid, []);
      }
      childrenMap.get(proc.ppid)!.push(proc.pid);
    }

    // Build tree recursively
    const buildTree = (pid: number): ProcessTree | null => {
      const proc = processMap.get(pid);
      if (!proc) {
        return null;
      }

      const childPids = childrenMap.get(pid) ?? [];
      const children: ProcessTree[] = [];

      for (const childPid of childPids) {
        const childTree = buildTree(childPid);
        if (childTree) {
          children.push(childTree);
        }
      }

      return { process: proc, children };
    };

    // Find root processes (those without parents in our set)
    const roots: ProcessTree[] = [];
    for (const proc of this.processes.values()) {
      if (!processMap.has(proc.ppid)) {
        const tree = buildTree(proc.pid);
        if (tree) {
          roots.push(tree);
        }
      }
    }

    return roots;
  }

  get count(): number {
    return this.processes.size;
  }

  dispose(): void {
    this.processes.clear();
    this._onDidChange.dispose();
  }

  private hasChanged(oldProc: ProcessInfo, newProc: ProcessInfo): boolean {
    return (
      oldProc.cpu !== newProc.cpu ||
      oldProc.memory !== newProc.memory ||
      oldProc.status !== newProc.status ||
      oldProc.command !== newProc.command
    );
  }
}
