import * as vscode from 'vscode';
import type { IPlatformAdapter } from '../types/platform';
import type { PortInfo } from '../types/port';

export class PortScanner implements vscode.Disposable {
  private ports: Map<number, PortInfo> = new Map();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  constructor(
    private readonly adapter: IPlatformAdapter,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  async scan(): Promise<void> {
    const newPorts = await this.adapter.getListeningPorts();
    const newMap = new Map<number, PortInfo>();

    for (const port of newPorts) {
      newMap.set(port.port, port);
    }

    // Diff: detect opened and closed ports
    const opened: PortInfo[] = [];
    const closed: PortInfo[] = [];

    // Find opened ports
    for (const [portNum, portInfo] of newMap) {
      if (!this.ports.has(portNum)) {
        opened.push(portInfo);
      }
    }

    // Find closed ports
    for (const [portNum, portInfo] of this.ports) {
      if (!newMap.has(portNum)) {
        closed.push(portInfo);
      }
    }

    // Log changes
    if (opened.length > 0) {
      this.outputChannel.appendLine(`[PortScanner] Opened ${opened.length} port(s):`);
      for (const port of opened) {
        this.outputChannel.appendLine(
          `  + Port ${port.port} (${port.protocol}) | PID ${port.pid} [${port.processName ?? 'unknown'}]`
        );
      }
    }

    if (closed.length > 0) {
      this.outputChannel.appendLine(`[PortScanner] Closed ${closed.length} port(s):`);
      for (const port of closed) {
        this.outputChannel.appendLine(
          `  - Port ${port.port} (${port.protocol}) | PID ${port.pid} [${port.processName ?? 'unknown'}]`
        );
      }
    }

    // Replace with new data
    this.ports = newMap;

    // Fire change event
    if (opened.length > 0 || closed.length > 0) {
      this._onDidChange.fire();
    }
  }

  getPorts(): PortInfo[] {
    return Array.from(this.ports.values());
  }

  getPortByNumber(port: number): PortInfo | undefined {
    return this.ports.get(port);
  }

  getPortsByPid(pid: number): PortInfo[] {
    return Array.from(this.ports.values()).filter(p => p.pid === pid);
  }

  get count(): number {
    return this.ports.size;
  }

  dispose(): void {
    this.ports.clear();
    this._onDidChange.dispose();
  }
}
