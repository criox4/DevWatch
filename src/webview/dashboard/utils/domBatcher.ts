/**
 * DomBatcher - Batches DOM read and write operations to prevent layout thrashing.
 *
 * Pattern:
 * - All reads are executed first in a single RAF tick
 * - All writes are executed after reads in the same tick
 * - This prevents interleaved read/write operations that cause layout recalculation
 */
export class DomBatcher {
  private readCallbacks: Array<() => void> = [];
  private writeCallbacks: Array<() => void> = [];
  private scheduled = false;

  /**
   * Queue a DOM read operation
   */
  read(callback: () => void): void {
    this.readCallbacks.push(callback);
    this.scheduleFlush();
  }

  /**
   * Queue a DOM write operation
   */
  write(callback: () => void): void {
    this.writeCallbacks.push(callback);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.scheduled) {
      return;
    }
    this.scheduled = true;
    requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    // Execute all reads first
    const reads = this.readCallbacks.splice(0);
    for (const callback of reads) {
      callback();
    }

    // Then execute all writes
    const writes = this.writeCallbacks.splice(0);
    for (const callback of writes) {
      callback();
    }

    this.scheduled = false;
  }
}

// Singleton instance for convenience
export const domBatcher = new DomBatcher();
