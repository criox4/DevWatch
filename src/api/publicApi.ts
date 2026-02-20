import * as vscode from 'vscode';
import type { ProcessInfo } from '../types/process';
import type { PortInfo } from '../types/port';
import type { ProcessRegistry } from '../services/processRegistry';
import type { PortScanner } from '../services/portScanner';

/**
 * Public API interface for DevWatch extension
 *
 * This API allows third-party extensions to register external processes
 * and query DevWatch's process and port tracking data.
 */
export interface DevWatchAPI {
  /** Extension version */
  readonly version: string;

  /**
   * Register an external process for tracking
   * @param pid Process ID to register
   * @param metadata Optional metadata (name, command, cwd)
   */
  registerProcess(pid: number, metadata?: { name?: string; command?: string; cwd?: string }): void;

  /**
   * Unregister a previously registered external process
   * @param pid Process ID to unregister
   */
  unregisterProcess(pid: number): void;

  /**
   * Get all tracked processes (both internal and externally registered)
   * @returns Array of all tracked ProcessInfo objects
   */
  getProcesses(): ProcessInfo[];

  /**
   * Get all listening ports
   * @returns Array of all PortInfo objects
   */
  getPorts(): PortInfo[];

  /**
   * Event fired when the process list changes
   */
  readonly onProcessChanged: vscode.Event<void>;
}

/**
 * Factory function to create the public API
 *
 * @param version Extension version string
 * @param processRegistry Internal ProcessRegistry instance
 * @param portScanner Internal PortScanner instance
 * @returns DevWatchAPI implementation
 */
export function createPublicApi(
  version: string,
  processRegistry: ProcessRegistry,
  portScanner: PortScanner
): DevWatchAPI {
  // Internal map for externally registered processes
  const externalProcesses = new Map<number, ProcessInfo>();

  // Event emitter for process changes
  const _onProcessChanged = new vscode.EventEmitter<void>();

  return {
    version,

    registerProcess(pid: number, metadata?: { name?: string; command?: string; cwd?: string }): void {
      const processInfo: ProcessInfo = {
        pid,
        ppid: 0, // External processes have no parent tracking
        name: metadata?.name || `Process ${pid}`,
        command: metadata?.command || '',
        cpu: 0,
        memory: 0,
        cwd: metadata?.cwd,
        status: 'running',
        isOrphan: false,
      };

      externalProcesses.set(pid, processInfo);
      _onProcessChanged.fire();
    },

    unregisterProcess(pid: number): void {
      if (externalProcesses.delete(pid)) {
        _onProcessChanged.fire();
      }
    },

    getProcesses(): ProcessInfo[] {
      // Union of internal processes and external processes
      const internal = processRegistry.getProcesses();
      const external = Array.from(externalProcesses.values());
      return [...internal, ...external];
    },

    getPorts(): PortInfo[] {
      return portScanner.getPorts();
    },

    get onProcessChanged(): vscode.Event<void> {
      return _onProcessChanged.event;
    },
  };
}
