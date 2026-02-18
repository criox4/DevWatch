import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export async function execAsync(
  command: string,
  options?: { timeout?: number; ignoreErrors?: boolean }
): Promise<ExecResult> {
  const timeout = options?.timeout ?? 10000;
  try {
    const result = await execPromise(command, {
      timeout,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, LC_ALL: 'C' },
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error: unknown) {
    if (options?.ignoreErrors) {
      const err = error as { stdout?: string; stderr?: string };
      return { stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
    throw error;
  }
}
