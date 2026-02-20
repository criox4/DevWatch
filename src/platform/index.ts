import { IPlatformAdapter } from '../types/platform';
import { DarwinAdapter } from './darwin';
import { LinuxAdapter } from './linux';
import { WindowsAdapter } from './windows';

export function getPlatformAdapter(): IPlatformAdapter {
  switch (process.platform) {
    case 'darwin':
      return new DarwinAdapter();
    case 'linux':
      return new LinuxAdapter();
    case 'win32':
      return new WindowsAdapter();
    default:
      throw new Error(
        `DevWatch: Unsupported platform "${process.platform}". ` +
        `Currently supported: macOS (darwin), Linux (linux), Windows (win32).`
      );
  }
}

export { DarwinAdapter } from './darwin';
export { LinuxAdapter } from './linux';
export { WindowsAdapter } from './windows';
export type { IPlatformAdapter } from '../types/platform';
