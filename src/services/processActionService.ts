import * as vscode from 'vscode';
import kill from 'tree-kill';
import { IPlatformAdapter } from '../types/platform';

export interface KillResult {
  success: boolean;
  escalated?: boolean; // true if SIGTERM->SIGKILL escalation happened
  error?: string;
}

export class ProcessActionService {
  constructor(
    private adapter: IPlatformAdapter,
    private outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Check if a process is still alive
   */
  isProcessAlive(pid: number): boolean {
    try {
      // process.kill(pid, 0) sends signal 0, which checks existence without killing
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      if (err.code === 'ESRCH') {
        // No such process
        return false;
      }
      // EPERM means process exists but we don't have permission - still alive
      return true;
    }
  }

  /**
   * Graceful kill with SIGTERM, auto-escalates to SIGKILL after timeout
   */
  async gracefulKill(pid: number, timeoutMs = 5000): Promise<KillResult> {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] KILL - PID ${pid}: SIGTERM sent`);

    try {
      // Send SIGTERM
      await this.adapter.killProcess(pid, 'SIGTERM');
    } catch (err: any) {
      // Process may have already died between check and kill - that's success
      if (err.message?.includes('ESRCH') || err.message?.includes('No such process')) {
        const successTimestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${successTimestamp}] KILL - PID ${pid}: already dead`);
        return { success: true };
      }
      // EPERM or other errors are real failures
      const errorTimestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${errorTimestamp}] KILL - PID ${pid}: ERROR - ${err.message}`);
      return { success: false, error: err.message };
    }

    // Poll every 100ms to check if process died
    const pollInterval = 100;
    const maxPolls = Math.ceil(timeoutMs / pollInterval);

    for (let i = 0; i < maxPolls; i++) {
      await this.sleep(pollInterval);

      if (!this.isProcessAlive(pid)) {
        const successTimestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${successTimestamp}] KILL - PID ${pid}: SUCCESS`);
        return { success: true };
      }
    }

    // Timeout reached, escalate to SIGKILL
    const escalateTimestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${escalateTimestamp}] KILL - PID ${pid}: escalated to SIGKILL`);

    try {
      await this.adapter.killProcess(pid, 'SIGKILL');

      // Wait a bit for SIGKILL to take effect
      await this.sleep(100);

      const successTimestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${successTimestamp}] KILL - PID ${pid}: SUCCESS (escalated)`);
      return { success: true, escalated: true };
    } catch (err: any) {
      // Even SIGKILL can fail if process already died
      if (err.message?.includes('ESRCH') || err.message?.includes('No such process')) {
        const successTimestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${successTimestamp}] KILL - PID ${pid}: SUCCESS (died during escalation)`);
        return { success: true, escalated: true };
      }

      const errorTimestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${errorTimestamp}] KILL - PID ${pid}: ERROR (escalation failed) - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Force kill with SIGKILL immediately
   */
  async forceKill(pid: number): Promise<KillResult> {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] FORCE KILL - PID ${pid}: SIGKILL sent`);

    try {
      await this.adapter.killProcess(pid, 'SIGKILL');

      const successTimestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${successTimestamp}] FORCE KILL - PID ${pid}: SUCCESS`);
      return { success: true };
    } catch (err: any) {
      // Process already dead is success
      if (err.message?.includes('ESRCH') || err.message?.includes('No such process')) {
        const successTimestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${successTimestamp}] FORCE KILL - PID ${pid}: already dead`);
        return { success: true };
      }

      const errorTimestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${errorTimestamp}] FORCE KILL - PID ${pid}: ERROR - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Kill entire process tree using tree-kill package
   */
  async killTree(pid: number): Promise<KillResult> {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] KILL TREE - PID ${pid}: starting`);

    return new Promise<KillResult>((resolve) => {
      kill(pid, 'SIGTERM', (err) => {
        if (err) {
          // Check if error is just "process not found"
          if (err.message?.includes('ESRCH') || err.message?.includes('No such process')) {
            const successTimestamp = new Date().toISOString();
            this.outputChannel.appendLine(`[${successTimestamp}] KILL TREE - PID ${pid}: already dead`);
            resolve({ success: true });
            return;
          }

          const errorTimestamp = new Date().toISOString();
          this.outputChannel.appendLine(`[${errorTimestamp}] KILL TREE - PID ${pid}: ERROR - ${err.message}`);
          resolve({ success: false, error: err.message });
          return;
        }

        const successTimestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${successTimestamp}] KILL TREE - PID ${pid}: SUCCESS`);
        resolve({ success: true });
      });
    });
  }

  /**
   * Show confirmation dialog with "Always" option to skip future confirmations
   */
  async confirmAction(message: string, confirmLabel: string): Promise<boolean> {
    // Check if user has disabled confirmations
    const config = vscode.workspace.getConfiguration('devwatch');
    const skipConfirmation = config.get<boolean>('skipKillConfirmation', false);

    if (skipConfirmation) {
      return true;
    }

    // Show modal with "Always" option
    const result = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      confirmLabel,
      'Always'
    );

    if (result === 'Always') {
      // Update setting to skip future confirmations
      await config.update('skipKillConfirmation', true, vscode.ConfigurationTarget.Global);
      return true;
    }

    return result === confirmLabel;
  }

  /**
   * Sleep helper for polling
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
