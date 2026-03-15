/**
 * Shared filesystem utilities.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Write data to a file atomically using a temp-file + rename pattern.
 * Ensures the parent directory exists. Throws on failure.
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
    const tmpPath = filePath + '.tmp';
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

/**
 * Async variant of atomicWriteJson. Ensures the parent directory exists.
 * Cleans up the temp file on failure and rethrows.
 */
export async function atomicWriteJSON(filePath: string, data: unknown): Promise<void> {
    const tmpPath = filePath + '.tmp';
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
        await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
        await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
        try { await fs.promises.unlink(tmpPath); } catch { /* ignore */ }
        throw err;
    }
}

/**
 * Safely extract a human-readable message from an unknown thrown value.
 * Returns err.message for Error instances, String(err) otherwise.
 */
export function getErrorMessage(err: unknown, fallback = 'Unknown error'): string {
    if (err instanceof Error) return err.message;
    const str = String(err);
    return str !== '[object Object]' ? str : fallback;
}

/**
 * If `destPath` already exists on disk, returns a non-colliding variant by
 * appending `-<timestamp>` before the extension. Otherwise returns `destPath`
 * unchanged.
 */
export async function resolveCollision(destPath: string): Promise<string> {
    try {
        await fs.promises.access(destPath);
        const ext = path.extname(destPath);
        const base = destPath.slice(0, destPath.length - ext.length);
        return `${base}-${Date.now()}${ext}`;
    } catch {
        return destPath;
    }
}
