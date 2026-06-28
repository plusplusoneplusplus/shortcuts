/**
 * BaseFileStore — abstract base class for file-backed stores.
 *
 * Provides shared low-level infrastructure:
 * - Write-queue serialization (enqueueWrite)
 * - Atomic tmp→rename writes (atomicWrite)
 * - Safe JSON reads with default value (readJSON)
 * - Safe subdirectory listing (listDirectory)
 *
 * Pure Node.js.
 */
import * as fs from 'fs/promises';
import * as path from 'path';

export abstract class BaseFileStore {
    protected writeQueue: Promise<void> = Promise.resolve();

    /** Serialize async writes via a promise chain to prevent concurrent corruption. */
    protected enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    /** Write content atomically using a tmp file + rename. Creates parent dirs. */
    protected async atomicWrite(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, filePath);
    }

    /** Read and parse a JSON file, returning defaultValue on any error. */
    protected async readJSON<T>(filePath: string, defaultValue: T): Promise<T> {
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as T;
        } catch {
            return defaultValue;
        }
    }

    /** List immediate subdirectory names, returning [] on any error. */
    protected async listDirectory(dir: string): Promise<string[]> {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            return entries.filter(e => e.isDirectory()).map(e => e.name);
        } catch {
            return [];
        }
    }
}
