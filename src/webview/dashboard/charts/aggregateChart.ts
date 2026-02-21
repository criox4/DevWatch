/**
 * Aggregate Chart - uPlot-based time-series chart for CPU and Memory
 */

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export class AggregateChart {
  private uplot: uPlot | null = null;
  private container: HTMLElement;
  private timeWindow = 300000; // 5 minutes default

  constructor(container: HTMLElement) {
    this.container = container;
    this.initChart();
  }

  private initChart(): void {
    // Read colors from CSS variables
    const computedStyle = getComputedStyle(document.body);
    const cpuColor = computedStyle.getPropertyValue('--vscode-charts-blue')?.trim() || '#4fc3f7';
    const memColor = computedStyle.getPropertyValue('--vscode-charts-green')?.trim() || '#81c784';
    const gridColor = computedStyle.getPropertyValue('--vscode-widget-border')?.trim() || '#3e3e3e';
    const textColor = computedStyle.getPropertyValue('--vscode-descriptionForeground')?.trim() || '#ccc';

    const opts: uPlot.Options = {
      width: this.container.clientWidth,
      height: 200,
      plugins: [],
      cursor: {
        drag: { x: false, y: false },
        sync: { key: 'devwatch' }
      },
      series: [
        {
          label: 'Time'
        },
        {
          label: 'CPU %',
          stroke: cpuColor,
          width: 2,
          scale: 'cpu',
          value: (u, v) => (v == null ? '-' : v.toFixed(1) + '%')
        },
        {
          label: 'Memory MB',
          stroke: memColor,
          width: 2,
          scale: 'memory',
          value: (u, v) => (v == null ? '-' : v.toFixed(1) + ' MB')
        }
      ],
      scales: {
        x: {
          time: true
        },
        cpu: {
          auto: false,
          range: [0, 100]
        },
        memory: {
          auto: true,
          range: (u, dataMin, dataMax) => {
            const min = 0;
            const max = Math.max(dataMax * 1.1, 100); // At least 100 MB
            return [min, max];
          }
        }
      },
      axes: [
        {
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 }
        },
        {
          scale: 'cpu',
          label: 'CPU %',
          stroke: textColor,
          grid: { stroke: gridColor, width: 1 },
          side: 3,
          values: (u, vals) => vals.map(v => v.toFixed(0) + '%')
        },
        {
          scale: 'memory',
          label: 'Memory MB',
          stroke: textColor,
          grid: { show: false },
          side: 1,
          values: (u, vals) => vals.map(v => v.toFixed(0) + ' MB')
        }
      ],
      legend: {
        show: true,
        live: true
      }
    };

    // Create with empty initial data
    const data: uPlot.AlignedData = [[], [], []];
    this.uplot = new uPlot(opts, data, this.container);
  }

  /**
   * Update chart with new aggregate history
   */
  update(aggregateHistory: { cpu: number[]; memory: number[]; timestamps: number[] }): void {
    if (!this.uplot) return;

    const { cpu, memory, timestamps } = aggregateHistory;

    // Filter data to time window
    const cutoff = Date.now() - this.timeWindow;
    const filteredIndices: number[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      if (timestamps[i] >= cutoff) {
        filteredIndices.push(i);
      }
    }

    const filteredTimestamps = filteredIndices.map(i => timestamps[i] / 1000); // uPlot expects seconds
    const filteredCpu = filteredIndices.map(i => cpu[i]);
    const filteredMemory = filteredIndices.map(i => memory[i] / (1024 * 1024)); // Convert bytes to MB

    const data: uPlot.AlignedData = [filteredTimestamps, filteredCpu, filteredMemory];

    this.uplot.setData(data);
  }

  /**
   * Set time window (in milliseconds)
   */
  setTimeWindow(ms: number): void {
    this.timeWindow = ms;
  }

  /**
   * Resize chart to fit container
   */
  resize(): void {
    if (!this.uplot) return;
    this.uplot.setSize({ width: this.container.clientWidth, height: 200 });
  }

  /**
   * Destroy chart instance
   */
  destroy(): void {
    if (this.uplot) {
      this.uplot.destroy();
      this.uplot = null;
    }
  }
}
