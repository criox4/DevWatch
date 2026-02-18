import * as vscode from 'vscode';
import { getPlatformAdapter } from './platform';
import { ProcessRegistry } from './services/processRegistry';
import { PortScanner } from './services/portScanner';
import type { IPlatformAdapter } from './types/platform';

let adapter: IPlatformAdapter | undefined;
let processRegistry: ProcessRegistry | undefined;
let portScanner: PortScanner | undefined;
let outputChannel: vscode.OutputChannel | undefined;

function ensureServices(context: vscode.ExtensionContext): {
  adapter: IPlatformAdapter;
  processRegistry: ProcessRegistry;
  portScanner: PortScanner;
  outputChannel: vscode.OutputChannel;
} {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('DevWatch');
    context.subscriptions.push(outputChannel);
  }
  if (!adapter) {
    adapter = getPlatformAdapter();
    outputChannel.appendLine(`Platform adapter: ${adapter.platformName}`);
  }
  if (!processRegistry) {
    processRegistry = new ProcessRegistry(adapter, outputChannel);
    context.subscriptions.push(processRegistry);
  }
  if (!portScanner) {
    portScanner = new PortScanner(adapter, outputChannel);
    context.subscriptions.push(portScanner);
  }
  return { adapter, processRegistry, portScanner, outputChannel };
}

export function activate(context: vscode.ExtensionContext): void {
  const activationStart = Date.now();

  // Create output channel for activation logging (lightweight)
  const activationLog = vscode.window.createOutputChannel('DevWatch');
  context.subscriptions.push(activationLog);

  // Register commands that lazily initialize services
  context.subscriptions.push(
    vscode.commands.registerCommand('devwatch.showProcesses', async () => {
      const { processRegistry, outputChannel } = ensureServices(context);
      const rootPid = process.pid;
      const workspaceFolders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);

      outputChannel.appendLine(`\nScanning workspace processes (root PID: ${rootPid})...`);
      await processRegistry.refresh(rootPid, workspaceFolders);

      const processes = processRegistry.getProcesses();
      outputChannel.appendLine(`Found ${processes.length} workspace processes:`);
      for (const p of processes) {
        const memMB = Math.round(p.memory / 1024 / 1024);
        outputChannel.appendLine(
          `  PID ${p.pid} | ${p.name} | CPU: ${p.cpu.toFixed(1)}% | Mem: ${memMB}MB | ${p.command}`
        );
      }
      outputChannel.show(true);
      vscode.window.showInformationMessage(`DevWatch: Found ${processes.length} workspace processes`);
    }),
    vscode.commands.registerCommand('devwatch.showPorts', async () => {
      const { portScanner, outputChannel } = ensureServices(context);

      outputChannel.appendLine('\nScanning listening ports...');
      await portScanner.scan();

      const ports = portScanner.getPorts();
      outputChannel.appendLine(`Found ${ports.length} listening ports:`);
      for (const p of ports) {
        outputChannel.appendLine(
          `  Port ${p.port} (${p.protocol}) | ${p.address} | PID ${p.pid} [${p.processName ?? 'unknown'}] | ${p.state}`
        );
      }
      outputChannel.show(true);
      vscode.window.showInformationMessage(`DevWatch: Found ${ports.length} listening ports`);
    })
  );

  const activationTime = Date.now() - activationStart;
  activationLog.appendLine(`DevWatch activated in ${activationTime}ms`);

  if (activationTime > 100) {
    activationLog.appendLine(`WARNING: Activation exceeded 100ms target (${activationTime}ms)`);
  }
}

export function deactivate(): void {
  adapter = undefined;
  processRegistry = undefined;
  portScanner = undefined;
  outputChannel = undefined;
}
