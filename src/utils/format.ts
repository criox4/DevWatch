/**
 * Format bytes into human-readable string using binary units (1024)
 * @param bytes Number of bytes
 * @param decimals Number of decimal places (default: 1)
 * @returns Formatted string (e.g., "138.3 MB")
 */
export function formatBytes(bytes: number, decimals: number = 1): string {
  if (bytes === 0 || bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(decimals)} ${units[i]}`;
}

/**
 * Format uptime seconds into compact human-readable string
 * Shows two most significant units
 * @param seconds Uptime in seconds
 * @returns Formatted string (e.g., "2d 5h", "3h 15m", "45s")
 */
export function formatUptime(seconds: number): string {
  if (seconds <= 0) {
    return '0s';
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/**
 * Truncate long command strings with ellipsis in the middle
 * @param command Command string to truncate
 * @param maxLength Maximum length (default: 60)
 * @returns Truncated string if needed (e.g., "/very/long/pa.../--many --flags")
 */
export function truncateCommand(command: string, maxLength: number = 60): string {
  if (command.length <= maxLength) {
    return command;
  }

  const partLength = Math.floor((maxLength - 3) / 2);
  const start = command.slice(0, partLength);
  const end = command.slice(-partLength);

  return `${start}...${end}`;
}
