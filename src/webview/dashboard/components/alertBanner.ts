/**
 * Alert Banner - Dismissible banners for orphans and high-resource processes
 */

import { DashboardState, ProcessData } from '../state';

// Track which alerts have been dismissed
const dismissedAlerts = new Set<string>();

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
 * Render alert banners for critical conditions
 */
export function renderAlertBanner(
  container: HTMLElement,
  state: DashboardState,
  postAction: Function
): void {
  // Clear existing banners
  container.innerHTML = '';

  const alerts: Array<{ id: string; severity: 'warning' | 'error'; message: string; actions: Array<{ label: string; handler: () => void }> }> = [];

  // Check for orphan processes
  const orphans = state.processes.filter(p => p.isOrphan);
  if (orphans.length > 0) {
    const alertId = `orphans-${orphans.length}`;
    if (!dismissedAlerts.has(alertId)) {
      alerts.push({
        id: alertId,
        severity: 'warning',
        message: `⚠ ${orphans.length} orphaned process${orphans.length > 1 ? 'es' : ''} detected`,
        actions: [
          {
            label: 'Clean Up All',
            handler: () => {
              postAction('killOrphans');
              dismissedAlerts.add(alertId);
              renderAlertBanner(container, state, postAction);
            }
          },
          {
            label: 'Dismiss',
            handler: () => {
              dismissedAlerts.add(alertId);
              renderAlertBanner(container, state, postAction);
            }
          }
        ]
      });
    }
  }

  // Check for high CPU processes (>90%)
  const highCpuProcs = state.processes.filter(p => p.cpu > 90);
  for (const proc of highCpuProcs) {
    const alertId = `cpu-${proc.pid}`;
    if (!dismissedAlerts.has(alertId)) {
      alerts.push({
        id: alertId,
        severity: 'error',
        message: `❗ Process ${escapeHtml(proc.name)} (PID ${proc.pid}) using ${proc.cpu.toFixed(1)}% CPU`,
        actions: [
          {
            label: 'Kill',
            handler: () => {
              postAction('kill', { pid: proc.pid });
              dismissedAlerts.add(alertId);
              renderAlertBanner(container, state, postAction);
            }
          },
          {
            label: 'Dismiss',
            handler: () => {
              dismissedAlerts.add(alertId);
              renderAlertBanner(container, state, postAction);
            }
          }
        ]
      });
    }
  }

  // Check for high memory processes (>1GB)
  const highMemProcs = state.processes.filter(p => p.memory > 1024 * 1024 * 1024);
  for (const proc of highMemProcs) {
    const alertId = `memory-${proc.pid}`;
    if (!dismissedAlerts.has(alertId)) {
      alerts.push({
        id: alertId,
        severity: 'error',
        message: `❗ Process ${escapeHtml(proc.name)} (PID ${proc.pid}) using ${formatBytes(proc.memory)}`,
        actions: [
          {
            label: 'Kill',
            handler: () => {
              postAction('kill', { pid: proc.pid });
              dismissedAlerts.add(alertId);
              renderAlertBanner(container, state, postAction);
            }
          },
          {
            label: 'Dismiss',
            handler: () => {
              dismissedAlerts.add(alertId);
              renderAlertBanner(container, state, postAction);
            }
          }
        ]
      });
    }
  }

  // Render alert banners
  for (const alert of alerts) {
    const banner = document.createElement('div');
    banner.className = `alert-banner ${alert.severity}`;
    banner.dataset.alertId = alert.id;

    const messageEl = document.createElement('div');
    messageEl.className = 'alert-message';
    messageEl.innerHTML = alert.message;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'alert-actions';

    for (const action of alert.actions) {
      const btn = document.createElement('button');
      btn.className = 'alert-action-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', action.handler);
      actionsEl.appendChild(btn);
    }

    banner.appendChild(messageEl);
    banner.appendChild(actionsEl);
    container.appendChild(banner);
  }
}
