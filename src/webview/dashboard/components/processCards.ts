/**
 * Process Cards Component - Categorized process cards with inline actions
 */

import { DashboardState, ProcessData } from '../state';
import { domBatcher } from '../utils/domBatcher';
import { renderSparkline, updateSparkline } from '../charts/sparkline';

// Track rendered categories and process rows
const renderedCategories = new Map<string, HTMLElement>();
const renderedRows = new Map<number, HTMLElement>();
const collapsedCategories = new Set<string>();

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Format uptime duration
 */
function formatUptime(startTime: number): string {
  const ms = Date.now() - startTime;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + units[i];
}

/**
 * Get CPU color class based on percentage
 */
function getCpuColor(cpu: number): string {
  if (cpu >= 70) return 'color: var(--vscode-charts-red)';
  if (cpu >= 30) return 'color: var(--vscode-charts-yellow)';
  return 'color: var(--vscode-charts-green)';
}

/**
 * Get status badge HTML
 */
function getStatusBadge(status: string, isOrphan: boolean): string {
  if (isOrphan) {
    return '<span class="status-dot" style="background: var(--vscode-charts-orange);" title="Orphan"></span>';
  }

  switch (status) {
    case 'running':
    case 'sleeping':
      return '<span class="status-dot" style="background: var(--vscode-charts-green);" title="Running"></span>';
    case 'zombie':
      return '<span class="status-dot" style="background: var(--vscode-charts-red);" title="Zombie"></span>';
    case 'stopped':
      return '<span class="status-dot" style="background: gray;" title="Stopped"></span>';
    default:
      return '<span class="status-dot" style="background: var(--vscode-charts-yellow);" title="Unknown"></span>';
  }
}

/**
 * Create process row HTML
 */
function createProcessRow(proc: ProcessData, state: DashboardState, postAction: Function): HTMLElement {
  const row = document.createElement('div');
  row.className = 'process-row';
  row.dataset.pid = proc.pid.toString();

  const hasHttpPorts = proc.ports.some(port => port >= 3000 && port <= 9999);
  const firstPort = proc.ports[0];

  // Port badges HTML
  const portBadgesHtml = proc.ports.map(port => {
    const isHttp = port >= 3000 && port <= 9999;
    const clickHandler = isHttp ? `onclick="event.stopPropagation(); window.postAction('openInBrowser', {port: ${port}});"` : '';
    const cursor = isHttp ? 'cursor: pointer;' : '';
    return `<span class="port-badge" ${clickHandler} style="display: inline-block; padding: 2px 6px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 3px; font-size: 10px; margin-right: 4px; ${cursor}" title="${isHttp ? 'Click to open in browser' : 'Port ' + port}">${port}</span>`;
  }).join('');

  row.innerHTML = `
    <div class="process-name">
      ${getStatusBadge(proc.status, proc.isOrphan)}
      <span style="font-weight: 500; margin-left: 6px;" title="${escapeHtml(proc.name)}">${escapeHtml(proc.name)}</span>
      <span style="font-family: monospace; opacity: 0.6; font-size: 0.85em;">${proc.pid}</span>
      ${proc.isOrphan ? '<span class="orphan-badge" style="margin-left: 6px;">ORPHAN</span>' : ''}
    </div>
    <div class="process-command" title="${escapeHtml(proc.command)}">${escapeHtml(proc.command)}</div>
    <div class="process-cpu" style="${getCpuColor(proc.cpu)}">${proc.cpu.toFixed(1)}%</div>
    <div class="process-memory">${formatBytes(proc.memory)}</div>
    <div class="process-ports">${portBadgesHtml || '<span style="opacity: 0.5;">—</span>'}</div>
    <div class="sparkline-cell" data-pid="${proc.pid}"></div>
    <div class="process-uptime" style="font-size: 0.85em; opacity: 0.75;">${formatUptime(proc.startTime)}</div>
    <div class="process-actions action-buttons">
      <button class="action-btn danger" data-action="kill" title="Kill process">✕</button>
      <button class="action-btn" data-action="restart" title="Restart process">↻</button>
      ${hasHttpPorts ? '<button class="action-btn" data-action="open" title="Open in browser">↗</button>' : ''}
    </div>
  `;

  // Attach event listeners to action buttons
  const killBtn = row.querySelector('[data-action="kill"]');
  const restartBtn = row.querySelector('[data-action="restart"]');
  const openBtn = row.querySelector('[data-action="open"]');

  if (killBtn) {
    killBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postAction('kill', { pid: proc.pid });
    });
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postAction('restart', { pid: proc.pid });
    });
  }

  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      postAction('openInBrowser', { port: firstPort });
    });
  }

  // Render sparkline
  const sparklineCell = row.querySelector('.sparkline-cell') as HTMLElement;
  if (sparklineCell) {
    const cpuHistory = state.resourceHistory.get(proc.pid)?.cpu ?? [];
    renderSparkline(sparklineCell, cpuHistory);
  }

  return row;
}

/**
 * Update existing process row
 */
function updateProcessRow(row: HTMLElement, proc: ProcessData, state: DashboardState): void {
  // Update CPU
  const cpuEl = row.querySelector('.process-cpu');
  if (cpuEl) {
    cpuEl.textContent = proc.cpu.toFixed(1) + '%';
    (cpuEl as HTMLElement).style.cssText = getCpuColor(proc.cpu);
  }

  // Update memory
  const memEl = row.querySelector('.process-memory');
  if (memEl) {
    memEl.textContent = formatBytes(proc.memory);
  }

  // Update uptime
  const uptimeEl = row.querySelector('.process-uptime');
  if (uptimeEl) {
    uptimeEl.textContent = formatUptime(proc.startTime);
  }

  // Update sparkline
  const sparklineCell = row.querySelector('.sparkline-cell') as HTMLElement;
  if (sparklineCell) {
    const cpuHistory = state.resourceHistory.get(proc.pid)?.cpu ?? [];
    updateSparkline(sparklineCell, cpuHistory);
  }
}

/**
 * Create category card
 */
function createCategoryCard(
  category: ProcessData['category'],
  processes: ProcessData[],
  state: DashboardState,
  postAction: Function
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'category-card';
  if (collapsedCategories.has(category)) {
    card.classList.add('collapsed');
  }

  const header = document.createElement('div');
  header.className = 'category-header';
  header.innerHTML = `
    <div>
      <span class="category-title">${escapeHtml(category)}</span>
      <span class="category-count">(${processes.length})</span>
    </div>
    <span class="chevron">▼</span>
  `;

  // Toggle collapse on header click
  header.addEventListener('click', () => {
    card.classList.toggle('collapsed');
    if (card.classList.contains('collapsed')) {
      collapsedCategories.add(category);
    } else {
      collapsedCategories.delete(category);
    }
  });

  const processList = document.createElement('div');
  processList.className = 'process-list';

  // Render process rows
  for (const proc of processes) {
    const row = createProcessRow(proc, state, postAction);
    row.classList.add('animate-in');
    processList.appendChild(row);
    renderedRows.set(proc.pid, row);
  }

  card.appendChild(header);
  card.appendChild(processList);

  return card;
}

/**
 * Render process cards grouped by category
 */
export function renderProcessCards(
  container: HTMLElement,
  state: DashboardState,
  postAction: Function
): void {
  domBatcher.write(() => {
    const processesByCategory = state.getProcessesByCategory();
    const currentPids = new Set(state.getFilteredProcesses().map(p => p.pid));

    // Remove rows for processes that no longer exist
    for (const [pid, row] of renderedRows.entries()) {
      if (!currentPids.has(pid)) {
        row.remove();
        renderedRows.delete(pid);
      }
    }

    // Process each category
    const categoryOrder: ProcessData['category'][] = ['VS Code', 'Dev Servers', 'Tools', 'Docker', 'Other'];

    for (const category of categoryOrder) {
      const processes = processesByCategory.get(category) || [];

      // Skip empty categories
      if (processes.length === 0) {
        const existingCard = renderedCategories.get(category);
        if (existingCard) {
          existingCard.remove();
          renderedCategories.delete(category);
        }
        continue;
      }

      let card = renderedCategories.get(category);

      // Create new card if doesn't exist
      if (!card) {
        card = createCategoryCard(category, processes, state, postAction);
        container.appendChild(card);
        renderedCategories.set(category, card);
      } else {
        // Update existing card
        const countEl = card.querySelector('.category-count');
        if (countEl) {
          countEl.textContent = `(${processes.length})`;
        }

        const processList = card.querySelector('.process-list');
        if (processList) {
          // Update or add process rows
          for (const proc of processes) {
            let row = renderedRows.get(proc.pid);
            if (row) {
              // Update existing row
              updateProcessRow(row, proc, state);
            } else {
              // Add new row
              row = createProcessRow(proc, state, postAction);
              row.classList.add('animate-in');
              processList.appendChild(row);
              renderedRows.set(proc.pid, row);
            }
          }
        }
      }
    }

    // Ensure category cards are in correct order
    for (const category of categoryOrder) {
      const card = renderedCategories.get(category);
      if (card && card.parentElement === container) {
        container.appendChild(card); // Move to end
      }
    }

    // Show empty state if no processes
    if (state.getFilteredProcesses().length === 0) {
      container.innerHTML = '<div class="empty-state">No processes match the current filter</div>';
      renderedCategories.clear();
      renderedRows.clear();
    }
  });
}
