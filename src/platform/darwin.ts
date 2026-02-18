import { spawn } from 'child_process';
import { IPlatformAdapter } from '../types/platform';
import { ProcessInfo } from '../types/process';
import { PortInfo } from '../types/port';
import { execAsync } from '../utils/exec';

export class DarwinAdapter implements IPlatformAdapter {
  readonly platformName = 'darwin';

  async getListeningPorts(): Promise<PortInfo[]> {
    // Use lsof to find listening TCP ports
    // -iTCP: Internet files using TCP
    // -sTCP:LISTEN: Only LISTEN state
    // -P: inhibit port name conversion
    // -n: inhibit hostname conversion
    const result = await execAsync('lsof -iTCP -sTCP:LISTEN -P -n', {
      ignoreErrors: true, // lsof returns exit code 1 when no matches
    });

    if (!result.stdout.trim()) {
      return [];
    }

    const lines = result.stdout.trim().split('\n');
    const ports: PortInfo[] = [];

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split by whitespace
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;

      const command = parts[0];
      const pid = parseInt(parts[1], 10);
      // The name field containing address:port is typically at index 8
      const nameField = parts[8];

      if (isNaN(pid) || !nameField) continue;

      // Parse address:port from nameField (e.g., "*:3000" or "127.0.0.1:8080")
      const match = nameField.match(/^(.+):(\d+)$/);
      if (!match) continue;

      const address = match[1] === '*' ? '0.0.0.0' : match[1];
      const port = parseInt(match[2], 10);

      if (isNaN(port)) continue;

      ports.push({
        port,
        pid,
        protocol: 'TCP',
        state: 'LISTEN',
        address,
        processName: command,
      });
    }

    return ports;
  }

  async getWorkspaceProcesses(
    rootPid: number,
    workspaceFolders: string[]
  ): Promise<ProcessInfo[]> {
    // Get all processes with ps
    const result = await execAsync('ps -eo pid,ppid,pcpu,rss,comm');
    const lines = result.stdout.trim().split('\n');

    // Build parent-child map and all processes
    const parentMap = new Map<number, number[]>();
    const allProcesses = new Map<number, { pid: number; ppid: number; pcpu: string; rss: string; comm: string }>();

    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(/\s+/);
      if (parts.length < 5) continue;

      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const pcpu = parts[2];
      const rss = parts[3];
      const comm = parts.slice(4).join(' ');

      if (isNaN(pid) || isNaN(ppid)) continue;

      allProcesses.set(pid, { pid, ppid, pcpu, rss, comm });

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

    // For non-descendant processes owned by current user, check cwds
    const currentUid = process.getuid?.() ?? -1;
    const cwdMatched = new Set<number>();

    if (workspaceFolders.length > 0 && currentUid >= 0) {
      // Batch check cwds for all processes
      for (const [pid] of allProcesses) {
        if (descendants.has(pid)) continue;

        try {
          const cwdResult = await execAsync(`lsof -a -p ${pid} -d cwd -Fn`, {
            ignoreErrors: true,
            timeout: 1000,
          });

          if (cwdResult.stdout) {
            // lsof -Fn output format: lines starting with 'n' contain the path
            const cwdMatch = cwdResult.stdout.match(/^n(.+)$/m);
            if (cwdMatch) {
              const cwd = cwdMatch[1];
              for (const folder of workspaceFolders) {
                if (cwd.startsWith(folder)) {
                  cwdMatched.add(pid);
                  break;
                }
              }
            }
          }
        } catch {
          // Ignore errors for individual processes
        }
      }
    }

    // Union descendants + cwd-matched processes
    const targetPids = new Set([...descendants, ...cwdMatched]);
    const processInfos: ProcessInfo[] = [];

    for (const pid of targetPids) {
      const proc = allProcesses.get(pid);
      if (!proc) continue;

      const cpu = parseFloat(proc.pcpu);
      const rssKB = parseInt(proc.rss, 10);
      const memory = isNaN(rssKB) ? 0 : rssKB * 1024; // Convert KB to bytes

      processInfos.push({
        pid: proc.pid,
        ppid: proc.ppid,
        name: proc.comm,
        command: proc.comm,
        cpu: isNaN(cpu) ? 0 : cpu,
        memory,
        status: 'running',
      });
    }

    return processInfos;
  }

  async getProcessInfo(pid: number): Promise<ProcessInfo | null> {
    try {
      const result = await execAsync(`ps -p ${pid} -o pid,ppid,pcpu,rss,comm,args`, {
        ignoreErrors: true,
      });

      const lines = result.stdout.trim().split('\n');
      if (lines.length < 2) return null;

      const line = lines[1].trim();
      const parts = line.split(/\s+/);
      if (parts.length < 6) return null;

      const parsedPid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const pcpu = parseFloat(parts[2]);
      const rssKB = parseInt(parts[3], 10);
      const comm = parts[4];
      const args = parts.slice(5).join(' ');

      if (isNaN(parsedPid) || isNaN(ppid)) return null;

      return {
        pid: parsedPid,
        ppid,
        name: comm,
        command: args,
        cpu: isNaN(pcpu) ? 0 : pcpu,
        memory: isNaN(rssKB) ? 0 : rssKB * 1024, // Convert KB to bytes
        status: 'running',
      };
    } catch {
      return null;
    }
  }

  async getProcessChildren(pid: number): Promise<number[]> {
    const allChildren = new Set<number>();

    const collectChildren = async (parentPid: number) => {
      try {
        const result = await execAsync(`pgrep -P ${parentPid}`, {
          ignoreErrors: true,
          timeout: 5000,
        });

        if (!result.stdout.trim()) return;

        const children = result.stdout
          .trim()
          .split('\n')
          .map(line => parseInt(line.trim(), 10))
          .filter(childPid => !isNaN(childPid));

        for (const childPid of children) {
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

    // Map signal string to number
    const signalMap: Record<string, number> = {
      SIGTERM: 15,
      SIGKILL: 9,
      SIGHUP: 1,
    };

    const signalNumber = signalMap[signal];
    if (signalNumber === undefined) {
      throw new Error(`Unsupported signal: ${signal}`);
    }

    // Use spawn with array args for safety (prevent command injection)
    return new Promise<void>((resolve, reject) => {
      const proc = spawn('kill', [`-${signalNumber}`, `${pid}`]);

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
