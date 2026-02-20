import * as vscode from 'vscode';
import { getPlatformAdapter } from './platform';
import { ProcessRegistry } from './services/processRegistry';
import { PortScanner } from './services/portScanner';
import { PortLabeler } from './services/portLabeler';
import { PollingEngine } from './services/pollingEngine';
import { ProcessActionService } from './services/processActionService';
import { RestartManager } from './services/restartManager';
import { AlertManager } from './services/alertManager';
import { ThresholdMonitor } from './services/thresholdMonitor';
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
  const restartManager = new RestartManager(actionService, outputChannel);
  const alertManager = new AlertManager(outputChannel);
  const thresholdMonitor = new ThresholdMonitor(alertManager, actionService, outputChannel);
  context.subscriptions.push(processRegistry, portScanner, alertManager, thresholdMonitor);

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

  // Crash detection: track user-initiated kills to distinguish from crashes
  const userKilledPids = new Set<number>();

  // Register context menu command handlers
  const processCommands = registerProcessCommands(context, processProvider, actionService, restartManager, userKilledPids);
  const portCommands = registerPortCommands(context, portProvider, actionService, portScanner, userKilledPids);
  context.subscriptions.push(...processCommands, ...portCommands);

  // Port conflict detection tracking
  const portOwnership = new Map<number, number>(); // port -> pid

  // Create polling engine with onTick callback
  const pollingEngine = new PollingEngine(async () => {
    const rootPid = process.ppid; // VS Code window process (parent of extension host)
    const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);

    // Capture previous state for crash detection
    const previousPids = new Set(processRegistry.getProcesses().map(p => p.pid));
    const previousProcesses = new Map(processRegistry.getProcesses().map(p => [p.pid, p]));

    // Capture previous port data for crash detection
    const previousPortsByPid = new Map<number, Array<{port: number, processName: string | null}>>();
    for (const port of portScanner.getPorts()) {
      const existing = previousPortsByPid.get(port.pid) ?? [];
      existing.push({ port: port.port, processName: port.processName ?? null });
      previousPortsByPid.set(port.pid, existing);
    }

    // Capture previous port map for new port detection
    const previousPortMap = new Map(portScanner.getPorts().map(p => [p.port, p]));

    // Refresh data sources
    await processRegistry.refresh(rootPid, workspaceFolders);
    await portScanner.scan();

    // Crash detection: find processes removed between ticks
    const currentPids = new Set(processRegistry.getProcesses().map(p => p.pid));
    const removedPids = [...previousPids].filter(pid => !currentPids.has(pid));

    for (const pid of removedPids) {
      if (userKilledPids.has(pid)) {
        userKilledPids.delete(pid); // consumed
        continue;
      }
      // This process disappeared without user action = potential crash
      const crashedProc = previousProcesses.get(pid);
      if (crashedProc) {
        const crashedPorts = previousPortsByPid.get(pid) ?? [];
        const portInfo = crashedPorts.length > 0 ? ` (port ${crashedPorts.map(p => p.port).join(', ')})` : '';
        alertManager.notify(
          'crash',
          `crash-${pid}`,
          `${crashedProc.name}${portInfo} crashed (PID ${pid})`,
          'error',
          [
            { label: 'Restart', callback: async () => {
              restartManager.setLastKilled({ pid, name: crashedProc.name, command: crashedProc.command, cwd: crashedProc.cwd ?? null });
              await restartManager.restartLast();
            }},
            { label: 'Dismiss', callback: () => {} }
          ],
          false
        );
      }
    }

    // Orphan notifications: detect new orphans
    const orphans = processRegistry.getOrphans();
    for (const orphan of orphans) {
      const prevProc = previousProcesses.get(orphan.pid);
      if (!prevProc || !prevProc.isOrphan) {
        alertManager.notify(
          'orphan',
          `orphan-${orphan.pid}`,
          `Orphaned process detected: ${orphan.name} (PID ${orphan.pid})`,
          'warning',
          [
            { label: 'Kill Process', callback: async () => {
              await actionService.gracefulKill(orphan.pid);
            }},
            { label: 'Dismiss', callback: () => {} }
          ],
          false
        );
      }
    }

    // Threshold monitoring
    thresholdMonitor.checkProcesses(processRegistry.getProcesses());

    // New port notifications
    const currentPorts = portScanner.getPorts();
    for (const portInfo of currentPorts) {
      if (!previousPortMap.has(portInfo.port)) {
        alertManager.notify(
          'new-port',
          `new-port-${portInfo.port}`,
          `New port opened: :${portInfo.port} by ${portInfo.processName ?? 'unknown'} (PID ${portInfo.pid})`,
          'info',
          [{ label: 'Dismiss', callback: () => {} }],
          false
        );
      }
    }

    // Port conflict detection - check for port ownership changes
    for (const portInfo of currentPorts) {
      const previousPid = portOwnership.get(portInfo.port);

      if (previousPid !== undefined && previousPid !== portInfo.pid) {
        // Port ownership changed
        const newName = portInfo.processName || 'unknown';

        alertManager.notify(
          'port-conflict',
          `port-conflict-${portInfo.port}-${portInfo.pid}`,
          `Port ${portInfo.port} in use by ${newName} (PID ${portInfo.pid}). Kill it?`,
          'warning',
          [
            { label: 'Kill', callback: async () => {
              const result = await actionService.gracefulKill(portInfo.pid);
              if (result.success) {
                userKilledPids.add(portInfo.pid);
                vscode.window.showInformationMessage(`Killed ${newName} (PID ${portInfo.pid})`);
              } else {
                vscode.window.showErrorMessage(`Failed to kill ${newName}: ${result.error}`);
              }
            }},
            { label: 'Dismiss', callback: () => {} }
          ],
          false
        );

        outputChannel.appendLine(`[PORT CONFLICT] Port ${portInfo.port}: ${previousPid} -> ${portInfo.pid} (${newName})`);
      }

      // Update ownership tracking
      portOwnership.set(portInfo.port, portInfo.pid);
    }

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

          // Capture metadata BEFORE killing for lastKilled tracking
          const metadata = await restartManager.captureProcessMetadata(selected.pid);

          const result = await actionService.gracefulKill(selected.pid);

          if (result.success) {
            // Track killed PID for crash detection
            userKilledPids.add(selected.pid);

            // Track lastKilled for restart support
            if (metadata) {
              restartManager.setLastKilled(metadata);
            }

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
    vscode.commands.registerCommand('devwatch.restartLast', async () => {
      await restartManager.restartLast();
    }),

    // Filter processes command
    vscode.commands.registerCommand('devwatch.filterProcesses', async () => {
      const currentFilter = processProvider.getFilter();
      const options = [
        { label: 'Show All', description: currentFilter === 'all' ? '(active)' : '', value: 'all' },
        { label: 'Running Only', description: (currentFilter === 'running' ? '(active) · ' : '') + 'Hide stopped and zombie processes', value: 'running' },
        { label: 'With Ports Only', description: (currentFilter === 'with-ports' ? '(active) · ' : '') + 'Show only processes with open ports', value: 'with-ports' },
        { label: 'Orphans Only', description: (currentFilter === 'orphans' ? '(active) · ' : '') + 'Show only orphaned processes', value: 'orphans' }
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
    }),

    // Bulk Kill Workspace command
    vscode.commands.registerCommand('devwatch.bulkKillWorkspace', async () => {
      const processes = processRegistry.getProcesses();

      if (processes.length === 0) {
        vscode.window.showInformationMessage('No workspace processes to kill');
        return;
      }

      // Build confirmation message
      const names = processes.slice(0, 5).map(p => p.name);
      const more = processes.length > 5 ? ` and ${processes.length - 5} more` : '';
      const confirmMessage = `Kill ${processes.length} workspace processes? (${names.join(', ')}${more})`;

      // Show modal confirmation
      const action = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Kill All'
      );

      if (action !== 'Kill All') {
        return;
      }

      // Kill all processes in parallel
      const killPromises = processes.map(p => actionService.gracefulKill(p.pid));
      const results = await Promise.all(killPromises);

      // Log per-process results and track killed PIDs
      for (let i = 0; i < processes.length; i++) {
        const proc = processes[i];
        const result = results[i];
        const status = result.success ? 'SUCCESS' : `FAILED: ${result.error}`;
        outputChannel.appendLine(`[BULK KILL] PID ${proc.pid} (${proc.name}): ${status}`);
        if (result.success) {
          userKilledPids.add(proc.pid);
        }
      }

      // Show toast summary
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;

      if (failedCount === 0) {
        vscode.window.showInformationMessage(`Killed ${successCount} workspace processes`);
      } else {
        vscode.window.showWarningMessage(`Killed ${successCount}/${results.length} processes (${failedCount} failures - check output)`);
      }
    }),

    // Bulk Kill On Port command
    vscode.commands.registerCommand('devwatch.bulkKillOnPort', async () => {
      const ports = portScanner.getPorts();

      if (ports.length === 0) {
        vscode.window.showInformationMessage('No ports currently in use');
        return;
      }

      // Show QuickPick of ports
      const items = ports.map(p => ({
        label: `:${p.port}`,
        description: `${p.processName || 'unknown'} · PID ${p.pid} · ${p.state}`,
        detail: `${p.protocol}`,
        port: p.port
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a port to kill all processes on...',
        matchOnDescription: true
      });

      if (!selected) {
        return;
      }

      // Get all processes on this port
      const targetPort = selected.port;
      const processesOnPort = ports.filter(p => p.port === targetPort);

      if (processesOnPort.length === 0) {
        vscode.window.showInformationMessage(`No processes on port ${targetPort}`);
        return;
      }

      // Confirm
      const names = processesOnPort.map(p => p.processName || 'unknown').join(', ');
      const confirmMessage = `Kill ${processesOnPort.length} processes on port ${targetPort}? (${names})`;

      const action = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        'Kill All'
      );

      if (action !== 'Kill All') {
        return;
      }

      // Kill in parallel
      const killPromises = processesOnPort.map(p => actionService.gracefulKill(p.pid));
      const results = await Promise.all(killPromises);

      // Log per-process results and track killed PIDs
      for (let i = 0; i < processesOnPort.length; i++) {
        const port = processesOnPort[i];
        const result = results[i];
        const status = result.success ? 'SUCCESS' : `FAILED: ${result.error}`;
        outputChannel.appendLine(`[BULK KILL PORT] PID ${port.pid} (${port.processName || 'unknown'}) on :${targetPort}: ${status}`);
        if (result.success) {
          userKilledPids.add(port.pid);
        }
      }

      // Show toast summary
      const successCount = results.filter(r => r.success).length;
      const failedCount = results.length - successCount;

      if (failedCount === 0) {
        vscode.window.showInformationMessage(`Freed port ${targetPort} (${successCount} processes killed)`);
      } else {
        vscode.window.showWarningMessage(`Freed port ${targetPort} (${successCount}/${results.length} processes killed, ${failedCount} failures - check output)`);
      }
    }),

    // Toggle Auto-Restart command
    vscode.commands.registerCommand('devwatch.toggleAutoRestart', async (item: any) => {
      // Extract pid and name from ProcessItem
      // We use 'any' here to avoid circular imports - the processItem type is checked at runtime
      if (!item?.process?.pid) {
        return;
      }

      const pid = item.process.pid;
      const name = item.process.name;

      // Call restartManager.autoRestart
      await restartManager.autoRestart(pid);

      // Show toast (autoRestart already logs internally)
      vscode.window.showInformationMessage(`Auto-restart enabled for ${name}`);
    }),

    // Bulk Kill Orphans command
    vscode.commands.registerCommand('devwatch.bulkKillOrphans', async () => {
      const orphans = processRegistry.getOrphans();
      if (orphans.length === 0) {
        vscode.window.showInformationMessage('No orphaned processes found');
        return;
      }
      const names = orphans.slice(0, 5).map(p => p.name);
      const more = orphans.length > 5 ? ` and ${orphans.length - 5} more` : '';
      const action = await vscode.window.showWarningMessage(
        `Clean up ${orphans.length} orphaned processes? (${names.join(', ')}${more})`,
        { modal: true },
        'Kill All'
      );
      if (action !== 'Kill All') return;

      const results = await Promise.all(orphans.map(p => actionService.gracefulKill(p.pid)));

      // Track killed PIDs
      for (let i = 0; i < orphans.length; i++) {
        if (results[i].success) {
          userKilledPids.add(orphans[i].pid);
        }
      }

      const success = results.filter(r => r.success).length;
      const failed = results.length - success;
      if (failed === 0) {
        vscode.window.showInformationMessage(`Cleaned up ${success} orphaned processes`);
      } else {
        vscode.window.showWarningMessage(`Cleaned up ${success}/${results.length} orphans (${failed} failures)`);
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
