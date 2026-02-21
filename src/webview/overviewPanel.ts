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
  userKilledPids: Set<number>;
}

export class OverviewPanel implements vscode.Disposable {
  private static currentPanel: OverviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private resourceHistory?: Map<number, { cpu: number[], memory: number[], timestamps: number[] }>;
  private aggregateHistory?: { cpu: number[], memory: number[], timestamps: number[] };

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly processRegistry: ProcessRegistry,
    private readonly portScanner: PortScanner,
    private readonly portLabeler: PortLabeler,
    private readonly actionService: ProcessActionService,
    private readonly restartManager: RestartManager,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly userKilledPids: Set<number>
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
      options.outputChannel,
      options.userKilledPids
    );
  }

  /**
   * Set resource history data from extension host polling
   */
  static setResourceHistory(
    perProcess: Map<number, { cpu: number[], memory: number[], timestamps: number[] }>,
    aggregate: { cpu: number[], memory: number[], timestamps: number[] }
  ): void {
    if (OverviewPanel.currentPanel) {
      OverviewPanel.currentPanel.resourceHistory = perProcess;
      OverviewPanel.currentPanel.aggregateHistory = aggregate;
    }
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
    const ports = this.portScanner.getPorts().map(p => ({
      ...p,
      label: this.portLabeler.getLabel(p.port, p.processName ?? '') ?? undefined
    }));

    // Convert Map to plain object for JSON serialization
    const resourceHistoryObj: Record<string, { cpu: number[], memory: number[], timestamps: number[] }> = {};
    if (this.resourceHistory) {
      for (const [pid, history] of this.resourceHistory) {
        resourceHistoryObj[pid.toString()] = history;
      }
    }

    // Send data to webview via postMessage
    this.panel.webview.postMessage({
      type: 'update',
      data: {
        processes,
        ports,
        resourceHistory: resourceHistoryObj,
        aggregateHistory: this.aggregateHistory ?? { cpu: [], memory: [], timestamps: [] },
        timestamp: Date.now()
      }
    });
  }

  /**
   * Handle incoming messages from webview
   */
  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'kill': {
        const result = await this.actionService.gracefulKill(message.pid);
        if (result.success) {
          this.userKilledPids.add(message.pid);
        }
        this.panel.webview.postMessage({
          type: 'actionResult',
          action: 'kill',
          pid: message.pid,
          success: result.success,
          error: result.error
        });
        break;
      }

      case 'forceKill': {
        const result = await this.actionService.forceKill(message.pid);
        if (result.success) {
          this.userKilledPids.add(message.pid);
        }
        this.panel.webview.postMessage({
          type: 'actionResult',
          action: 'forceKill',
          pid: message.pid,
          success: result.success,
          error: result.error
        });
        break;
      }

      case 'restart': {
        const metadata = await this.restartManager.captureProcessMetadata(message.pid);
        if (metadata) {
          this.restartManager.setLastKilled(metadata);
        }
        // Kill first, then restart
        const killResult = await this.actionService.gracefulKill(message.pid);
        if (killResult.success) {
          this.userKilledPids.add(message.pid);
          await this.restartManager.restartLast();
        }
        this.panel.webview.postMessage({
          type: 'actionResult',
          action: 'restart',
          pid: message.pid,
          success: killResult.success,
          error: killResult.error
        });
        break;
      }

      case 'openInBrowser': {
        const url = vscode.Uri.parse(`http://localhost:${message.port}`);
        await vscode.env.openExternal(url);
        break;
      }

      case 'setNotificationVerbosity': {
        const verbosity = message.verbosity;
        if (['none', 'minimal', 'moderate', 'comprehensive'].includes(verbosity)) {
          const config = vscode.workspace.getConfiguration('devwatch');
          await config.update('notificationVerbosity', verbosity, vscode.ConfigurationTarget.Global);
          this.panel.webview.postMessage({
            type: 'notificationVerbosity',
            verbosity
          });
        }
        break;
      }

      case 'getNotificationVerbosity': {
        const config = vscode.workspace.getConfiguration('devwatch');
        const verbosity = config.get<string>('notificationVerbosity', 'none');
        this.panel.webview.postMessage({
          type: 'notificationVerbosity',
          verbosity
        });
        break;
      }

      case 'killOrphans': {
        const orphans = this.processRegistry.getOrphans();
        const results = await Promise.all(orphans.map(p => this.actionService.gracefulKill(p.pid)));
        for (let i = 0; i < orphans.length; i++) {
          if (results[i].success) {
            this.userKilledPids.add(orphans[i].pid);
          }
        }
        const success = results.filter(r => r.success).length;
        this.panel.webview.postMessage({
          type: 'actionResult',
          action: 'killOrphans',
          success: success === orphans.length,
          killed: success,
          total: orphans.length
        });
        break;
      }
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
