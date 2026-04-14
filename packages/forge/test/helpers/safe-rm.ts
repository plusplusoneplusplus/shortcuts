/**
 * Windows-safe recursive directory removal helpers.
 *
 * On Windows, file handles may linger after git/server operations, causing
 * ENOTEMPTY / EBUSY / EPERM / EACCES. These helpers retry with exponential
 * back-off so CI runners have time to release handles, then fall back to
 * best-effort cleanup because temp-dir removal should not fail an otherwise
 * passing test.
 */

import * as fs from 'fs';

const RETRIABLE_CODES = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EACCES']);

/**
 * Synchronous recursive removal with retry + exponential back-off.
 */
export function safeRmSync(dir: string, maxRetries = 5): void {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            return;
        } catch (err: any) {
            const retriable = RETRIABLE_CODES.has(err.code);
            if (attempt === maxRetries || !retriable) {
                if (err.code === 'ENOENT') return;
                if (retriable) {
                    console.warn(`safeRmSync: leaving locked temp path behind: ${dir} (${err.code})`);
                    return;
                }
                throw err;
            }
            const delayMs = 200 * Math.pow(2, attempt);
            const start = Date.now();
            while (Date.now() - start < delayMs) { /* busy-wait in sync context */ }
        }
    }
}

/**
 * Async recursive removal with retry + exponential back-off.
 */
export async function safeRm(dir: string, maxRetries = 5): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            return;
        } catch (err: any) {
            const retriable = RETRIABLE_CODES.has(err.code);
            if (attempt === maxRetries || !retriable) {
                if (err.code === 'ENOENT') return;
                if (retriable) {
                    console.warn(`safeRm: leaving locked temp path behind: ${dir} (${err.code})`);
                    return;
                }
                throw err;
            }
            await new Promise(resolve => setTimeout(resolve, 200 * Math.pow(2, attempt)));
        }
    }
}
