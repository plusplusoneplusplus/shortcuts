import * as fs from 'fs';
import * as path from 'path';

export interface MemoryPromoteLockOptions {
    waitTimeoutMs: number;
    staleMs: number;
    retryIntervalMs: number;
}

export interface MemoryPromoteLockHandle {
    acquired: boolean;
    reason?: string;
    release: () => void;
}

export async function acquireMemoryPromoteLock(
    memoryDir: string,
    options: MemoryPromoteLockOptions,
): Promise<MemoryPromoteLockHandle> {
    fs.mkdirSync(memoryDir, { recursive: true });
    const lockPath = path.join(memoryDir, 'promote.lock');
    const startedAt = Date.now();

    while (true) {
        try {
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
            fs.closeSync(fd);
            return {
                acquired: true,
                release: () => {
                    try { fs.unlinkSync(lockPath); } catch { /* already released */ }
                },
            };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== 'EEXIST') throw error;

            if (isStaleLock(lockPath, options.staleMs)) {
                try {
                    fs.unlinkSync(lockPath);
                    continue;
                } catch (unlinkError) {
                    if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
                }
            }

            if (Date.now() - startedAt >= options.waitTimeoutMs) {
                return {
                    acquired: false,
                    reason: 'lock-held',
                    release: () => { },
                };
            }
            await sleep(options.retryIntervalMs);
        }
    }
}

function isStaleLock(lockPath: string, staleMs: number): boolean {
    try {
        const stat = fs.statSync(lockPath);
        return Date.now() - stat.mtimeMs > staleMs;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
