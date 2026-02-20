#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getPlatformAdapter } from '../platform/index.js';

// CRITICAL: All logging must go to stderr. stdout is reserved for JSON-RPC protocol.
const log = (message: string) => {
  console.error(`[DevWatch MCP] ${message}`);
};

async function main() {
  try {
    // Initialize platform adapter
    const adapter = getPlatformAdapter();
    const rootPid = process.ppid; // Parent process (VS Code extension host or Claude Code)
    const workspaceDirs = [process.cwd()];

    log(`Initializing with rootPid=${rootPid}, cwd=${process.cwd()}`);

    // Create MCP server
    const server = new McpServer({
      name: 'devwatch',
      version: '0.1.0',
    });

    // Tool 1: list_processes
    server.tool(
      'list_processes',
      'List all workspace processes tracked by DevWatch with PID, name, command, CPU, and memory usage',
      {
        filter: z.string().optional().describe('Filter by process name (case-insensitive substring match)'),
      },
      async (params) => {
        try {
          log(`list_processes called with filter="${params.filter || 'none'}"`);

          const processes = await adapter.getWorkspaceProcesses(rootPid, workspaceDirs);

          // Apply filter if provided
          let filtered = processes;
          if (params.filter) {
            const filterLower = params.filter.toLowerCase();
            filtered = processes.filter(p => p.name.toLowerCase().includes(filterLower));
          }

          log(`Found ${filtered.length} processes (${processes.length} total)`);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify(filtered, null, 2),
            }],
          };
        } catch (error) {
          log(`Error in list_processes: ${error}`);
          throw error;
        }
      }
    );

    // Tool 2: kill_process
    server.tool(
      'kill_process',
      'Kill a process by PID. Uses graceful SIGTERM with auto-escalation to SIGKILL after 5 seconds',
      {
        pid: z.number().int().positive().describe('Process ID to kill'),
        force: z.boolean().optional().describe('Force kill with SIGKILL immediately (default: false)'),
      },
      async (params) => {
        try {
          const { pid, force } = params;
          log(`kill_process called: pid=${pid}, force=${force || false}`);

          // Check if process is alive
          const isAlive = (checkPid: number): boolean => {
            try {
              process.kill(checkPid, 0);
              return true;
            } catch {
              return false;
            }
          };

          if (!isAlive(pid)) {
            const msg = `Process ${pid} is not running`;
            log(msg);
            return {
              content: [{
                type: 'text',
                text: msg,
              }],
            };
          }

          // Kill with SIGKILL immediately if force=true
          if (force) {
            await adapter.killProcess(pid, 'SIGKILL');
            const msg = `Process ${pid} killed with SIGKILL`;
            log(msg);
            return {
              content: [{
                type: 'text',
                text: msg,
              }],
            };
          }

          // Graceful kill: SIGTERM with auto-escalation
          await adapter.killProcess(pid, 'SIGTERM');
          log(`Sent SIGTERM to process ${pid}, waiting 5s for graceful exit`);

          // Wait up to 5 seconds for process to die
          const startTime = Date.now();
          const timeout = 5000;

          while (Date.now() - startTime < timeout) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (!isAlive(pid)) {
              const msg = `Process ${pid} terminated gracefully`;
              log(msg);
              return {
                content: [{
                  type: 'text',
                  text: msg,
                }],
              };
            }
          }

          // Process still alive after 5s, escalate to SIGKILL
          log(`Process ${pid} did not respond to SIGTERM, escalating to SIGKILL`);
          await adapter.killProcess(pid, 'SIGKILL');
          const msg = `Process ${pid} killed with SIGKILL (escalated from SIGTERM)`;
          log(msg);
          return {
            content: [{
              type: 'text',
              text: msg,
            }],
          };
        } catch (error) {
          log(`Error in kill_process: ${error}`);
          throw error;
        }
      }
    );

    // Tool 3: check_port
    server.tool(
      'check_port',
      'Check if a port is in use and show which process owns it',
      {
        port: z.number().int().min(1).max(65535).describe('Port number to check'),
      },
      async (params) => {
        try {
          const { port } = params;
          log(`check_port called: port=${port}`);

          const ports = await adapter.getListeningPorts();
          const portInfo = ports.find(p => p.port === port);

          if (!portInfo) {
            const msg = `Port ${port} is free`;
            log(msg);
            return {
              content: [{
                type: 'text',
                text: msg,
              }],
            };
          }

          log(`Port ${port} is in use by PID ${portInfo.pid}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify(portInfo, null, 2),
            }],
          };
        } catch (error) {
          log(`Error in check_port: ${error}`);
          throw error;
        }
      }
    );

    // Tool 4: cleanup_orphans
    server.tool(
      'cleanup_orphans',
      'Find and kill orphaned processes (processes whose parent has died)',
      {},
      async () => {
        try {
          log('cleanup_orphans called');

          const processes = await adapter.getWorkspaceProcesses(rootPid, workspaceDirs);

          // Build set of all PIDs for parent lookup
          const allPids = new Set(processes.map(p => p.pid));

          // Identify orphans: ppid === 1 or parent not in process set
          // Exclude ppid === 0 (kernel) and ppid === rootPid (direct children of root)
          const orphans = processes.filter(p => {
            if (p.ppid === 0 || p.ppid === rootPid) {
              return false;
            }
            return p.ppid === 1 || !allPids.has(p.ppid);
          });

          log(`Found ${orphans.length} orphaned processes`);

          if (orphans.length === 0) {
            const msg = 'No orphaned processes found';
            return {
              content: [{
                type: 'text',
                text: msg,
              }],
            };
          }

          // Kill each orphan with SIGTERM
          const results = [];
          for (const orphan of orphans) {
            try {
              await adapter.killProcess(orphan.pid, 'SIGTERM');
              results.push(`Killed orphan ${orphan.pid} (${orphan.name})`);
              log(`Killed orphan ${orphan.pid} (${orphan.name})`);
            } catch (error) {
              results.push(`Failed to kill ${orphan.pid}: ${error}`);
              log(`Failed to kill orphan ${orphan.pid}: ${error}`);
            }
          }

          const msg = `Cleaned up ${orphans.length} orphaned processes:\n${results.join('\n')}`;
          return {
            content: [{
              type: 'text',
              text: msg,
            }],
          };
        } catch (error) {
          log(`Error in cleanup_orphans: ${error}`);
          throw error;
        }
      }
    );

    // Create stdio transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);

    log('DevWatch MCP Server running on stdio');
  } catch (error) {
    console.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

main();
