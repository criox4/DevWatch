import * as vscode from 'vscode';

export class HistoryRotator {
  private storageUri: vscode.Uri;
  private outputChannel: vscode.OutputChannel;

  // 10MB in bytes
  private static readonly ROTATION_SIZE = 10 * 1024 * 1024;

  constructor(storageUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
    this.storageUri = storageUri;
    this.outputChannel = outputChannel;
  }

  /**
   * Check if log file exceeds 10MB and rotate if needed.
   * Renames current file to history-{YYYY-MM-DD-HHmmss}.ndjson
   */
  async rotateIfNeeded(logPath: vscode.Uri): Promise<void> {
    try {
      const stat = await vscode.workspace.fs.stat(logPath);

      if (stat.size >= HistoryRotator.ROTATION_SIZE) {
        // Generate timestamp for rotated file
        const now = new Date();
        const timestamp = this.formatTimestamp(now);
        const rotatedName = `history-${timestamp}.ndjson`;
        const rotatedPath = vscode.Uri.joinPath(this.storageUri, rotatedName);

        // Rename current log to rotated file
        await vscode.workspace.fs.rename(logPath, rotatedPath, { overwrite: false });

        this.outputChannel.appendLine(`[HistoryRotator] Rotated log to ${rotatedName} (${this.formatBytes(stat.size)})`);
      }
    } catch (err) {
      // File doesn't exist yet - this is fine, no rotation needed
      if ((err as vscode.FileSystemError).code !== 'FileNotFound') {
        this.outputChannel.appendLine(`[HistoryRotator] Error checking rotation: ${err}`);
      }
    }
  }

  /**
   * Delete history files older than configured retention period.
   * Default: 14 days
   */
  async cleanupOldLogs(): Promise<void> {
    try {
      const retentionDays = this.getRetentionDays();
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - retentionMs;

      const entries = await vscode.workspace.fs.readDirectory(this.storageUri);
      let deletedCount = 0;

      for (const [filename, fileType] of entries) {
        // Only process files matching history-*.ndjson pattern
        if (fileType === vscode.FileType.File && /^history-.*\.ndjson$/.test(filename)) {
          const filePath = vscode.Uri.joinPath(this.storageUri, filename);

          try {
            const stat = await vscode.workspace.fs.stat(filePath);

            if (stat.mtime < cutoffTime) {
              await vscode.workspace.fs.delete(filePath);
              deletedCount++;
              this.outputChannel.appendLine(`[HistoryRotator] Deleted old log: ${filename}`);
            }
          } catch (err) {
            this.outputChannel.appendLine(`[HistoryRotator] Error processing ${filename}: ${err}`);
          }
        }
      }

      if (deletedCount > 0) {
        this.outputChannel.appendLine(`[HistoryRotator] Cleanup complete: ${deletedCount} file(s) deleted`);
      }
    } catch (err) {
      // Directory doesn't exist yet - this is fine
      if ((err as vscode.FileSystemError).code !== 'FileNotFound') {
        this.outputChannel.appendLine(`[HistoryRotator] Error during cleanup: ${err}`);
      }
    }
  }

  /**
   * Format timestamp as YYYY-MM-DD-HHmmss for rotated filenames
   */
  private formatTimestamp(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
  }

  /**
   * Format bytes for human-readable output
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Read retention period from configuration
   */
  private getRetentionDays(): number {
    const config = vscode.workspace.getConfiguration('devwatch');
    return config.get<number>('historyRetentionDays', 14);
  }
}
