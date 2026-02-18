import * as vscode from 'vscode';
import { getPlatformAdapter } from './platform';
import { ProcessRegistry } from './services/processRegistry';
import { PortScanner } from './services/portScanner';
import { PortLabeler } from './services/portLabeler';
import { PollingEngine } from './services/pollingEngine';
import { ProcessTreeProvider } from './views/processTreeProvider';
import { PortTreeProvider } from './views/portTreeProvider';

export function activate(context: vscode.ExtensionContext): void {
  const activationStart = Date.now();

  // Create output channel
  const outputChannel = vscode.window.createOutputChannel('DevWatch');
  context.subscriptions.push(outputChannel);

  // Create platform adapter
  const adapter = getPlatformAdapter();
  outputChannel.appendLine(`Platform adapter: ${adapter.platformName}`);

  // Create services (lightweight constructors, no I/O)
  const processRegistry = new ProcessRegistry(adapter, outputChannel);
  const portScanner = new PortScanner(adapter, outputChannel);
  const portLabeler = new PortLabeler();
  context.subscriptions.push(processRegistry, portScanner);

  // Create tree data providers
  const processProvider = new ProcessTreeProvider(processRegistry, portScanner);
  const portProvider = new PortTreeProvider(portScanner, portLabeler, processRegistry);

  // Register TreeViews
  const processView = vscode.window.createTreeView('devwatch.processTree', {
    treeDataProvider: processProvider,
    showCollapseAll: true,
  });
  const portView = vscode.window.createTreeView('devwatch.portTree', {
    treeDataProvider: portProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(processView, portView);

  // Create polling engine with onTick callback
  const pollingEngine = new PollingEngine(async () => {
    const rootPid = process.ppid; // VS Code window process (parent of extension host)
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);

    // Refresh data sources
    await processRegistry.refresh(rootPid, workspaceFolders);
    await portScanner.scan();

    // Update providers
    processProvider.setRootPid(rootPid);
    processProvider.refresh();
    portProvider.refresh();
  }, outputChannel);
  context.subscriptions.push(pollingEngine);

  // Track visibility of both views for polling optimization
  let processVisible = false;
  let portVisible = false;

  processView.onDidChangeVisibility(e => {
    processVisible = e.visible;
    pollingEngine.setVisibility(processVisible || portVisible);
  });

  portView.onDidChangeVisibility(e => {
    portVisible = e.visible;
    pollingEngine.setVisibility(processVisible || portVisible);
  });

  // Start polling engine (fires first tick immediately)
  pollingEngine.start();

  // Register commands
  context.subscriptions.push(
    // Manual refresh command
    vscode.commands.registerCommand('devwatch.refresh', async () => {
      outputChannel.appendLine('[Command] Manual refresh triggered');
      const rootPid = process.ppid;
      const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);

      await processRegistry.refresh(rootPid, workspaceFolders);
      await portScanner.scan();

      processProvider.setRootPid(rootPid);
      processProvider.refresh();
      portProvider.refresh();
    }),

    // Legacy show processes command (just show the view)
    vscode.commands.registerCommand('devwatch.showProcesses', async () => {
      outputChannel.appendLine('[Command] Show processes view');
      outputChannel.show();
    }),

    // Legacy show ports command (just show the view)
    vscode.commands.registerCommand('devwatch.showPorts', async () => {
      outputChannel.appendLine('[Command] Show ports view');
      outputChannel.show();
    }),

    // Toggle infrastructure processes command
    vscode.commands.registerCommand('devwatch.toggleInfraProcesses', async () => {
      const config = vscode.workspace.getConfiguration('devwatch');
      const current = config.get<boolean>('showInfraProcesses', false);
      await config.update('showInfraProcesses', !current, vscode.ConfigurationTarget.Global);
      outputChannel.appendLine(`[Command] Infrastructure processes: ${!current ? 'shown' : 'hidden'}`);
      processProvider.refresh();
    })
  );

  const activationTime = Date.now() - activationStart;
  outputChannel.appendLine(`DevWatch activated in ${activationTime}ms`);

  if (activationTime > 100) {
    outputChannel.appendLine(`WARNING: Activation exceeded 100ms target (${activationTime}ms)`);
  }
}

export function deactivate(): void {
  // All resources cleaned up via subscriptions
}
