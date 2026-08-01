/**
 * Cross-process sync lock.
 *
 * A single PID-file lock guards each workspace's sync so two ticks (or two
 * server processes) can't drive the same mirror at once. Stale locks left by a
 * crashed process are reclaimed by checking whether the recorded PID is alive.
 */

import * as fs from 'fs';
import * as path from 'path';

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Try to take the lock at `lockPath`. Returns true when acquired. A lock held by
 * a process that is no longer running is treated as stale and reclaimed.
 */
export async function acquireLock(lockPath: string): Promise<boolean> {
    await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });
    try {
        await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
        return true;
    } catch {
        // Check for stale lock
        try {
            const pid = parseInt(await fs.promises.readFile(lockPath, 'utf8'), 10);
            if (pid && !isProcessRunning(pid)) {
                await fs.promises.unlink(lockPath);
                await fs.promises.writeFile(lockPath, String(process.pid), { flag: 'wx' });
                return true;
            }
        } catch { /* lock held by active process */ }
        return false;
    }
}

/** Release the lock at `lockPath`. Best-effort: a missing lock is not an error. */
export async function releaseLock(lockPath: string): Promise<void> {
    try { await fs.promises.unlink(lockPath); } catch { /* ignore */ }
}
