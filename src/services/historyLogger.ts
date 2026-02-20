import * as vscode from 'vscode';
import { HistoryEvent } from '../types/history';
import { HistoryRotator } from './historyRotator';

export class HistoryLogger implements vscode.Disposable {
  private storageUri: vscode.Uri;
  private outputChannel: vscode.OutputChannel;
  private rotator: HistoryRotator;
  private eventBuffer: HistoryEvent[] = [];
  private flushInterval: NodeJS.Timeout;
  private writePromise: Promise<void> = Promise.resolve();
  private storageReady = false;

  // Buffer size before automatic flush
  private static readonly BUFFER_SIZE = 100;
  // Flush interval in milliseconds
  private static readonly FLUSH_INTERVAL_MS = 5000;

  constructor(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.storageUri = context.storageUri!;
    this.outputChannel = outputChannel;
    this.rotator = new HistoryRotator(this.storageUri, outputChannel);

    // Set up periodic flush every 5 seconds
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        this.outputChannel.appendLine(`[HistoryLogger] Flush error: ${err}`);
      });
    }, HistoryLogger.FLUSH_INTERVAL_MS);

    this.outputChannel.appendLine('[HistoryLogger] Initialized with 5s flush interval');
  }

  /**
   * Add an event to the in-memory buffer.
   * Triggers immediate flush if buffer exceeds 100 events.
   */
  logEvent(event: HistoryEvent): void {
    this.eventBuffer.push(event);

    // Automatic flush when buffer is full
    if (this.eventBuffer.length >= HistoryLogger.BUFFER_SIZE) {
      this.flush().catch(err => {
        this.outputChannel.appendLine(`[HistoryLogger] Auto-flush error: ${err}`);
      });
    }
  }

  /**
   * Write buffered events to disk as NDJSON.
   * Uses write queue to prevent concurrent file operations.
   */
  async flush(): Promise<void> {
    // Chain onto previous write to serialize operations
    this.writePromise = this.writePromise.then(() => this.doFlush());
    return this.writePromise;
  }

  /**
   * Internal flush implementation - executes serially via write queue
   */
  private async doFlush(): Promise<void> {
    // Nothing to flush
    if (this.eventBuffer.length === 0) {
      return;
    }

    try {
      // Ensure storage directory exists
      await this.ensureStorageReady();

      // Drain buffer into local array
      const eventsToWrite = [...this.eventBuffer];
      this.eventBuffer = [];

      const logPath = vscode.Uri.joinPath(this.storageUri, 'history.ndjson');

      // Check for rotation before writing
      await this.rotator.rotateIfNeeded(logPath);

      // Read existing file content (or empty if doesn't exist)
      let existingBytes: Uint8Array;
      try {
        existingBytes = await vscode.workspace.fs.readFile(logPath);
      } catch (err) {
        // File doesn't exist yet - start fresh
        existingBytes = new Uint8Array(0);
      }

      // Convert events to NDJSON lines
      const encoder = new TextEncoder();
      const newLines = eventsToWrite.map(event => JSON.stringify(event) + '\n').join('');
      const newBytes = encoder.encode(newLines);

      // Concatenate existing + new
      const combinedBytes = new Uint8Array(existingBytes.length + newBytes.length);
      combinedBytes.set(existingBytes, 0);
      combinedBytes.set(newBytes, existingBytes.length);

      // Write back to disk
      await vscode.workspace.fs.writeFile(logPath, combinedBytes);

      this.outputChannel.appendLine(`[HistoryLogger] Flushed ${eventsToWrite.length} event(s) to history.ndjson`);
    } catch (err) {
      this.outputChannel.appendLine(`[HistoryLogger] Flush failed: ${err}`);
      // Re-add events to buffer on failure to avoid data loss
      this.eventBuffer.unshift(...this.eventBuffer);
    }
  }

  /**
   * Ensure storage directory exists before first write.
   * Cached check to avoid repeated directory creation attempts.
   */
  private async ensureStorageReady(): Promise<void> {
    if (this.storageReady) {
      return;
    }

    try {
      await vscode.workspace.fs.createDirectory(this.storageUri);
      this.storageReady = true;
    } catch (err) {
      // Directory might already exist - check if it's accessible
      try {
        await vscode.workspace.fs.stat(this.storageUri);
        this.storageReady = true;
      } catch {
        throw new Error(`Storage directory not accessible: ${this.storageUri.fsPath}`);
      }
    }
  }

  /**
   * Cleanup: stop flush interval and perform final flush
   */
  dispose(): void {
    clearInterval(this.flushInterval);

    // Attempt final synchronous-safe flush
    // Note: Can't await in dispose, but write queue ensures serial execution
    this.flush().catch(err => {
      this.outputChannel.appendLine(`[HistoryLogger] Final flush error: ${err}`);
    });

    this.outputChannel.appendLine('[HistoryLogger] Disposed');
  }
}
