import * as vscode from 'vscode';

export type AlertType = 'orphan' | 'threshold-cpu' | 'threshold-memory' | 'crash' | 'new-port' | 'port-conflict';
export type NotificationVerbosity = 'minimal' | 'moderate' | 'comprehensive';

export interface AlertAction {
  label: string;
  callback: () => void | Promise<void>;
}

export class AlertManager implements vscode.Disposable {
  // Track last notification time per alert key for cooldown
  private lastAlertTime = new Map<string, number>();
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
  }

  /**
   * Send a notification if not in cooldown.
   * @param alertType - Category of alert for cooldown tracking
   * @param alertKey - Unique key within category (e.g., "threshold-cpu-1234" for PID 1234)
   * @param message - Notification message text
   * @param severity - 'info' | 'warning' | 'error'
   * @param actions - Action buttons to show
   * @param isCritical - If true, bypasses cooldown
   */
  async notify(
    alertType: AlertType,
    alertKey: string,
    message: string,
    severity: 'info' | 'warning' | 'error',
    actions: AlertAction[] = [],
    isCritical = false
  ): Promise<void> {
    // 1. Check verbosity setting
    const verbosity = this.getVerbosity();
    if (!this.shouldNotify(alertType, verbosity)) {
      return;
    }

    // 2. Check cooldown (unless critical)
    if (!isCritical && this.isInCooldown(alertKey)) {
      this.outputChannel.appendLine(`[AlertManager] Suppressed (cooldown): ${alertKey}`);
      return;
    }

    // 3. Record alert time
    this.lastAlertTime.set(alertKey, Date.now());

    // 4. Build action labels
    const actionLabels = actions.map(a => a.label);

    // 5. Show notification based on severity
    let selected: string | undefined;
    if (severity === 'error') {
      selected = await vscode.window.showErrorMessage(message, ...actionLabels);
    } else if (severity === 'warning') {
      selected = await vscode.window.showWarningMessage(message, ...actionLabels);
    } else {
      selected = await vscode.window.showInformationMessage(message, ...actionLabels);
    }

    // 6. Execute action callback if selected
    if (selected) {
      const action = actions.find(a => a.label === selected);
      if (action) {
        await action.callback();
      }
    }

    this.outputChannel.appendLine(`[AlertManager] Sent: [${alertType}] ${message}`);
  }

  /**
   * Check if a specific alert key is in cooldown period
   */
  private isInCooldown(alertKey: string): boolean {
    const lastTime = this.lastAlertTime.get(alertKey);
    if (!lastTime) {
      return false;
    }

    const cooldownMs = this.getCooldownMs();
    return (Date.now() - lastTime) < cooldownMs;
  }

  /**
   * Determine if alert type should fire based on verbosity level
   * - minimal: only crash, threshold-cpu, threshold-memory
   * - moderate: adds orphan, port-conflict
   * - comprehensive: all alert types including new-port
   */
  private shouldNotify(alertType: AlertType, verbosity: NotificationVerbosity): boolean {
    if (verbosity === 'minimal') {
      // Only crash and threshold alerts (critical events)
      return alertType === 'crash' || alertType === 'threshold-cpu' || alertType === 'threshold-memory';
    }

    if (verbosity === 'moderate') {
      // Excludes only new-port (least critical)
      return alertType !== 'new-port';
    }

    // comprehensive: all types
    return true;
  }

  private getVerbosity(): NotificationVerbosity {
    const config = vscode.workspace.getConfiguration('devwatch');
    return config.get<NotificationVerbosity>('notificationVerbosity', 'minimal');
  }

  private getCooldownMs(): number {
    const config = vscode.workspace.getConfiguration('devwatch');
    return config.get<number>('alertCooldownSeconds', 30) * 1000;
  }

  dispose(): void {
    this.lastAlertTime.clear();
  }
}
