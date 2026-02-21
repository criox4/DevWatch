import * as vscode from 'vscode';
import { ProcessRegistry } from '../services/processRegistry';
import { PortScanner } from '../services/portScanner';
import { PortLabeler } from '../services/portLabeler';
import { ProcessActionService } from '../services/processActionService';
import { RestartManager } from '../services/restartManager';
import { getNonce } from './getNonce';

// TODO: Extension.ts wiring completed in this plan

interface OverviewPanelOptions {
  extensionUri: vscode.Uri;
  processRegistry: ProcessRegistry;
  portScanner: PortScanner;
  portLabeler: PortLabeler;
  actionService: ProcessActionService;
  restartManager: RestartManager;
  outputChannel: vscode.OutputChannel;
}

export class OverviewPanel implements vscode.Disposable {
  private static currentPanel: OverviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly processRegistry: ProcessRegistry,
    private readonly portScanner: PortScanner,
    private readonly portLabeler: PortLabeler,
    private readonly actionService: ProcessActionService,
    private readonly restartManager: RestartManager,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    // Set initial HTML content ONCE
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    // Handle messages from webview
    this.panel.webview.onDidReceiveMessage(
      message => this.handleMessage(message),
      null,
      this.disposables
    );

    // Listen for panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Send initial data
    this.update();
  }

  /**
   * Create or show the overview panel (singleton pattern)
   */
  static createOrShow(options: OverviewPanelOptions): void {
    // If panel already exists, reveal it
    if (OverviewPanel.currentPanel) {
      OverviewPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create new webview panel
    const panel = vscode.window.createWebviewPanel(
      'devwatch.overview',
      'DevWatch Overview',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(options.extensionUri, 'dist')]
      }
    );

    // Create panel instance and set as current
    OverviewPanel.currentPanel = new OverviewPanel(
      panel,
      options.extensionUri,
      options.processRegistry,
      options.portScanner,
      options.portLabeler,
      options.actionService,
      options.restartManager,
      options.outputChannel
    );
  }

  /**
   * Update panel if visible (safe for polling)
   */
  static updateIfVisible(): void {
    if (OverviewPanel.currentPanel) {
      OverviewPanel.currentPanel.update();
    }
  }

  /**
   * Update webview content with current data (post message only, do NOT reset HTML)
   */
  private update(): void {
    const processes = this.processRegistry.getProcesses();
    const ports = this.portScanner.getPorts();
    const orphans = this.processRegistry.getOrphans().map(p => p.pid);

    // Add labels to ports
    const portsWithLabels = ports.map(port => ({
      ...port,
      label: this.portLabeler.getLabel(port.port, port.processName ?? 'unknown')
    }));

    // Send data to webview via postMessage
    this.panel.webview.postMessage({
      type: 'update',
      data: {
        processes,
        ports: portsWithLabels,
        orphans,
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle incoming messages from webview
   */
  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'kill':
        if (typeof message.pid === 'number') {
          const result = await this.actionService.gracefulKill(message.pid);
          this.panel.webview.postMessage({
            type: 'actionResult',
            action: 'kill',
            success: result.success,
            error: result.error
          });
        }
        break;

      case 'forceKill':
        if (typeof message.pid === 'number') {
          const result = await this.actionService.forceKill(message.pid);
          this.panel.webview.postMessage({
            type: 'actionResult',
            action: 'forceKill',
            success: result.success,
            error: result.error
          });
        }
        break;

      case 'restart':
        if (typeof message.pid === 'number') {
          // Capture metadata before killing
          const metadata = await this.restartManager.captureProcessMetadata(message.pid);
          if (metadata) {
            this.restartManager.setLastKilled(metadata);
            await this.restartManager.restartLast();
            this.panel.webview.postMessage({
              type: 'actionResult',
              action: 'restart',
              success: true
            });
          } else {
            this.panel.webview.postMessage({
              type: 'actionResult',
              action: 'restart',
              success: false,
              error: 'Failed to capture process metadata'
            });
          }
        }
        break;

      case 'openInBrowser':
        if (typeof message.port === 'number') {
          const url = `http://localhost:${message.port}`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
          this.panel.webview.postMessage({
            type: 'actionResult',
            action: 'openInBrowser',
            success: true
          });
        }
        break;

      case 'dismissAlert':
        // Handled client-side, no extension action needed
        break;

      case 'killOrphans':
        const orphans = this.processRegistry.getOrphans();
        const results = await Promise.all(
          orphans.map(p => this.actionService.gracefulKill(p.pid))
        );
        const successCount = results.filter(r => r.success).length;
        this.panel.webview.postMessage({
          type: 'actionResult',
          action: 'killOrphans',
          success: successCount > 0,
          data: { total: orphans.length, killed: successCount }
        });
        break;
    }
  }

  /**
   * Generate HTML content for webview
   */
  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();

    // Get URIs for bundled resources
    const dashboardJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'dashboard.js')
    );
    const dashboardCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'dashboard.css')
    );

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" nonce="${nonce}" href="${dashboardCssUri}">
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${dashboardJsUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    OverviewPanel.currentPanel = undefined;

    // Clean up resources
    this.panel.dispose();

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
