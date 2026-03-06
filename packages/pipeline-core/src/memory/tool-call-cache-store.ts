/**
 * FileToolCallCacheStore — persistence layer for the tool-call caching system.
 *
 * Stores raw tool-call Q&A entries as individual JSON files, consolidated
 * summaries, and cache index metadata on disk. Follows FileMemoryStore
 * patterns: atomic tmp→rename writes, write-queue serialization.
 *
 * No VS Code dependencies — pure Node.js.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type {
    ToolCallCacheStore,
    ToolCallCacheStoreOptions,
    ToolCallQAEntry,
    ToolCallCacheIndex,
    ConsolidatedToolCallEntry,
    ToolCallCacheStats,
} from './tool-call-cache-types';

export class FileToolCallCacheStore implements ToolCallCacheStore {
    private readonly cacheDir: string;
    private readonly rawDir: string;
    private writeQueue: Promise<void>;

    private static DEFAULT_INDEX: ToolCallCacheIndex = {
        lastAggregation: null,
        rawCount: 0,
        consolidatedCount: 0,
    };

    constructor(options?: ToolCallCacheStoreOptions) {
        const dataDir = options?.dataDir ?? process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc', 'memory');
        const cacheSubDir = options?.cacheSubDir ?? 'explore-cache';
        this.cacheDir = path.join(dataDir, cacheSubDir);
        this.rawDir = path.join(this.cacheDir, 'raw');
        this.writeQueue = Promise.resolve();
    }

    // --- Write queue serialization (FileMemoryStore pattern) ---

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(
            () => {},
            () => {},
        );
        return result;
    }

    // --- Atomic write helper ---

    private async atomicWrite(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, content, 'utf-8');
        await fs.rename(tmpPath, filePath);
    }

    // --- Filename helpers ---

    private sanitizeToolName(name: string): string {
        return name.replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    private generateRawFilename(entry: ToolCallQAEntry): string {
        const ts = new Date(entry.timestamp).getTime();
        const tool = this.sanitizeToolName(entry.toolName);
        return `${ts}-${tool}.json`;
    }

    // --- Path accessor ---

    getCacheDir(): string {
        return this.cacheDir;
    }

    // --- Raw Q&A entries ---

    async writeRaw(entry: ToolCallQAEntry): Promise<string> {
        const filename = this.generateRawFilename(entry);
        return this.enqueueWrite(async () => {
            await fs.mkdir(this.rawDir, { recursive: true });
            const filePath = path.join(this.rawDir, filename);
            const tmpPath = filePath + '.tmp';
            await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
            await fs.rename(tmpPath, filePath);
            return filename;
        });
    }

    async readRaw(filename: string): Promise<ToolCallQAEntry | undefined> {
        try {
            const filePath = path.join(this.rawDir, filename);
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as ToolCallQAEntry;
        } catch {
            return undefined;
        }
    }

    async listRaw(): Promise<string[]> {
        try {
            const files = await fs.readdir(this.rawDir);
            return files.filter(f => f.endsWith('.json')).sort().reverse();
        } catch {
            return [];
        }
    }

    async deleteRaw(filename: string): Promise<boolean> {
        return this.enqueueWrite(async () => {
            try {
                await fs.unlink(path.join(this.rawDir, filename));
                return true;
            } catch {
                return false;
            }
        });
    }

    // --- Consolidated entries ---

    async readConsolidated(): Promise<ConsolidatedToolCallEntry[]> {
        try {
            const filePath = path.join(this.cacheDir, 'consolidated.json');
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as ConsolidatedToolCallEntry[];
        } catch {
            return [];
        }
    }

    async writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void> {
        return this.enqueueWrite(async () => {
            const filePath = path.join(this.cacheDir, 'consolidated.json');
            await this.atomicWrite(filePath, JSON.stringify(entries, null, 2));
        });
    }

    // --- Index ---

    async readIndex(): Promise<ToolCallCacheIndex> {
        const filePath = path.join(this.cacheDir, 'index.json');
        try {
            const data = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(data) as ToolCallCacheIndex;
        } catch {
            return { ...FileToolCallCacheStore.DEFAULT_INDEX };
        }
    }

    async updateIndex(updates: Partial<ToolCallCacheIndex>): Promise<void> {
        return this.enqueueWrite(async () => {
            const existing = await this.readIndex();
            const merged: ToolCallCacheIndex = { ...existing, ...updates };
            const filePath = path.join(this.cacheDir, 'index.json');
            await this.atomicWrite(filePath, JSON.stringify(merged, null, 2));
        });
    }

    // --- Management ---

    async getStats(): Promise<ToolCallCacheStats> {
        let rawCount = 0;
        try {
            const entries = await fs.readdir(this.rawDir);
            rawCount = entries.filter(e => e.endsWith('.json')).length;
        } catch { /* dir may not exist */ }

        let consolidatedExists = false;
        let consolidatedCount = 0;
        try {
            const data = await fs.readFile(path.join(this.cacheDir, 'consolidated.json'), 'utf-8');
            consolidatedExists = true;
            consolidatedCount = (JSON.parse(data) as unknown[]).length;
        } catch { /* file may not exist */ }

        const index = await this.readIndex();

        return {
            rawCount,
            consolidatedExists,
            consolidatedCount,
            lastAggregation: index.lastAggregation,
        };
    }

    async clear(): Promise<void> {
        return this.enqueueWrite(async () => {
            try {
                await fs.rm(this.cacheDir, { recursive: true, force: true });
            } catch { /* dir may not exist */ }
        });
    }
}
