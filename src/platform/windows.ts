import { spawn } from 'child_process';
import * as path from 'path';
import { IPlatformAdapter } from '../types/platform';
import { ProcessInfo } from '../types/process';
import { PortInfo } from '../types/port';
import { execAsync } from '../utils/exec';

export class WindowsAdapter implements IPlatformAdapter {
  readonly platformName = 'win32';

  async getListeningPorts(): Promise<PortInfo[]> {
    try {
      // Primary: Use PowerShell Get-NetTCPConnection with process info
      const psCommand = `
        Get-NetTCPConnection -State Listen | ForEach-Object {
          $processName = ''
          try {
            $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
            $processName = $proc.ProcessName
          } catch {}
          [PSCustomObject]@{
            LocalPort = $_.LocalPort
            LocalAddress = $_.LocalAddress
            OwningProcess = $_.OwningProcess
            ProcessName = $processName
          }
        } | ConvertTo-Json
      `.trim();

      const result = await execAsync(`powershell -NoProfile -Command "${psCommand}"`, {
        ignoreErrors: true,
      });

      if (!result.stdout.trim()) {
        // Fallback to netstat
        return this.getListeningPortsFromNetstat();
      }

      // Parse JSON output
      let data: any;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        // Fallback to netstat if JSON parse fails
        return this.getListeningPortsFromNetstat();
      }

      // Normalize to array (single object vs multiple)
      const items = Array.isArray(data) ? data : [data];
      const ports: PortInfo[] = [];

      for (const item of items) {
        if (!item.LocalPort || !item.OwningProcess) continue;

        const port = parseInt(item.LocalPort, 10);
        const pid = parseInt(item.OwningProcess, 10);

        if (isNaN(port) || isNaN(pid)) continue;

        ports.push({
          port,
          pid,
          protocol: 'TCP',
          state: 'LISTEN',
          address: item.LocalAddress || '0.0.0.0',
          processName: item.ProcessName || '',
        });
      }

      return ports;
    } catch {
      // Fallback to netstat
      return this.getListeningPortsFromNetstat();
    }
  }

  private async getListeningPortsFromNetstat(): Promise<PortInfo[]> {
    try {
      // Fallback: Use netstat command
      // -a: all connections
      // -n: numeric addresses
      // -o: show owning PID
      const result = await execAsync('netstat -ano', { ignoreErrors: true });

      if (!result.stdout.trim()) return [];

      const lines = result.stdout.trim().split('\n');
      const ports: PortInfo[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('TCP')) continue;

        // Parse format: "  TCP    0.0.0.0:80    0.0.0.0:0    LISTENING    1234"
        const parts = trimmed.split(/\s+/);
        if (parts.length < 5) continue;

        const state = parts[3];
        if (state !== 'LISTENING') continue;

        const localAddress = parts[1];
        const pidStr = parts[4];

        // Parse address:port
        const colonIndex = localAddress.lastIndexOf(':');
        if (colonIndex === -1) continue;

        const address = localAddress.substring(0, colonIndex);
        const portStr = localAddress.substring(colonIndex + 1);
        const port = parseInt(portStr, 10);
        const pid = parseInt(pidStr, 10);

        if (isNaN(port) || isNaN(pid)) continue;

        // Get process name via tasklist
        let processName = '';
        try {
          const taskResult = await execAsync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, {
            ignoreErrors: true,
          });

          if (taskResult.stdout.trim()) {
            // Parse CSV format: "processname.exe","1234","Console","1","12,345 K"
            const match = taskResult.stdout.match(/^"([^"]+)"/);
            if (match) {
              processName = match[1].replace('.exe', '');
            }
          }
        } catch {
          // Ignore errors
        }

        ports.push({
          port,
          pid,
          protocol: 'TCP',
          state: 'LISTEN',
          address: address === '0.0.0.0' ? '0.0.0.0' : address,
          processName,
        });
      }

      return ports;
    } catch {
      return [];
    }
  }

  async getWorkspaceProcesses(
    rootPid: number,
    workspaceFolders: string[]
  ): Promise<ProcessInfo[]> {
    try {
      // Get all processes via PowerShell CIM
      const psCommand = `
        Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize | ConvertTo-Json
      `.trim();

      const result = await execAsync(`powershell -NoProfile -Command "${psCommand}"`, {
        ignoreErrors: true,
      });

      if (!result.stdout.trim()) return [];

      // Parse JSON output
      let data: any;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        return [];
      }

      // Normalize to array
      const items = Array.isArray(data) ? data : [data];

      // Build parent-child map and all processes
      const parentMap = new Map<number, number[]>();
      const allProcesses = new Map<number, {
        pid: number;
        ppid: number;
        name: string;
        command: string;
        memory: number;
      }>();

      for (const item of items) {
        if (!item.ProcessId) continue;

        const pid = parseInt(item.ProcessId, 10);
        const ppid = item.ParentProcessId ? parseInt(item.ParentProcessId, 10) : 0;

        if (isNaN(pid)) continue;

        const name = item.Name || 'unknown';
        const command = item.CommandLine || name;
        const memory = item.WorkingSetSize ? parseInt(item.WorkingSetSize, 10) : 0;

        allProcesses.set(pid, { pid, ppid, name, command, memory });

        if (!parentMap.has(ppid)) {
          parentMap.set(ppid, []);
        }
        parentMap.get(ppid)!.push(pid);
      }

      // Recursively collect all descendants of rootPid
      const descendants = new Set<number>();
      const collectDescendants = (pid: number) => {
        const children = parentMap.get(pid) || [];
        for (const child of children) {
          descendants.add(child);
          collectDescendants(child);
        }
      };
      collectDescendants(rootPid);

      // Note: Windows has no reliable way to get cwd of another process without admin privileges
      // So we only rely on process tree descent, not cwd matching

      const processInfos: ProcessInfo[] = [];

      for (const pid of descendants) {
        const proc = allProcesses.get(pid);
        if (!proc) continue;

        processInfos.push({
          pid: proc.pid,
          ppid: proc.ppid,
          name: path.basename(proc.name),
          command: proc.command,
          cpu: 0, // CPU % not available from Win32_Process without additional queries
          memory: proc.memory, // WorkingSetSize is already in bytes
          status: 'running',
          isOrphan: false, // Will be set by ProcessRegistry during refresh
        });
      }

      return processInfos;
    } catch {
      return [];
    }
  }

  async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
    try {
      const psCommand = `
        Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize | ConvertTo-Json
      `.trim();

      const result = await execAsync(`powershell -NoProfile -Command "${psCommand}"`, {
        ignoreErrors: true,
      });

      if (!result.stdout.trim()) return null;

      // Parse JSON output
      let data: any;
      try {
        data = JSON.parse(result.stdout);
      } catch {
        return null;
      }

      if (!data.ProcessId) return null;

      const parsedPid = parseInt(data.ProcessId, 10);
      const ppid = data.ParentProcessId ? parseInt(data.ParentProcessId, 10) : 0;
      const name = data.Name || 'unknown';
      const command = data.CommandLine || name;
      const memory = data.WorkingSetSize ? parseInt(data.WorkingSetSize, 10) : 0;

      if (isNaN(parsedPid)) return null;

      return {
        pid: parsedPid,
        ppid,
        name: path.basename(name),
        command,
        cpu: 0, // CPU % not available from Win32_Process
        memory,
        status: 'running',
        isOrphan: false, // Will be set by ProcessRegistry during refresh
      };
    } catch {
      return null;
    }
  }

  async getProcessChildren(pid: number): Promise<number[]> {
    const allChildren = new Set<number>();

    const collectChildren = async (parentPid: number) => {
      try {
        const psCommand = `
          Get-CimInstance Win32_Process -Filter "ParentProcessId=${parentPid}" | Select-Object ProcessId | ConvertTo-Json
        `.trim();

        const result = await execAsync(`powershell -NoProfile -Command "${psCommand}"`, {
          ignoreErrors: true,
          timeout: 5000,
        });

        if (!result.stdout.trim()) return;

        // Parse JSON output
        let data: any;
        try {
          data = JSON.parse(result.stdout);
        } catch {
          return;
        }

        // Normalize to array
        const items = Array.isArray(data) ? data : [data];

        for (const item of items) {
          if (!item.ProcessId) continue;

          const childPid = parseInt(item.ProcessId, 10);
          if (isNaN(childPid)) continue;

          if (!allChildren.has(childPid)) {
            allChildren.add(childPid);
            await collectChildren(childPid);
          }
        }
      } catch {
        // Ignore errors
      }
    };

    await collectChildren(pid);
    return Array.from(allChildren);
  }

  async killProcess(pid: number, signal: string): Promise<void> {
    // Validate pid is a positive integer
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Invalid PID: ${pid}`);
    }

    // Map signal to taskkill flags
    // SIGTERM: graceful shutdown (sends WM_CLOSE)
    // SIGKILL: force kill
    // SIGHUP: treat as SIGTERM on Windows
    const isForce = signal === 'SIGKILL';

    // Use spawn with array args for safety (prevent command injection)
    return new Promise<void>((resolve, reject) => {
      const args = ['/PID', String(pid)];
      if (isForce) {
        args.push('/F'); // Force flag for SIGKILL
      }

      const proc = spawn('taskkill', args);

      let stderr = '';
      proc.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      proc.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Failed to kill process ${pid}: ${stderr}`));
        }
      });

      proc.on('error', err => {
        reject(err);
      });
    });
  }
}
