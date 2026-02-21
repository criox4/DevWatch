/**
 * Port Section Component - Port-centric view with badges and actions
 */

import { DashboardState, PortData } from '../state';
import { domBatcher } from '../utils/domBatcher';

// Track rendered port cards
const renderedPorts = new Map<number, HTMLElement>();

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get status indicator color
 */
function getStatusColor(state: string): string {
  switch (state) {
    case 'LISTEN':
      return 'var(--vscode-charts-green)';
    case 'ESTABLISHED':
      return 'var(--vscode-charts-blue)';
    default:
      return 'gray';
  }
}

/**
 * Check if port is likely HTTP
 */
function isHttpPort(port: number): boolean {
  // Common HTTP ports
  return port >= 3000 && port <= 9999;
}

/**
 * Create port card HTML
 */
function createPortCard(port: PortData, postAction: Function): HTMLElement {
  const card = document.createElement('div');
  card.className = 'port-card';
  card.dataset.port = port.port.toString();

  const isHttp = isHttpPort(port.port);
  const processName = port.processName ? escapeHtml(port.processName) : 'Unknown';
  const label = port.label ? escapeHtml(port.label) : '';

  card.innerHTML = `
    <div class="port-number">
      <span style="font-size: 1.4em; font-weight: 600;">:${port.port}</span>
      <span class="port-protocol" style="margin-left: 8px;">${port.protocol}</span>
      <span class="port-status-dot" style="background: ${getStatusColor(port.state)};" title="${port.state}"></span>
    </div>
    <div class="port-process" style="margin-top: 6px;">
      <div style="font-size: 0.9em; opacity: 0.85;">${processName}</div>
      ${label ? `<div style="font-size: 0.85em; opacity: 0.65; margin-top: 2px;">${label}</div>` : ''}
      <div style="font-size: 0.8em; opacity: 0.6; margin-top: 2px;">PID ${port.pid}</div>
    </div>
    <div class="port-actions" style="display: flex; gap: 6px; margin-top: 10px;">
      ${isHttp ? '<button class="action-btn" data-action="open" style="flex: 1;">Open</button>' : ''}
      <button class="action-btn danger" data-action="free" style="flex: 1;">Free Port</button>
    </div>
  `;

  // Attach event listeners
  const openBtn = card.querySelector('[data-action="open"]');
  const freeBtn = card.querySelector('[data-action="free"]');

  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postAction('openInBrowser', { port: port.port });
    });
  }

  if (freeBtn) {
    freeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postAction('kill', { pid: port.pid });
    });
  }

  return card;
}

/**
 * Update existing port card
 */
function updatePortCard(card: HTMLElement, port: PortData): void {
  // Update status dot color
  const statusDot = card.querySelector('.port-status-dot') as HTMLElement;
  if (statusDot) {
    statusDot.style.background = getStatusColor(port.state);
    statusDot.title = port.state;
  }

  // Update process name if changed
  const processDiv = card.querySelector('.port-process > div:first-child');
  if (processDiv) {
    const processName = port.processName ? escapeHtml(port.processName) : 'Unknown';
    processDiv.textContent = processName;
  }
}

/**
 * Render port section as a grid of port cards
 */
export function renderPortSection(
  container: HTMLElement,
  state: DashboardState,
  postAction: Function
): void {
  domBatcher.write(() => {
    const ports = state.getFilteredPorts();

    // Empty state
    if (ports.length === 0) {
      container.innerHTML = '<div class="empty-state">No active ports detected</div>';
      renderedPorts.clear();
      return;
    }

    // Ensure we have a grid container
    let grid = container.querySelector('.port-grid') as HTMLElement;
    if (!grid) {
      container.innerHTML = '<div class="port-grid"></div>';
      grid = container.querySelector('.port-grid') as HTMLElement;
    }

    const currentPorts = new Set(ports.map(p => p.port));

    // Remove cards for ports that no longer exist
    for (const [portNum, card] of renderedPorts.entries()) {
      if (!currentPorts.has(portNum)) {
        card.remove();
        renderedPorts.delete(portNum);
      }
    }

    // Update or create port cards
    for (const port of ports) {
      let card = renderedPorts.get(port.port);

      if (card) {
        // Update existing card
        updatePortCard(card, port);
      } else {
        // Create new card
        card = createPortCard(port, postAction);
        card.classList.add('animate-in');
        grid.appendChild(card);
        renderedPorts.set(port.port, card);
      }
    }
  });
}
