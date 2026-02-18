import * as vscode from 'vscode';

type PollingPreset = 'fast' | 'normal' | 'battery' | 'custom';

interface PollingIntervals {
  visible: number;
  hidden: number;
}

/**
 * Visibility-aware polling engine with preset intervals
 * Manages polling lifecycle with configurable presets (fast/normal/battery/custom)
 */
export class PollingEngine implements vscode.Disposable {
  private intervalId: ReturnType<typeof setInterval> | undefined;
  private isVisible: boolean = true;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly onTick: () => Promise<void>,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Start polling with current preset intervals
   * Listens for configuration changes and restarts automatically
   */
  start(): void {
    // Immediate first tick for initial data load
    this.onTick().catch(err => {
      this.outputChannel.appendLine(`[PollingEngine] Error in onTick: ${err}`);
    });

    // Start interval-based polling
    this.restartInterval();

    // Listen for configuration changes
    const configListener = vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('devwatch.pollingPreset') ||
        e.affectsConfiguration('devwatch.pollingVisibleMs') ||
        e.affectsConfiguration('devwatch.pollingHiddenMs')
      ) {
        this.outputChannel.appendLine('[PollingEngine] Configuration changed, restarting interval');
        this.restartInterval();
      }
    });

    this.disposables.push(configListener);
  }

  /**
   * Update visibility state and restart interval with appropriate timing
   */
  setVisibility(visible: boolean): void {
    if (this.isVisible === visible) {
      return;
    }

    this.isVisible = visible;
    this.outputChannel.appendLine(`[PollingEngine] Visibility changed: ${visible ? 'visible' : 'hidden'}`);
    this.restartInterval();
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.outputChannel.appendLine('[PollingEngine] Stopped');
    }
  }

  /**
   * Dispose and clean up resources
   */
  dispose(): void {
    this.stop();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }

  /**
   * Get polling intervals based on current preset configuration
   */
  private getIntervals(): PollingIntervals {
    const config = vscode.workspace.getConfiguration('devwatch');
    const preset = config.get<PollingPreset>('pollingPreset', 'normal');

    switch (preset) {
      case 'fast':
        return { visible: 1000, hidden: 10000 };
      case 'normal':
        return { visible: 3000, hidden: 30000 };
      case 'battery':
        return { visible: 10000, hidden: 60000 };
      case 'custom':
        return {
          visible: config.get<number>('pollingVisibleMs', 3000),
          hidden: config.get<number>('pollingHiddenMs', 30000),
        };
      default:
        // Fallback to normal if invalid preset
        return { visible: 3000, hidden: 30000 };
    }
  }

  /**
   * Restart interval with correct timing based on visibility state
   */
  private restartInterval(): void {
    this.stop();

    const intervals = this.getIntervals();
    const interval = this.isVisible ? intervals.visible : intervals.hidden;

    this.outputChannel.appendLine(
      `[PollingEngine] Starting interval: ${interval}ms (${this.isVisible ? 'visible' : 'hidden'})`
    );

    this.intervalId = setInterval(() => {
      this.onTick().catch(err => {
        this.outputChannel.appendLine(`[PollingEngine] Error in onTick: ${err}`);
      });
    }, interval);
  }
}
