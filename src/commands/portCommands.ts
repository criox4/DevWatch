import * as vscode from 'vscode';
import type { PortTreeProvider } from '../views/portTreeProvider';
import { PortItem } from '../views/items/portItem';

/**
 * Register all port-related command handlers
 */
export function registerPortCommands(
  context: vscode.ExtensionContext,
  portProvider: PortTreeProvider
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

  // View in History (future -- disabled stub)

  disposables.push(
    vscode.commands.registerCommand('devwatch.viewInHistory', () => {
      vscode.window.showInformationMessage('History view coming in Phase 6');
    })
  );

  return disposables;
}
