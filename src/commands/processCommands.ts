import * as vscode from 'vscode';
import type { ProcessTreeProvider } from '../views/processTreeProvider';
import { ProcessItem } from '../views/items/processItem';
import { ProcessActionService } from '../services/processActionService';

/**
 * Register all process-related command handlers
 */
export function registerProcessCommands(
  context: vscode.ExtensionContext,
  processProvider: ProcessTreeProvider,
  actionService: ProcessActionService
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Destructive actions

  disposables.push(
    vscode.commands.registerCommand('devwatch.killProcess', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;

      // Check if process is still alive
      if (!actionService.isProcessAlive(pid)) {
        vscode.window.showInformationMessage(`Process ${name} (PID ${pid}) already terminated`);
        return;
      }

      // Regular kill requires NO confirmation per CONTEXT.md
      const result = await actionService.gracefulKill(pid);

      if (result.success) {
        const message = result.escalated
          ? `Killed ${name} (PID ${pid}) (escalated to SIGKILL)`
          : `Killed ${name} (PID ${pid})`;
        vscode.window.showInformationMessage(message);
      } else {
        vscode.window.showErrorMessage(`Failed to kill ${name} (PID ${pid}): ${result.error}`);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.forceKillProcess', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;

      // Check if process is still alive
      if (!actionService.isProcessAlive(pid)) {
        vscode.window.showInformationMessage(`Process ${name} (PID ${pid}) already terminated`);
        return;
      }

      // Force kill requires confirmation (skippable via setting)
      const confirmed = await actionService.confirmAction(
        `Force kill '${name}' (PID ${pid})? This sends SIGKILL and cannot be caught.`,
        'Force Kill'
      );

      if (!confirmed) {
        return;
      }

      const result = await actionService.forceKill(pid);

      if (result.success) {
        vscode.window.showInformationMessage(`Force killed ${name} (PID ${pid})`);
      } else {
        vscode.window.showErrorMessage(`Failed to force kill ${name} (PID ${pid}): ${result.error}`);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.killProcessTree', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;

      // Check if process is still alive
      if (!actionService.isProcessAlive(pid)) {
        vscode.window.showInformationMessage(`Process ${name} (PID ${pid}) already terminated`);
        return;
      }

      // Kill tree requires confirmation (skippable via setting)
      const confirmed = await actionService.confirmAction(
        `Kill process tree for '${name}' (PID ${pid})? This will kill all descendant processes.`,
        'Kill Tree'
      );

      if (!confirmed) {
        return;
      }

      const result = await actionService.killTree(pid);

      if (result.success) {
        vscode.window.showInformationMessage(`Killed process tree for ${name} (PID ${pid})`);
      } else {
        vscode.window.showErrorMessage(`Failed to kill process tree for ${name} (PID ${pid}): ${result.error}`);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.restartProcess', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;
      // Stub - Phase 4 Plan 02 will implement restart logic
      vscode.window.showInformationMessage(`Restart requested for ${name} (PID ${pid}) (stub - Phase 4 Plan 02)`);
    })
  );

  // Copy actions (fully implemented)

  disposables.push(
    vscode.commands.registerCommand('devwatch.copyPid', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const pidString = item.process.pid.toString();
      await vscode.env.clipboard.writeText(pidString);
      vscode.window.showInformationMessage(`Copied PID ${pidString}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.copyCommand', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      await vscode.env.clipboard.writeText(item.process.command);
      vscode.window.showInformationMessage('Copied command');
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.copyProcessJson', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const json = JSON.stringify(item.process, null, 2);
      await vscode.env.clipboard.writeText(json);
      vscode.window.showInformationMessage('Copied process as JSON');
    })
  );

  // Pinning (delegates to provider)

  disposables.push(
    vscode.commands.registerCommand('devwatch.pinProcess', (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      processProvider.togglePin(item.process.pid);
      const isPinned = processProvider.isPinned(item.process.pid);
      vscode.window.showInformationMessage(`${isPinned ? 'Pinned' : 'Unpinned'} ${item.process.name}`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.unpinProcess', (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      processProvider.togglePin(item.process.pid);
      const isPinned = processProvider.isPinned(item.process.pid);
      vscode.window.showInformationMessage(`${isPinned ? 'Pinned' : 'Unpinned'} ${item.process.name}`);
    })
  );

  return disposables;
}
