import * as vscode from 'vscode';
import type { ProcessTreeProvider } from '../views/processTreeProvider';
import { ProcessItem } from '../views/items/processItem';

/**
 * Register all process-related command handlers
 */
export function registerProcessCommands(
  context: vscode.ExtensionContext,
  processProvider: ProcessTreeProvider
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  // Output channel for action logging
  const outputChannel = vscode.window.createOutputChannel('DevWatch');

  // Destructive actions (stubs -- actual kill/restart logic comes in Phase 4)

  disposables.push(
    vscode.commands.registerCommand('devwatch.killProcess', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;
      const result = await vscode.window.showWarningMessage(
        `Kill process '${name}' (PID ${pid})?`,
        { modal: true },
        'Kill'
      );

      if (result === 'Kill') {
        outputChannel.appendLine(`[Action] Kill requested for PID ${pid} (stub - Phase 4)`);
        vscode.window.showInformationMessage(`Kill signal sent to ${name} (PID ${pid})`);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.forceKillProcess', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;
      const result = await vscode.window.showWarningMessage(
        `Force kill process '${name}' (PID ${pid})? This sends SIGKILL and cannot be caught.`,
        { modal: true },
        'Force Kill'
      );

      if (result === 'Force Kill') {
        outputChannel.appendLine(`[Action] Force kill (SIGKILL) requested for PID ${pid} (stub - Phase 4)`);
        vscode.window.showInformationMessage(`Force kill signal sent to ${name} (PID ${pid})`);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.killProcessTree', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid } = item.process;
      const result = await vscode.window.showWarningMessage(
        `Kill process tree for '${name}' (PID ${pid})? This will kill all descendant processes.`,
        { modal: true },
        'Kill Tree'
      );

      if (result === 'Kill Tree') {
        outputChannel.appendLine(`[Action] Kill tree requested for PID ${pid} (stub - Phase 4)`);
        vscode.window.showInformationMessage(`Kill tree signal sent to ${name} and descendants (PID ${pid})`);
      }
    })
  );

  disposables.push(
    vscode.commands.registerCommand('devwatch.restartProcess', async (item: unknown) => {
      if (!(item instanceof ProcessItem)) {
        return;
      }

      const { name, pid, command } = item.process;
      outputChannel.appendLine(`[Action] Restart requested for PID ${pid} (command: ${command}) (stub - Phase 4)`);
      vscode.window.showInformationMessage(`Restart requested for ${name} (PID ${pid})`);
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

  // Add output channel to disposables
  disposables.push(outputChannel);

  return disposables;
}
