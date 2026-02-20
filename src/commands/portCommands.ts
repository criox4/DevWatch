import * as vscode from 'vscode';
import type { PortTreeProvider } from '../views/portTreeProvider';
import type { ProcessActionService } from '../services/processActionService';
import type { PortScanner } from '../services/portScanner';
import { PortItem } from '../views/items/portItem';

/**
 * Register all port-related command handlers
 */
export function registerPortCommands(
  context: vscode.ExtensionContext,
  portProvider: PortTreeProvider,
  actionService: ProcessActionService,
  portScanner: PortScanner,
  killedPids?: Set<number>  // Optional for backward compat
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Copy actions

  disposables.push(
    vscode.commands.registerCommand('devwatch.copyPort', async (item: unknown) => {
      if (!(item instanceof PortItem)) {
        return;
      }

      const portString = item.port.port.toString();
      await vscode.env.clipboard.writeText(portString);
      vscode.window.showInformationMessage(`Copied port ${portString}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.copyPortJson', async (item: unknown) => {
      if (!(item instanceof PortItem)) {
        return;
      }

      const json = JSON.stringify(item.port, null, 2);
      await vscode.env.clipboard.writeText(json);
      vscode.window.showInformationMessage('Copied port as JSON');
    })
  );

  // Open in browser

  disposables.push(
    vscode.commands.registerCommand('devwatch.openInBrowser', async (item: unknown) => {
      if (!(item instanceof PortItem)) {
        return;
      }

      const url = `http://localhost:${item.port.port}`;
      await vscode.env.openExternal(vscode.Uri.parse(url));
      vscode.window.showInformationMessage(`Opened ${url}`);
    })
  );

  // Pinning (delegates to provider)

  disposables.push(
    vscode.commands.registerCommand('devwatch.pinPort', (item: unknown) => {
      if (!(item instanceof PortItem)) {
        return;
      }

      portProvider.togglePin(item.port.port);
      const isPinned = portProvider.isPinned(item.port.port);
      vscode.window.showInformationMessage(`${isPinned ? 'Pinned' : 'Unpinned'} port ${item.port.port}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.unpinPort', (item: unknown) => {
      if (!(item instanceof PortItem)) {
        return;
      }

      portProvider.togglePin(item.port.port);
      const isPinned = portProvider.isPinned(item.port.port);
      vscode.window.showInformationMessage(`${isPinned ? 'Pinned' : 'Unpinned'} port ${item.port.port}`);
    })
  );

  // Note: devwatch.viewInHistory is now registered in extension.ts (Phase 6)

  // Free Port command - kill process(es) holding a port

  disposables.push(
    vscode.commands.registerCommand('devwatch.freePort', async (item: unknown) => {
      if (!(item instanceof PortItem)) {
        return;
      }

      const targetPort = item.port.port;
      const targetPid = item.port.pid;

      // Find all processes on this port
      const allPorts = portScanner.getPorts();
      const processesOnPort = allPorts.filter(p => p.port === targetPort);

      if (processesOnPort.length === 0) {
        vscode.window.showInformationMessage(`Port ${targetPort} is already free`);
        return;
      }

      // Determine confirmation message
      let confirmMessage: string;
      if (processesOnPort.length === 1) {
        const processName = processesOnPort[0].processName || 'unknown';
        confirmMessage = `Kill ${processName} (PID ${targetPid}) on port :${targetPort}?`;
      } else {
        const names = processesOnPort.map(p => p.processName || 'unknown').join(', ');
        confirmMessage = `Kill ${processesOnPort.length} processes on port ${targetPort}? (${names})`;
      }

      // Show modal confirmation
      const action = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Kill'
      );

      if (action !== 'Kill') {
        return;
      }

      // Kill all processes on this port in parallel
      const killPromises = processesOnPort.map(p => actionService.gracefulKill(p.pid));
      const results = await Promise.all(killPromises);

      // Track killed PIDs for crash detection
      if (killedPids) {
        for (let i = 0; i < processesOnPort.length; i++) {
          if (results[i].success) {
            killedPids.add(processesOnPort[i].pid);
          }
        }
      }

      // Note: Logging to output channel is done by actionService.gracefulKill

      // Wait for cleanup
      await new Promise(r => setTimeout(r, 1000));

      // Show toast
      const failedCount = results.filter(r => !r.success).length;
      if (failedCount === 0) {
        vscode.window.showInformationMessage(`Freed port ${targetPort}`);
      } else {
        vscode.window.showErrorMessage(`Freed port ${targetPort} (${failedCount} failures - check output)`);
      }
    })
  );

  return disposables;
}
