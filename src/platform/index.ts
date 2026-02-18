import { IPlatformAdapter } from '../types/platform';
import { DarwinAdapter } from './darwin';

export function getPlatformAdapter(): IPlatformAdapter {
  switch (process.platform) {
    case 'darwin':
      return new DarwinAdapter();
    default:
      throw new Error(
        `DevWatch: Unsupported platform "${process.platform}". ` +
        `Currently supported: macOS (darwin).`
      );
  }
}

export { DarwinAdapter } from './darwin';
export type { IPlatformAdapter } from '../types/platform';
