import * as vscode from 'vscode';

let isActivated = false;

export function activate(context: vscode.ExtensionContext): void {
  const activationStart = Date.now();

  context.subscriptions.push(
    vscode.commands.registerCommand('devwatch.showProcesses', () => {
      vscode.window.showInformationMessage('DevWatch: Process view coming soon');
    }),
    vscode.commands.registerCommand('devwatch.showPorts', () => {
      vscode.window.showInformationMessage('DevWatch: Port view coming soon');
    })
  );

  isActivated = true;
  const activationTime = Date.now() - activationStart;

  const outputChannel = vscode.window.createOutputChannel('DevWatch');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine(`DevWatch activated in ${activationTime}ms`);

  if (activationTime > 100) {
    outputChannel.appendLine(`WARNING: Activation exceeded 100ms target (${activationTime}ms)`);
  }
}

export function deactivate(): void {
  isActivated = false;
}
