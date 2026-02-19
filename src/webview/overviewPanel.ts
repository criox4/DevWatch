import * as vscode from 'vscode';
import { ProcessRegistry } from '../services/processRegistry';
import { PortScanner } from '../services/portScanner';
import { PortLabeler } from '../services/portLabeler';
import { getNonce } from './getNonce';

export class OverviewPanel implements vscode.Disposable {
  private static currentPanel: OverviewPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly processRegistry: ProcessRegistry,
    private readonly portScanner: PortScanner,
    private readonly portLabeler: PortLabeler
  ) {
    // Set initial HTML content
    this.update();

    // Listen for panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * Create or show the overview panel (singleton pattern)
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    processRegistry: ProcessRegistry,
    portScanner: PortScanner,
    portLabeler: PortLabeler
  ): void {
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
        localResourceRoots: [] // No local resources needed, all inline
      }
    );

    // Create panel instance and set as current
    OverviewPanel.currentPanel = new OverviewPanel(
      panel,
      processRegistry,
      portScanner,
      portLabeler
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
   * Update webview content with current data
   */
  private update(): void {
    const processes = this.processRegistry.getProcesses();
    const ports = this.portScanner.getPorts();

    // Update HTML content
    this.panel.webview.html = this.getHtmlContent();

    // Send data to webview
    this.panel.webview.postMessage({
      type: 'update',
      data: { processes, ports }
    });
  }

  /**
   * Generate HTML content for webview
   */
  private getHtmlContent(): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style nonce="${nonce}">
    /* Use VS Code CSS variables for theme integration */
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
    h1 { font-size: 1.4em; margin-bottom: 16px; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 1.1em; margin-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 4px 8px; color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 0.9em; }
    td { padding: 4px 8px; border-top: 1px solid var(--vscode-widget-border); }
    .stat { display: inline-block; padding: 8px 16px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 4px; margin-right: 8px; margin-bottom: 8px; }
    .stat-value { font-size: 1.5em; font-weight: bold; }
    .stat-label { font-size: 0.85em; opacity: 0.8; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 16px 0; }
  </style>
</head>
<body>
  <h1>DevWatch Overview</h1>
  <div class="stats">
    <div class="stat"><div class="stat-value" id="processCount">0</div><div class="stat-label">Processes</div></div>
    <div class="stat"><div class="stat-value" id="portCount">0</div><div class="stat-label">Ports</div></div>
  </div>
  <div class="section">
    <h2>Processes</h2>
    <div id="processTable"></div>
  </div>
  <div class="section">
    <h2>Ports</h2>
    <div id="portTable"></div>
  </div>
  <div class="section">
    <h2>History</h2>
    <p class="empty">Process history will appear here in Phase 6</p>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    // Restore previous state
    const previousState = vscode.getState();

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        renderData(message.data);
        vscode.setState(message.data);
      }
    });

    function renderData(data) {
      document.getElementById('processCount').textContent = data.processes.length;
      document.getElementById('portCount').textContent = data.ports.length;

      // Render process table
      const processDiv = document.getElementById('processTable');
      if (data.processes.length === 0) {
        processDiv.innerHTML = '<p class="empty">No processes being monitored</p>';
      } else {
        // Sort by CPU descending
        const sorted = [...data.processes].sort((a, b) => b.cpu - a.cpu);
        let html = '<table><tr><th>Name</th><th>PID</th><th>CPU</th><th>Memory</th><th>Status</th></tr>';
        for (const p of sorted) {
          const mem = formatBytes(p.memory);
          html += '<tr><td>' + escapeHtml(p.name) + '</td><td>' + p.pid + '</td><td>' + p.cpu.toFixed(1) + '%</td><td>' + mem + '</td><td>' + p.status + '</td></tr>';
        }
        html += '</table>';
        processDiv.innerHTML = html;
      }

      // Render port table
      const portDiv = document.getElementById('portTable');
      if (data.ports.length === 0) {
        portDiv.innerHTML = '<p class="empty">No ports detected</p>';
      } else {
        const sorted = [...data.ports].sort((a, b) => a.port - b.port);
        let html = '<table><tr><th>Port</th><th>Protocol</th><th>Process</th><th>PID</th><th>State</th></tr>';
        for (const p of sorted) {
          html += '<tr><td>' + p.port + '</td><td>' + p.protocol + '</td><td>' + escapeHtml(p.processName || 'unknown') + '</td><td>' + p.pid + '</td><td>' + p.state + '</td></tr>';
        }
        html += '</table>';
        portDiv.innerHTML = html;
      }
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function formatBytes(bytes) {
      if (bytes === 0 || bytes < 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      const k = 1024;
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + units[i];
    }

    // Render previous state if available
    if (previousState) {
      renderData(previousState);
    }
  </script>
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
