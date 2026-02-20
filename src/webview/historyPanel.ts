import * as vscode from 'vscode';
import { HistoryQuery } from '../services/historyQuery';
import { HistoryFilters } from '../types/history';
import { getNonce } from './getNonce';

export class HistoryPanel implements vscode.Disposable {
  private static currentPanel: HistoryPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly historyQuery: HistoryQuery,
    private readonly outputChannel: vscode.OutputChannel
  ) {
    // Set initial HTML
    this.panel.webview.html = this.getHtmlContent();
    // Load initial data
    this.loadData({});
    // Listen for messages from webview
    this.panel.webview.onDidReceiveMessage(
      message => this.handleMessage(message),
      null, this.disposables
    );
    // Listen for panel disposal
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /**
   * Create or show the history panel (singleton pattern)
   */
  static createOrShow(extensionUri: vscode.Uri, historyQuery: HistoryQuery, outputChannel: vscode.OutputChannel): void {
    // If panel already exists, reveal it
    if (HistoryPanel.currentPanel) {
      HistoryPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    // Create new webview panel
    const panel = vscode.window.createWebviewPanel(
      'devwatch.history',
      'DevWatch History',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [] // No local resources needed, all inline
      }
    );

    // Create panel instance and set as current
    HistoryPanel.currentPanel = new HistoryPanel(panel, historyQuery, outputChannel);
  }

  /**
   * Show history panel filtered by process name
   */
  static showForProcess(extensionUri: vscode.Uri, historyQuery: HistoryQuery, outputChannel: vscode.OutputChannel, processName: string): void {
    // Create or show panel
    HistoryPanel.createOrShow(extensionUri, historyQuery, outputChannel);

    // Send filter message for the process name
    if (HistoryPanel.currentPanel && processName) {
      HistoryPanel.currentPanel.panel.webview.postMessage({
        type: 'filter',
        filters: { processName }
      });
    }
  }

  /**
   * Handle messages from webview
   */
  private async handleMessage(message: any): Promise<void> {
    switch (message.type) {
      case 'filter':
        await this.loadData(message.filters);
        break;
      case 'refresh':
        await this.loadData({});
        break;
    }
  }

  /**
   * Load data and send to webview
   */
  private async loadData(filters: HistoryFilters): Promise<void> {
    try {
      const [events, stats] = await Promise.all([
        this.historyQuery.queryEvents(filters),
        this.historyQuery.getAggregateStats(filters)
      ]);
      this.panel.webview.postMessage({ type: 'update', events, stats });
    } catch (err) {
      this.outputChannel.appendLine(`[HistoryPanel] Failed to load data: ${err}`);
    }
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
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      margin: 0;
    }
    h1 {
      font-size: 1.4em;
      margin-bottom: 16px;
    }

    /* Filter bar */
    .filter-bar {
      position: sticky;
      top: 0;
      background: var(--vscode-editor-background);
      padding: 12px 0;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--vscode-widget-border);
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      z-index: 100;
    }
    .filter-bar input,
    .filter-bar select {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 4px 8px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
    }
    .filter-bar input {
      min-width: 180px;
      flex: 1;
    }
    .filter-bar input[type="number"] {
      min-width: 80px;
      flex: 0;
    }
    .filter-bar input[type="date"] {
      min-width: 140px;
      flex: 0;
    }
    .filter-bar select {
      min-width: 150px;
    }
    .filter-bar button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 4px 12px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 13px;
    }
    .filter-bar button:hover {
      opacity: 0.9;
    }

    /* Stats cards */
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
    }
    .stat {
      display: inline-block;
      padding: 8px 16px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 4px;
    }
    .stat-value {
      font-size: 1.5em;
      font-weight: bold;
    }
    .stat-label {
      font-size: 0.85em;
      opacity: 0.8;
    }

    /* Section */
    .section {
      margin-bottom: 24px;
    }
    .section h2 {
      font-size: 1.1em;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border);
      padding-bottom: 4px;
    }

    /* Charts */
    .charts {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      margin-bottom: 24px;
    }
    .chart {
      flex: 1;
      min-width: 300px;
      max-width: 600px;
    }
    .chart h3 {
      font-size: 1em;
      margin-bottom: 8px;
      color: var(--vscode-descriptionForeground);
    }
    .chart-bar {
      display: flex;
      align-items: center;
      margin-bottom: 6px;
    }
    .chart-label {
      min-width: 60px;
      font-size: 0.9em;
      margin-right: 8px;
    }
    .chart-track {
      flex: 1;
      height: 20px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-widget-border);
      border-radius: 2px;
      position: relative;
      overflow: hidden;
    }
    .chart-fill {
      height: 100%;
      transition: width 0.3s ease;
    }
    .chart-fill.blue {
      background: var(--vscode-charts-blue);
    }
    .chart-fill.red {
      background: var(--vscode-charts-red);
    }
    .chart-value {
      margin-left: 8px;
      font-size: 0.85em;
      min-width: 30px;
      color: var(--vscode-descriptionForeground);
    }

    /* Table */
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      padding: 6px 8px;
      color: var(--vscode-descriptionForeground);
      font-weight: normal;
      font-size: 0.9em;
      border-bottom: 1px solid var(--vscode-widget-border);
      cursor: pointer;
      user-select: none;
    }
    th:hover {
      background: var(--vscode-list-hoverBackground);
    }
    th.sortable:after {
      content: ' ↕';
      opacity: 0.3;
    }
    th.sorted-asc:after {
      content: ' ↑';
      opacity: 1;
    }
    th.sorted-desc:after {
      content: ' ↓';
      opacity: 1;
    }
    td {
      padding: 4px 8px;
      border-top: 1px solid var(--vscode-widget-border);
      font-size: 0.9em;
    }
    tr:hover {
      background: var(--vscode-list-hoverBackground);
    }

    /* Event type badges */
    .badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .badge-start { background: #388e3c; color: white; }
    .badge-stop { background: #757575; color: white; }
    .badge-crash { background: #d32f2f; color: white; }
    .badge-port-bind { background: #1976d2; color: white; }
    .badge-port-release { background: #0288d1; color: white; }
    .badge-resource-snapshot { background: #616161; color: white; }
    .badge-orphan-detected { background: #f57c00; color: white; }
    .badge-threshold-breach { background: #fbc02d; color: black; }

    .empty {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      padding: 16px 0;
    }
  </style>
</head>
<body>
  <h1>DevWatch History</h1>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <input type="text" id="nameFilter" placeholder="Filter by process name...">
    <input type="number" id="portFilter" placeholder="Port..." min="1" max="65535">
    <select id="typeFilter">
      <option value="">All Events</option>
      <option value="start">Start</option>
      <option value="stop">Stop</option>
      <option value="crash">Crash</option>
      <option value="port-bind">Port Bind</option>
      <option value="port-release">Port Release</option>
      <option value="resource-snapshot">Resource Snapshot</option>
      <option value="orphan-detected">Orphan Detected</option>
      <option value="threshold-breach">Threshold Breach</option>
    </select>
    <input type="date" id="dateStart" placeholder="Start date">
    <input type="date" id="dateEnd" placeholder="End date">
    <button onclick="applyFilters()">Apply</button>
    <button onclick="clearFilters()">Clear</button>
  </div>

  <!-- Stats Cards -->
  <div class="stats">
    <div class="stat">
      <div class="stat-value" id="totalEvents">0</div>
      <div class="stat-label">Total Events</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="crashCount">0</div>
      <div class="stat-label">Crashes</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="avgCpu">0%</div>
      <div class="stat-label">Avg CPU</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="peakMemory">0 B</div>
      <div class="stat-label">Peak Memory</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="avgLifetime">0s</div>
      <div class="stat-label">Avg Lifetime</div>
    </div>
  </div>

  <!-- Aggregate Charts -->
  <div class="charts">
    <div class="chart">
      <h3>Most Used Ports</h3>
      <div id="portChart"></div>
    </div>
    <div class="chart">
      <h3>Top Crashers</h3>
      <div id="crashChart"></div>
    </div>
  </div>

  <!-- Event Timeline Table -->
  <div class="section">
    <h2>Event Timeline</h2>
    <div id="eventTableContainer">
      <table>
        <thead>
          <tr>
            <th class="sortable" onclick="sortTable('timestamp')">Time</th>
            <th class="sortable" onclick="sortTable('type')">Type</th>
            <th class="sortable" onclick="sortTable('name')">Process</th>
            <th class="sortable" onclick="sortTable('pid')">PID</th>
            <th>Ports</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody id="eventTable">
          <tr><td colspan="6" class="empty">Loading history...</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    let currentEvents = [];
    let sortColumn = 'timestamp';
    let sortDirection = 'desc';

    // Listen for messages from extension
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'update') {
        currentEvents = message.events;
        renderData(message.events, message.stats);
      } else if (message.type === 'filter') {
        // Apply filter from extension (e.g., from "View in History" command)
        if (message.filters.processName) {
          document.getElementById('nameFilter').value = message.filters.processName;
          applyFilters();
        }
      }
    });

    function renderData(events, stats) {
      // Update stats cards
      document.getElementById('totalEvents').textContent = stats.totalEvents;
      document.getElementById('crashCount').textContent = stats.crashCount;
      document.getElementById('avgCpu').textContent = stats.avgCpu.toFixed(1) + '%';
      document.getElementById('peakMemory').textContent = formatBytes(stats.peakMemory);
      document.getElementById('avgLifetime').textContent = formatDuration(stats.avgLifetime);

      // Render port chart
      renderChart('portChart', stats.mostUsedPorts.map(p => ({
        label: ':' + p.port,
        value: p.count
      })), 'blue');

      // Render crash chart
      renderChart('crashChart', stats.topCrashers.map(c => ({
        label: c.name,
        value: c.count
      })), 'red');

      // Render event table
      renderTable(events);
    }

    function renderChart(containerId, data, colorClass) {
      const container = document.getElementById(containerId);
      if (data.length === 0) {
        container.innerHTML = '<p class="empty">No data</p>';
        return;
      }

      const maxValue = Math.max(...data.map(d => d.value));
      let html = '';
      for (const item of data) {
        const widthPercent = (item.value / maxValue) * 100;
        html += '<div class="chart-bar">';
        html += '<div class="chart-label">' + escapeHtml(item.label) + '</div>';
        html += '<div class="chart-track">';
        html += '<div class="chart-fill ' + colorClass + '" style="width: ' + widthPercent + '%"></div>';
        html += '</div>';
        html += '<div class="chart-value">' + item.value + '</div>';
        html += '</div>';
      }
      container.innerHTML = html;
    }

    function renderTable(events) {
      const tbody = document.getElementById('eventTable');

      if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty">No events recorded yet</td></tr>';
        return;
      }

      // Sort events
      const sorted = [...events].sort((a, b) => {
        let aVal = a[sortColumn];
        let bVal = b[sortColumn];

        if (sortColumn === 'timestamp') {
          aVal = a.timestamp;
          bVal = b.timestamp;
        } else if (sortColumn === 'type') {
          aVal = a.type;
          bVal = b.type;
        } else if (sortColumn === 'name') {
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
        } else if (sortColumn === 'pid') {
          aVal = a.pid;
          bVal = b.pid;
        }

        if (sortDirection === 'asc') {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });

      let html = '';
      for (const event of sorted) {
        const time = formatTimestamp(event.timestamp);
        const typeBadge = '<span class="badge badge-' + event.type + '">' + event.type + '</span>';
        const ports = event.ports.join(', ') || '-';
        const details = formatEventDetails(event);

        html += '<tr>';
        html += '<td>' + time + '</td>';
        html += '<td>' + typeBadge + '</td>';
        html += '<td>' + escapeHtml(event.name) + '</td>';
        html += '<td>' + event.pid + '</td>';
        html += '<td>' + ports + '</td>';
        html += '<td>' + details + '</td>';
        html += '</tr>';
      }
      tbody.innerHTML = html;

      // Update sort indicators
      document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
      });
      const sortedTh = Array.from(document.querySelectorAll('th.sortable'))
        .find(th => th.textContent.toLowerCase().includes(sortColumn === 'timestamp' ? 'time' : sortColumn));
      if (sortedTh) {
        sortedTh.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');
      }
    }

    function formatEventDetails(event) {
      switch (event.type) {
        case 'stop':
          return 'Exit: ' + event.exitReason;
        case 'port-bind':
          return 'Protocol: ' + event.protocol;
        case 'resource-snapshot':
          return 'CPU: ' + event.cpu.toFixed(1) + '%, Memory: ' + formatBytes(event.memory);
        case 'threshold-breach':
          return event.metric.toUpperCase() + ': ' +
                 (event.metric === 'cpu' ? event.value.toFixed(1) + '%' : formatBytes(event.value)) +
                 ', threshold: ' +
                 (event.metric === 'cpu' ? event.threshold.toFixed(1) + '%' : formatBytes(event.threshold));
        case 'orphan-detected':
          return 'PPID: ' + event.ppid;
        default:
          return '-';
      }
    }

    function sortTable(column) {
      if (sortColumn === column) {
        // Toggle direction
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        // New column, default to descending
        sortColumn = column;
        sortDirection = 'desc';
      }
      renderTable(currentEvents);
    }

    function applyFilters() {
      const filters = {};

      const nameFilter = document.getElementById('nameFilter').value.trim();
      if (nameFilter) {
        filters.processName = nameFilter;
      }

      const portFilter = document.getElementById('portFilter').value;
      if (portFilter) {
        filters.port = parseInt(portFilter, 10);
      }

      const typeFilter = document.getElementById('typeFilter').value;
      if (typeFilter) {
        filters.eventType = typeFilter;
      }

      const dateStart = document.getElementById('dateStart').value;
      const dateEnd = document.getElementById('dateEnd').value;
      if (dateStart || dateEnd) {
        filters.dateRange = {};
        if (dateStart) {
          // Convert to UTC ms (start of day)
          filters.dateRange.start = new Date(dateStart + 'T00:00:00').getTime();
        } else {
          filters.dateRange.start = 0;
        }
        if (dateEnd) {
          // Convert to UTC ms (end of day)
          filters.dateRange.end = new Date(dateEnd + 'T23:59:59').getTime();
        } else {
          filters.dateRange.end = Date.now();
        }
      }

      vscode.postMessage({ type: 'filter', filters });
    }

    function clearFilters() {
      document.getElementById('nameFilter').value = '';
      document.getElementById('portFilter').value = '';
      document.getElementById('typeFilter').value = '';
      document.getElementById('dateStart').value = '';
      document.getElementById('dateEnd').value = '';
      vscode.postMessage({ type: 'filter', filters: {} });
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

    function formatTimestamp(ms) {
      const date = new Date(ms);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return year + '-' + month + '-' + day + ' ' + hours + ':' + minutes + ':' + seconds;
    }

    function formatDuration(ms) {
      if (ms < 1000) {
        return ms.toFixed(0) + 'ms';
      }
      const seconds = Math.floor(ms / 1000);
      if (seconds < 60) {
        return seconds + 's';
      }
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) {
        const remainingSeconds = seconds % 60;
        return minutes + 'm' + (remainingSeconds > 0 ? ' ' + remainingSeconds + 's' : '');
      }
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      if (hours < 24) {
        return hours + 'h' + (remainingMinutes > 0 ? ' ' + remainingMinutes + 'm' : '');
      }
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return days + 'd' + (remainingHours > 0 ? ' ' + remainingHours + 'h' : '');
    }
  </script>
</body>
</html>`;
  }

  dispose(): void {
    HistoryPanel.currentPanel = undefined;

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
