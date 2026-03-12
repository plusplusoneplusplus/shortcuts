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
