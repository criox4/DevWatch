import * as vscode from 'vscode';
import { getPlatformAdapter } from './platform';
import { ProcessRegistry } from './services/processRegistry';
import { PortScanner } from './services/portScanner';
import { PortLabeler } from './services/portLabeler';
import { PollingEngine } from './services/pollingEngine';
import { ProcessActionService } from './services/processActionService';
import { ProcessTreeProvider } from './views/processTreeProvider';
import { PortTreeProvider } from './views/portTreeProvider';
import { DevWatchStatusBar } from './views/statusBar';
import { OverviewPanel } from './webview/overviewPanel';
import { registerProcessCommands } from './commands/processCommands';
import { registerPortCommands } from './commands/portCommands';
import { formatBytes } from './utils/format';

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
  const actionService = new ProcessActionService(adapter, outputChannel);
  context.subscriptions.push(processRegistry, portScanner);

  // Create tree data providers
  const processProvider = new ProcessTreeProvider(processRegistry, portScanner, context);
  const portProvider = new PortTreeProvider(portScanner, portLabeler, processRegistry, context);

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

  // Create status bar
  const statusBar = new DevWatchStatusBar(processRegistry, portScanner);
  context.subscriptions.push(statusBar);

  // Register context menu command handlers
  const processCommands = registerProcessCommands(context, processProvider, actionService);
  const portCommands = registerPortCommands(context, portProvider);
  context.subscriptions.push(...processCommands, ...portCommands);

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

    // Update status bar and webview
    statusBar.update();
    OverviewPanel.updateIfVisible();
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
    }),

    // Open overview panel command
    vscode.commands.registerCommand('devwatch.openOverview', () => {
      OverviewPanel.createOrShow(context.extensionUri, processRegistry, portScanner, portLabeler);
    }),

    // Quick kill command (Cmd+Shift+K)
    vscode.commands.registerCommand('devwatch.quickKill', async () => {
      const processes = processRegistry.getProcesses();
      const items = processes.map(p => ({
        label: p.name,
        description: `PID ${p.pid} · ${p.cpu.toFixed(1)}% · ${formatBytes(p.memory)}`,
        detail: p.command,
        pid: p.pid
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a process to kill',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (selected) {
        const action = await vscode.window.showWarningMessage(
          `Kill process "${selected.label}" (PID ${selected.pid})?`,
          { modal: true },
          'Kill'
        );
        if (action === 'Kill') {
          // Check if process is still alive
          if (!actionService.isProcessAlive(selected.pid)) {
            vscode.window.showInformationMessage(`Process ${selected.label} (PID ${selected.pid}) already terminated`);
            return;
          }

          const result = await actionService.gracefulKill(selected.pid);

          if (result.success) {
            const message = result.escalated
              ? `Killed ${selected.label} (PID ${selected.pid}) (escalated to SIGKILL)`
              : `Killed ${selected.label} (PID ${selected.pid})`;
            vscode.window.showInformationMessage(message);
          } else {
            vscode.window.showErrorMessage(`Failed to kill ${selected.label} (PID ${selected.pid}): ${result.error}`);
          }
        }
      }
    }),

    // Restart last killed command (Cmd+Shift+R)
    vscode.commands.registerCommand('devwatch.restartLast', () => {
      vscode.window.showInformationMessage('Restart last killed process (stub - Phase 4 will implement)');
    }),

    // Filter processes command
    vscode.commands.registerCommand('devwatch.filterProcesses', async () => {
      const currentFilter = processProvider.getFilter();
      const options = [
        { label: 'Show All', description: currentFilter === 'all' ? '(active)' : '', value: 'all' },
        { label: 'Running Only', description: (currentFilter === 'running' ? '(active) · ' : '') + 'Hide stopped and zombie processes', value: 'running' },
        { label: 'With Ports Only', description: (currentFilter === 'with-ports' ? '(active) · ' : '') + 'Show only processes with open ports', value: 'with-ports' }
      ];
      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Filter processes by...'
      });
      if (selected) {
        processProvider.setFilter(selected.value);
        outputChannel.appendLine(`[Filter] Process filter: ${selected.label}`);
      }
    }),

    // Filter ports command
    vscode.commands.registerCommand('devwatch.filterPorts', async () => {
      const currentFilter = portProvider.getFilter();
      const options = [
        { label: 'Show All', description: currentFilter === 'all' ? '(active)' : '', value: 'all' },
        { label: 'Listening Only', description: (currentFilter === 'listening' ? '(active) · ' : '') + 'Hide non-listening ports', value: 'listening' },
        { label: 'Workspace Only', description: (currentFilter === 'workspace' ? '(active) · ' : '') + 'Hide external ports', value: 'workspace' }
      ];
      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: 'Filter ports by...'
      });
      if (selected) {
        portProvider.setFilter(selected.value);
        outputChannel.appendLine(`[Filter] Port filter: ${selected.label}`);
      }
    }),

    // Search processes command (UI-04)
    vscode.commands.registerCommand('devwatch.searchProcesses', async () => {
      const processes = processRegistry.getProcesses();
      const items = processes.map(p => ({
        label: p.name,
        description: `PID ${p.pid} · ${p.status} · ${p.cpu.toFixed(1)}%`,
        detail: p.command,
        pid: p.pid
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search processes by name, PID, status, or command...',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (selected) {
        vscode.window.showInformationMessage(`Selected: ${selected.label} (PID ${selected.pid})`);
      }
    }),

    // Search ports command (UI-04)
    vscode.commands.registerCommand('devwatch.searchPorts', async () => {
      const ports = portScanner.getPorts();
      const items = ports.map(p => ({
        label: `:${p.port}`,
        description: `${p.processName || 'unknown'} · PID ${p.pid} · ${p.state}`,
        detail: `${p.protocol} · ${p.state}`,
        port: p.port
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Search ports by number, process name, or protocol...',
        matchOnDescription: true,
        matchOnDetail: true
      });

      if (selected) {
        vscode.window.showInformationMessage(`Selected: port ${selected.port}`);
      }
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
