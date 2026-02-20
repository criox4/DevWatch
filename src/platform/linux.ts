import { spawn } from 'child_process';
import * as path from 'path';
import { readlink } from 'fs/promises';
import { IPlatformAdapter } from '../types/platform';
import { ProcessInfo } from '../types/process';
import { PortInfo } from '../types/port';
import { execAsync } from '../utils/exec';

export class LinuxAdapter implements IPlatformAdapter {
  readonly platformName = 'linux';

  async getListeningPorts(): Promise<PortInfo[]> {
    try {
      // Primary: Use ss command for reliable port scanning
      // -t: TCP sockets only
      // -u: UDP sockets (we'll filter to TCP only)
      // -l: listening sockets only
      // -p: show process using socket
      // -n: numeric addresses (don't resolve)
      const result = await execAsync('ss -tulpn', { ignoreErrors: true });

      if (!result.stdout.trim()) {
        // Fallback to /proc if ss unavailable
        return this.getListeningPortsFromProc();
      }

      const lines = result.stdout.trim().split('\n');
      const ports: PortInfo[] = [];

      // Skip header line (starts with "Netid")
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse ss output format:
        // tcp   LISTEN 0      128          0.0.0.0:80         0.0.0.0:*    users:(("nginx",pid=1234,fd=3))
        const parts = line.split(/\s+/);
        if (parts.length < 5) continue;

        const protocol = parts[0].toUpperCase();
        const state = parts[1];

        // Only include TCP LISTEN sockets
        if (protocol !== 'TCP' || state !== 'LISTEN') continue;

        const localAddress = parts[4];

        // Parse address:port (handles IPv4 0.0.0.0:80, IPv6 [::]:80 or :::80)
        const portMatch = localAddress.match(/:(\d+)$/);
        if (!portMatch) continue;

        const port = parseInt(portMatch[1], 10);
        if (isNaN(port)) continue;

        // Extract address (normalize IPv6)
        let address = localAddress.substring(0, localAddress.lastIndexOf(':'));
        if (address === '[::]' || address === '::') {
          address = '::';
        } else if (address.startsWith('[') && address.endsWith(']')) {
          address = address.slice(1, -1);
        }

        // Parse users field: users:(("processName",pid=1234,fd=3))
        let pid = 0;
        let processName = '';

        const usersIndex = parts.findIndex(p => p.startsWith('users:'));
        if (usersIndex >= 0) {
          const usersField = parts.slice(usersIndex).join(' ');
          const pidMatch = usersField.match(/pid=(\d+)/);
          const nameMatch = usersField.match(/\(\("([^"]+)"/);

          if (pidMatch) {
            pid = parseInt(pidMatch[1], 10);
          }
          if (nameMatch) {
            processName = nameMatch[1];
          }
        }

        if (pid > 0) {
          ports.push({
            port,
            pid,
            protocol: 'TCP',
            state: 'LISTEN',
            address,
            processName,
          });
        }
      }

      return ports;
    } catch {
      // Fallback to /proc if ss command fails
      return this.getListeningPortsFromProc();
    }
  }

  private async getListeningPortsFromProc(): Promise<PortInfo[]> {
    try {
      // Read /proc/net/tcp for IPv4 listening sockets
      const result = await execAsync('cat /proc/net/tcp', { ignoreErrors: true });
      if (!result.stdout.trim()) return [];

      const lines = result.stdout.trim().split('\n');
      const ports: PortInfo[] = [];

      // Skip header line
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Format: sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
        const parts = line.split(/\s+/);
        if (parts.length < 10) continue;

        const localAddress = parts[1];
        const state = parts[3];

        // State 0A = LISTEN (hex)
        if (state !== '0A') continue;

        // Parse hex address:port (e.g., "00000000:0050" = 0.0.0.0:80)
        const addrParts = localAddress.split(':');
        if (addrParts.length !== 2) continue;

        const portHex = addrParts[1];
        const port = parseInt(portHex, 16);
        if (isNaN(port)) continue;

        const inode = parts[9];

        // Find PID by scanning /proc/*/fd/* for socket:[inode]
        const pid = await this.findPidByInode(inode);
        if (pid === 0) continue;

        // Get process name from /proc/{pid}/comm
        let processName = '';
        try {
          const commResult = await execAsync(`cat /proc/${pid}/comm`, { ignoreErrors: true });
          processName = commResult.stdout.trim();
        } catch {
          // Ignore
        }

        ports.push({
          port,
          pid,
          protocol: 'TCP',
          state: 'LISTEN',
          address: '0.0.0.0',
          processName,
        });
      }

      return ports;
    } catch {
      return [];
    }
  }

  private async findPidByInode(inode: string): Promise<number> {
    try {
      // Use find to locate socket inodes (faster than manually iterating)
      const result = await execAsync(
        `find /proc/*/fd -lname "socket:[${inode}]" 2>/dev/null | head -n1`,
        { ignoreErrors: true, timeout: 5000 }
      );

      if (!result.stdout.trim()) return 0;

      // Extract PID from path like /proc/1234/fd/3
      const match = result.stdout.match(/\/proc\/(\d+)\//);
      if (!match) return 0;

      return parseInt(match[1], 10);
    } catch {
      return 0;
    }
  }

  async getWorkspaceProcesses(
    rootPid: number,
    workspaceFolders: string[]
  ): Promise<ProcessInfo[]> {
    // Get all processes with ps (same format as Darwin)
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

    // For non-descendant processes, check cwds via /proc/{pid}/cwd
    const cwdMatched = new Set<number>();

    if (workspaceFolders.length > 0) {
      for (const [pid] of allProcesses) {
        if (descendants.has(pid)) continue;

        try {
          // Use readlink to get cwd from /proc (much faster than lsof on Linux)
          const cwd = await readlink(`/proc/${pid}/cwd`);
          for (const folder of workspaceFolders) {
            if (cwd.startsWith(folder)) {
              cwdMatched.add(pid);
              break;
            }
          }
        } catch {
          // Ignore errors (process may have exited, or no permission)
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
        name: path.basename(proc.comm),
        command: proc.comm,
        cpu: isNaN(cpu) ? 0 : cpu,
        memory,
        status: 'running',
        isOrphan: false, // Will be set by ProcessRegistry during refresh
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
        name: path.basename(comm),
        command: args,
        cpu: isNaN(pcpu) ? 0 : pcpu,
        memory: isNaN(rssKB) ? 0 : rssKB * 1024, // Convert KB to bytes
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
        // Primary: Use pgrep (same as Darwin)
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
        // Fallback: parse /proc/{pid}/task/*/children
        try {
          const result = await execAsync(`cat /proc/${parentPid}/task/*/children 2>/dev/null`, {
            ignoreErrors: true,
          });

          if (!result.stdout.trim()) return;

          const children = result.stdout
            .trim()
            .split(/\s+/)
            .map(pidStr => parseInt(pidStr, 10))
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

    // Map signal string to number (same as Darwin)
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
