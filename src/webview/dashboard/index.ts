/**
 * Dashboard webview entry point (runs in browser/webview context)
 * This is bundled as IIFE by esbuild and loaded in VS Code webview
 */

import './styles.css';
import { DashboardState } from './state';
import { domBatcher } from './utils/domBatcher';
import { debounce } from './utils/debounce';
import { renderStatsBar } from './components/statsBar';
import { renderProcessCards } from './components/processCards';
import { renderPortSection } from './components/portSection';
import { renderFilterBar } from './components/filterBar';
import { renderAlertBanner } from './components/alertBanner';
import { AggregateChart } from './charts/aggregateChart';

// Acquire VS Code API (only works in webview context)
declare function acquireVsCodeApi(): {
  postMessage(message: any): void;
  getState(): any;
  setState(state: any): void;
};

const vscode = acquireVsCodeApi();

// Create dashboard state
const state = new DashboardState();

/**
 * Post an action message to the extension host
 */
export function postAction(type: string, payload: any = {}): void {
  vscode.postMessage({ type, ...payload });
}

/**
 * Show a toast notification
 */
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  // Trigger fade-in animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-remove after 2 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      container.removeChild(toast);
    }, 300); // Wait for fade-out
  }, 2000);
}

// Track if DOM structure has been initialized
let initialized = false;

// Aggregate chart instance
let aggregateChart: AggregateChart | null = null;

/**
 * Initialize DOM structure once on first render
 */
function initializeDom(): void {
  if (initialized) return;

  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="dashboard">
      <div class="top-bar">
        <div class="stats-bar" id="stats-bar"></div>
        <div class="filter-bar" id="filter-bar"></div>
      </div>
      <div id="alert-area"></div>
      <div class="chart-area" id="chart-area">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="margin: 0; font-size: 1em;">Aggregate Resource Usage</h3>
          <select id="time-window-select" class="time-window-select">
            <option value="60000">1 minute</option>
            <option value="300000" selected>5 minutes</option>
            <option value="900000">15 minutes</option>
            <option value="1800000">30 minutes</option>
            <option value="3600000">1 hour</option>
          </select>
        </div>
        <div id="chart-container"></div>
      </div>
      <div class="main-content">
        <div class="process-section" id="process-section">
          <h2 style="margin-bottom: 8px; font-size: 1.1em;">Processes</h2>
          <div id="process-cards"></div>
        </div>
        <div class="port-section" id="port-section">
          <h2 style="margin-bottom: 8px; font-size: 1.1em;">Ports</h2>
          <div id="port-cards"></div>
        </div>
      </div>
      <div class="toast-container" id="toast-container"></div>
    </div>
  `;

  // Initialize aggregate chart
  const chartContainer = document.getElementById('chart-container');
  if (chartContainer && !aggregateChart) {
    aggregateChart = new AggregateChart(chartContainer);

    // Set up time window selector
    const timeWindowSelect = document.getElementById('time-window-select') as HTMLSelectElement;
    if (timeWindowSelect) {
      timeWindowSelect.addEventListener('change', (e) => {
        const target = e.target as HTMLSelectElement;
        const windowMs = parseInt(target.value, 10);
        state.timeWindow = windowMs;
        if (aggregateChart) {
          aggregateChart.setTimeWindow(windowMs);
          aggregateChart.update(state.aggregateHistory);
        }
      });
    }

    // Set up ResizeObserver for chart
    const resizeObserver = new ResizeObserver(() => {
      if (aggregateChart) {
        aggregateChart.resize();
      }
    });
    resizeObserver.observe(chartContainer);
  }

  // Expose postAction to window for inline onclick handlers
  (window as any).postAction = postAction;

  initialized = true;
}

/**
 * Main render function - updates DOM based on current state
 */
function render(): void {
  initializeDom();

  const alertAreaEl = document.getElementById('alert-area');
  const statsBarEl = document.getElementById('stats-bar');
  const filterBarEl = document.getElementById('filter-bar');
  const processCardsEl = document.getElementById('process-cards');
  const portCardsEl = document.getElementById('port-cards');

  // Use DomBatcher for all DOM operations
  domBatcher.write(() => {
    if (alertAreaEl) {
      renderAlertBanner(alertAreaEl, state, postAction);
    }

    if (statsBarEl) {
      renderStatsBar(statsBarEl, state);
    }

    if (filterBarEl) {
      renderFilterBar(filterBarEl, state, () => render());
    }

    if (processCardsEl) {
      renderProcessCards(processCardsEl, state, postAction);
    }

    if (portCardsEl) {
      renderPortSection(portCardsEl, state, postAction);
    }

    // Update aggregate chart
    if (aggregateChart) {
      aggregateChart.update(state.getVisibleAggregateHistory());
    }
  });

  // Save state for persistence across tab switches
  vscode.setState({
    processes: state.processes,
    ports: state.ports,
    dismissedAlerts: Array.from(state.dismissedAlerts),
    filter: {
      text: state.filter.text,
      chips: Array.from(state.filter.chips)
    },
    timeWindow: state.timeWindow
  });
}

/**
 * Handle incoming messages from extension host
 */
window.addEventListener('message', event => {
  const message = event.data;

  switch (message.type) {
    case 'update':
      state.update(message.data);
      render();
      break;

    case 'alert':
      // Handle alert messages
      if (message.alert) {
        state.alerts.push(message.alert);
        render();
      }
      break;

    case 'actionResult':
      // Handle action result messages
      if (message.success) {
        let successMsg = '';
        switch (message.action) {
          case 'kill':
            successMsg = `Process killed (PID ${message.pid})`;
            break;
          case 'forceKill':
            successMsg = `Process force killed (PID ${message.pid})`;
            break;
          case 'restart':
            successMsg = `Process restarted (PID ${message.pid})`;
            break;
          case 'killOrphans':
            successMsg = `Killed ${message.killed}/${message.total} orphaned processes`;
            break;
          default:
            successMsg = 'Action completed';
        }
        showToast(successMsg, 'success');
      } else {
        const errorMsg = message.error || 'Action failed';
        showToast(errorMsg, 'error');
      }
      break;
  }
});

/**
 * Restore previous state on load
 */
function restoreState(): void {
  const previousState = vscode.getState();
  if (previousState) {
    if (previousState.processes) {
      state.processes = previousState.processes;
    }
    if (previousState.ports) {
      state.ports = previousState.ports;
    }
    if (previousState.dismissedAlerts) {
      state.dismissedAlerts = new Set(previousState.dismissedAlerts);
    }
    if (previousState.filter) {
      state.filter.text = previousState.filter.text || '';
      state.filter.chips = new Set(previousState.filter.chips || []);
    }
    if (previousState.timeWindow) {
      state.timeWindow = previousState.timeWindow;
    }
    render();
  }
}

// Initialize dashboard on load
document.addEventListener('DOMContentLoaded', () => {
  restoreState();
  render();
});
