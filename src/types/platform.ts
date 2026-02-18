import { ProcessInfo } from './process';
import { PortInfo } from './port';

export interface IPlatformAdapter {
  getListeningPorts(): Promise<PortInfo[]>;
  getWorkspaceProcesses(rootPid: number, workspaceFolders: string[]): Promise<ProcessInfo[]>;
  getProcessInfo(pid: number): Promise<ProcessInfo | null>;
  getProcessChildren(pid: number): Promise<number[]>;
  killProcess(pid: number, signal: string): Promise<void>;
  readonly platformName: string;
}
