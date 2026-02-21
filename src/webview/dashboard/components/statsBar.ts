/**
 * Stats Bar Component - Aggregate metrics with animated counters
 */

import { DashboardState } from '../state';
import { domBatcher } from '../utils/domBatcher';
import { animateNumber } from '../utils/numberAnimator';

interface StatElements {
  processes: HTMLElement | null;
  ports: HTMLElement | null;
  uptime: HTMLElement | null;
  peakCpu: HTMLElement | null;
  peakMemory: HTMLElement | null;
}

// Store previous values for animation
let previousValues = {
  processes: 0,
  ports: 0,
  uptime: '',
  peakCpu: 0,
  peakMemory: 0
};

// Store element references
let elements: StatElements | null = null;

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + units[i];
}

/**
 * Format uptime duration
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Render stats bar with aggregate metrics
 */
export function renderStatsBar(container: HTMLElement, state: DashboardState): void {
  domBatcher.write(() => {
    // First render - create elements
    if (!elements) {
      container.innerHTML = `
        <div class="stat-card">
          <div class="stat-value" data-stat="processes">0</div>
          <div class="stat-label">Processes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" data-stat="ports">0</div>
          <div class="stat-label">Active Ports</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" data-stat="uptime">0s</div>
          <div class="stat-label">Session Uptime</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" data-stat="peakCpu">0%</div>
          <div class="stat-label">Peak CPU</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" data-stat="peakMemory">0 B</div>
          <div class="stat-label">Peak Memory</div>
        </div>
      `;

      elements = {
        processes: container.querySelector('[data-stat="processes"]'),
        ports: container.querySelector('[data-stat="ports"]'),
        uptime: container.querySelector('[data-stat="uptime"]'),
        peakCpu: container.querySelector('[data-stat="peakCpu"]'),
        peakMemory: container.querySelector('[data-stat="peakMemory"]')
      };
    }

    if (!elements) return;

    // Calculate current values
    const processCount = state.processes.length;
    const portCount = state.ports.length;
    const uptimeMs = Date.now() - state.sessionStart;
    const uptimeStr = formatUptime(uptimeMs);

    // Peak CPU = max CPU across all current processes
    const peakCpu = state.processes.length > 0
      ? Math.max(...state.processes.map(p => p.cpu))
      : 0;

    // Peak Memory = sum of all current process memory
    const peakMemory = state.processes.reduce((sum, p) => sum + p.memory, 0);

    // Update processes with animation
    if (elements.processes && processCount !== previousValues.processes) {
      animateNumber(
        elements.processes,
        previousValues.processes,
        processCount,
        300
      );
      previousValues.processes = processCount;
    }

    // Update ports with animation
    if (elements.ports && portCount !== previousValues.ports) {
      animateNumber(
        elements.ports,
        previousValues.ports,
        portCount,
        300
      );
      previousValues.ports = portCount;
    }

    // Update uptime (no animation, just update)
    if (elements.uptime && uptimeStr !== previousValues.uptime) {
      elements.uptime.textContent = uptimeStr;
      previousValues.uptime = uptimeStr;
    }

    // Update peak CPU with animation
    if (elements.peakCpu && peakCpu !== previousValues.peakCpu) {
      animateNumber(
        elements.peakCpu,
        previousValues.peakCpu,
        peakCpu,
        300,
        (val) => val.toFixed(1) + '%'
      );
      previousValues.peakCpu = peakCpu;
    }

    // Update peak memory with animation
    if (elements.peakMemory && peakMemory !== previousValues.peakMemory) {
      const prevMemoryValue = previousValues.peakMemory;
      animateNumber(
        elements.peakMemory,
        prevMemoryValue,
        peakMemory,
        300,
        (val) => formatBytes(val)
      );
      previousValues.peakMemory = peakMemory;
    }
  });
}
