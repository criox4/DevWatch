import * as vscode from 'vscode';
import * as path from 'path';
import { backOff } from 'exponential-backoff';
import { ProcessActionService } from './processActionService';
import { execAsync } from '../utils/exec';

export interface ProcessMetadata {
  pid: number;
  name: string;
  command: string; // Full command line (from ps -p PID -o args=)
  cwd: string | null; // Working directory (from lsof -a -p PID -d cwd -Fn)
}

export class RestartManager {
  private lastKilled: ProcessMetadata | null = null;

  constructor(
    private actionService: ProcessActionService,
    private outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Capture process metadata (command, cwd, name) from a running process.
   * Returns null if process cannot be captured (user will be prompted).
   */
  async captureProcessMetadata(pid: number): Promise<ProcessMetadata | null> {
    try {
      // Get command via ps
      const cmdResult = await execAsync(`ps -p ${pid} -o args=`, { ignoreErrors: true });
      const command = cmdResult.stdout.trim();

      if (!command) {
        this.outputChannel.appendLine(`[CAPTURE] PID ${pid}: command not found`);
        return null;
      }

      // Get cwd via lsof
      let cwd: string | null = null;
      const cwdResult = await execAsync(`lsof -a -p ${pid} -d cwd -Fn`, { ignoreErrors: true });
      const cwdOutput = cwdResult.stdout;

      // Parse lsof output - look for line starting with 'n'
      const lines = cwdOutput.split('\n');
      for (const line of lines) {
        if (line.startsWith('n')) {
          cwd = line.substring(1); // Remove 'n' prefix
          break;
        }
      }

      // Get process name via ps
      const nameResult = await execAsync(`ps -p ${pid} -o comm=`, { ignoreErrors: true });
      const fullName = nameResult.stdout.trim();
      const name = fullName ? path.basename(fullName) : `pid-${pid}`;

      this.outputChannel.appendLine(`[CAPTURE] PID ${pid}: command="${command}" cwd="${cwd}" name="${name}"`);

      return {
        pid,
        name,
        command,
        cwd
      };
    } catch (err: any) {
      this.outputChannel.appendLine(`[CAPTURE] PID ${pid}: ERROR - ${err.message}`);
      return null;
    }
  }

  /**
   * Restart a process: capture metadata, kill gracefully, wait, relaunch in VS Code terminal
   */
  async restart(pid: number): Promise<boolean> {
    // Step a: Capture metadata BEFORE killing (process must be alive for ps/lsof)
    let metadata = await this.captureProcessMetadata(pid);

    // Step b: If metadata is null, prompt user
    if (!metadata) {
      const userCommand = await vscode.window.showInputBox({
        prompt: `Enter command to restart process (PID ${pid}):`,
        placeHolder: 'e.g., npm run dev'
      });

      if (!userCommand) {
        this.outputChannel.appendLine(`[RESTART] PID ${pid}: user cancelled input`);
        return false;
      }

      // Build metadata from user input
      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const defaultCwd = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;

      metadata = {
        pid,
        name: `pid-${pid}`,
        command: userCommand,
        cwd: defaultCwd
      };

      this.outputChannel.appendLine(`[RESTART] PID ${pid}: using manual command="${userCommand}" cwd="${defaultCwd}"`);
    }

    // Step c: Store metadata as lastKilled
    this.lastKilled = metadata;

    // Step d: Kill process gracefully
    const killResult = await this.actionService.gracefulKill(pid);
    if (!killResult.success) {
      vscode.window.showErrorMessage(`Failed to kill process: ${killResult.error}`);
      return false;
    }

    // Step e: Wait 500ms for cleanup
    await new Promise(r => setTimeout(r, 500));

    // Step f: Launch in VS Code terminal
    const terminal = vscode.window.createTerminal({
      name: `DevWatch: ${metadata.name}`,
      cwd: metadata.cwd ?? undefined,
    });
    terminal.show(true); // true = preserve editor focus
    terminal.sendText(metadata.command, true);

    // Step g: Log to output channel
    this.outputChannel.appendLine(`[RESTART] PID ${pid} (${metadata.name}) -> new terminal "${terminal.name}"`);

    // Step h: Return true
    return true;
  }

  /**
   * Auto-restart a process with exponential backoff (100ms to 30s, max 5 retries)
   */
  async autoRestart(pid: number): Promise<void> {
    // Capture metadata first (same as restart step a/b)
    let metadata = await this.captureProcessMetadata(pid);

    if (!metadata) {
      const userCommand = await vscode.window.showInputBox({
        prompt: `Enter command to auto-restart process (PID ${pid}):`,
        placeHolder: 'e.g., npm run dev'
      });

      if (!userCommand) {
        this.outputChannel.appendLine(`[AUTO-RESTART] PID ${pid}: user cancelled input`);
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
      const defaultCwd = workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;

      metadata = {
        pid,
        name: `pid-${pid}`,
        command: userCommand,
        cwd: defaultCwd
      };
    }

    // Kill process
    const killResult = await this.actionService.gracefulKill(pid);
    if (!killResult.success) {
      vscode.window.showErrorMessage(`Failed to kill process for auto-restart: ${killResult.error}`);
      return;
    }

    this.outputChannel.appendLine(`[AUTO-RESTART] Starting auto-restart for ${metadata.name} with exponential backoff`);

    let attemptNumber = 0;

    try {
      // Use backOff to repeatedly launch in terminal
      await backOff(
        async () => {
          attemptNumber++;
          this.outputChannel.appendLine(`[AUTO-RESTART] Attempt ${attemptNumber}/5: launching ${metadata!.name}`);

          const terminal = vscode.window.createTerminal({
            name: `DevWatch: ${metadata!.name} (auto-restart)`,
            cwd: metadata!.cwd ?? undefined,
          });
          terminal.show(true);
          terminal.sendText(metadata!.command, true);

          // We can't reliably detect if terminal process started,
          // so we just launch and let backoff handle retries
        },
        {
          startingDelay: 100,
          timeMultiple: 2,
          maxDelay: 30000,
          numOfAttempts: 5,
          jitter: 'full',
        }
      );

      this.outputChannel.appendLine(`[AUTO-RESTART] Successfully restarted ${metadata.name}`);
    } catch (err: any) {
      // On final failure (backOff throws)
      const errorMessage = `Auto-restart failed after 5 attempts: ${metadata.name}`;
      this.outputChannel.appendLine(`[AUTO-RESTART] ${errorMessage}`);
      vscode.window.showErrorMessage(errorMessage);
    }
  }

  /**
   * Set the last killed process metadata (called from kill commands)
   */
  setLastKilled(metadata: ProcessMetadata): void {
    this.lastKilled = metadata;
    this.outputChannel.appendLine(`[LAST-KILLED] Set: ${metadata.name} (PID ${metadata.pid})`);
  }

  /**
   * Get the last killed process metadata
   */
  getLastKilled(): ProcessMetadata | null {
    return this.lastKilled;
  }

  /**
   * Restart the last killed process
   */
  async restartLast(): Promise<boolean> {
    if (!this.lastKilled) {
      vscode.window.showInformationMessage('No recently killed process to restart');
      return false;
    }

    const metadata = this.lastKilled;

    // Launch in terminal using lastKilled metadata (no need to kill again, it's already dead)
    const terminal = vscode.window.createTerminal({
      name: `DevWatch: ${metadata.name}`,
      cwd: metadata.cwd ?? undefined,
    });
    terminal.show(true);
    terminal.sendText(metadata.command, true);

    // Show toast
    vscode.window.showInformationMessage(`Restarted ${metadata.name}`);
    this.outputChannel.appendLine(`[RESTART-LAST] Restarted ${metadata.name} in terminal "${terminal.name}"`);

    return true;
  }
}
