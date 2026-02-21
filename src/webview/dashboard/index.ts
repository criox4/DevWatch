/**
 * Dashboard webview entry point (runs in browser/webview context)
 * This is bundled as IIFE by esbuild and loaded in VS Code webview
 */

import './styles.css';
import { DashboardState } from './state';
import { domBatcher } from './utils/domBatcher';
import { animateNumber } from './utils/numberAnimator';
import { debounce } from './utils/debounce';

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
 * Main render function - updates DOM based on current state
 */
function render(): void {
  domBatcher.write(() => {
    const app = document.getElementById('app');
    if (!app) return;

    // For now, render placeholder content
    // Subsequent plans will fill in the actual rendering logic
    app.innerHTML = `
      <div class="dashboard">
        <div class="top-bar">
          <div class="stats-bar">
            <div class="stat-card">
              <div class="stat-value" id="stat-processes">0</div>
              <div class="stat-label">Processes</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="stat-ports">0</div>
              <div class="stat-label">Ports</div>
            </div>
            <div class="stat-card">
              <div class="stat-value" id="stat-uptime">0s</div>
              <div class="stat-label">Uptime</div>
            </div>
          </div>
          <div class="filter-bar">
            <input type="text" class="search-input" placeholder="Search processes, ports..." id="search-input" />
            <div class="filter-chip" data-chip="running">Running</div>
            <div class="filter-chip" data-chip="orphans">Orphans</div>
            <div class="filter-chip" data-chip="with-ports">With Ports</div>
          </div>
        </div>
        <div class="main-content">
          <div class="process-section">
            <h2 style="margin-bottom: 8px; font-size: 1.1em;">Processes</h2>
            <div class="empty-state">No processes</div>
          </div>
          <div class="port-section">
            <h2 style="margin-bottom: 8px; font-size: 1.1em;">Ports</h2>
            <div class="empty-state">No ports</div>
          </div>
          <div class="chart-container" style="grid-column: 1 / -1;">
            <div class="chart-title">Resource Usage (Aggregate)</div>
            <div class="empty-state">Chart placeholder</div>
          </div>
        </div>
      </div>
    `;

    // Update stats with animated numbers
    const statProcesses = document.getElementById('stat-processes');
    const statPorts = document.getElementById('stat-ports');
    const statUptime = document.getElementById('stat-uptime');

    if (statProcesses) {
      statProcesses.textContent = state.processes.length.toString();
    }
    if (statPorts) {
      statPorts.textContent = state.ports.length.toString();
    }
    if (statUptime) {
      const uptimeSeconds = Math.floor((Date.now() - state.sessionStart) / 1000);
      statUptime.textContent = `${uptimeSeconds}s`;
    }

    // Set up search input handler
    const searchInput = document.getElementById('search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener(
        'input',
        debounce((e: Event) => {
          const target = e.target as HTMLInputElement;
          state.filter.text = target.value;
          render();
        }, 300)
      );
    }

    // Set up filter chip handlers
    const chips = document.querySelectorAll('.filter-chip');
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        const chipValue = (chip as HTMLElement).dataset.chip;
        if (!chipValue) return;

        if (state.filter.chips.has(chipValue)) {
          state.filter.chips.delete(chipValue);
          chip.classList.remove('active');
        } else {
          state.filter.chips.add(chipValue);
          chip.classList.add('active');
        }

        render();
      });
    });

    // Save state
    vscode.setState({
      processes: state.processes,
      ports: state.ports,
      filter: {
        text: state.filter.text,
        chips: Array.from(state.filter.chips)
      }
    });
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
      console.log('Action result:', message);
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
    if (previousState.filter) {
      state.filter.text = previousState.filter.text || '';
      state.filter.chips = new Set(previousState.filter.chips || []);
    }
    render();
  }
}

// Initialize dashboard on load
document.addEventListener('DOMContentLoaded', () => {
  restoreState();
  render();
});
