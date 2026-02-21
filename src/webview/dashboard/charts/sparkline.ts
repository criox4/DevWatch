/**
 * Sparkline - Per-process CPU trend visualization using @fnando/sparkline
 */

import { sparkline } from '@fnando/sparkline';

/**
 * Render a sparkline SVG into a container
 */
export function renderSparkline(container: HTMLElement, dataPoints: number[]): void {
  // Need at least 2 points for a meaningful line
  if (dataPoints.length < 2) {
    container.innerHTML = '';
    return;
  }

  // Clear existing content
  container.innerHTML = '';

  // Create SVG element
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '80');
  svg.setAttribute('height', '20');
  svg.setAttribute('stroke-width', '2');

  // Read stroke color from CSS variable
  const computedStyle = getComputedStyle(document.body);
  const strokeColor = computedStyle.getPropertyValue('--vscode-charts-blue')?.trim() || '#4fc3f7';
  svg.setAttribute('stroke', strokeColor);
  svg.setAttribute('fill', 'transparent');

  container.appendChild(svg);

  // Use sparkline library to populate the SVG
  sparkline(svg, dataPoints);
}

/**
 * Update an existing sparkline with new data
 */
export function updateSparkline(container: HTMLElement, dataPoints: number[]): void {
  // Just re-render
  renderSparkline(container, dataPoints);
}
