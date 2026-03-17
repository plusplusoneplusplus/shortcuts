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
    ConsolidatedIndexEntry,
    ToolCallCacheStats,
} from './tool-call-cache-types';
import { getRemoteUrl, computeRemoteHash } from '../git/remote';
import { computeRepoHash } from './memory-store';

/**
 * Resolve the appropriate {@link ToolCallCacheStoreOptions} for a given
 * working directory, cascading through git-remote → repo → system scope.
 *
 * 1. If `workDir` is provided and has a git remote → `git-remote` level.
 * 2. If `workDir` is provided but no remote → `repo` level (local-only repo).
 * 3. If no `workDir` → `system` level (unchanged legacy behavior).
 */
export function resolveToolCallCacheOptions(
    workDir?: string,
    dataDir?: string,
): ToolCallCacheStoreOptions {
    const base: ToolCallCacheStoreOptions = {};
    if (dataDir) {
        base.dataDir = dataDir;
    }

    if (!workDir) {
        return { ...base, level: 'system' };
    }

    const remoteUrl = getRemoteUrl(workDir);
    if (remoteUrl) {
        return { ...base, level: 'git-remote', remoteHash: computeRemoteHash(remoteUrl) };
    }

    return { ...base, level: 'repo', repoHash: computeRepoHash(workDir) };
}

export class FileToolCallCacheStore implements ToolCallCacheStore {
    private readonly cacheDir: string;
    private readonly rawDir: string;
    private readonly dataDir: string;
    private readonly cacheSubDir: string;
    private writeQueue: Promise<void>;
    private migrated = false;

    private static DEFAULT_INDEX: ToolCallCacheIndex = {
        lastAggregation: null,
        rawCount: 0,
        consolidatedCount: 0,
    };

    constructor(options?: ToolCallCacheStoreOptions) {
        const dataDir = options?.dataDir ?? process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc', 'memory');
        const cacheSubDir = options?.cacheSubDir ?? 'explore-cache';
        const level = options?.level ?? 'system';

        this.dataDir = dataDir;
        this.cacheSubDir = cacheSubDir;

        switch (level) {
            case 'git-remote':
                this.cacheDir = path.join(dataDir, 'git-remotes', options?.remoteHash ?? 'unknown', cacheSubDir);
                break;
            case 'repo':
                this.cacheDir = path.join(dataDir, 'repos', options?.repoHash ?? 'unknown', cacheSubDir);
                break;
            case 'system':
            default:
                this.cacheDir = path.join(dataDir, cacheSubDir);
                break;
        }

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

    private sanitizeEntryId(id: string): string {
        return id.replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    // --- Path accessors ---

    getCacheDir(): string {
        return this.cacheDir;
    }

    private get consolidatedDir(): string {
        return path.join(this.cacheDir, 'consolidated');
    }

    private get entriesDir(): string {
        return path.join(this.cacheDir, 'consolidated', 'entries');
    }

    private get consolidatedIndexPath(): string {
        return path.join(this.cacheDir, 'consolidated', 'index.json');
    }

    /** Legacy path for migration detection. */
    private get legacyConsolidatedPath(): string {
        return path.join(this.cacheDir, 'consolidated.json');
    }

    /** Absolute path to the git-remote scoped explore-cache for the given remoteHash. */
    getGitRemoteDir(remoteHash: string): string {
        return path.join(this.dataDir, 'git-remotes', remoteHash, this.cacheSubDir);
    }

    /** Absolute path to the repo-scoped explore-cache for the given repoHash. */
    getRepoExploreDir(repoHash: string): string {
        return path.join(this.dataDir, 'repos', repoHash, this.cacheSubDir);
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

    /** Auto-migrate legacy consolidated.json to hierarchical layout on first access. */
    private async migrateIfNeeded(): Promise<void> {
        if (this.migrated) return;
        this.migrated = true;
        try {
            // Check if new-format index already exists — prefer it
            await fs.access(this.consolidatedIndexPath);
            return;
        } catch { /* new format not found, check legacy */ }
        try {
            const data = await fs.readFile(this.legacyConsolidatedPath, 'utf-8');
            const entries = JSON.parse(data) as ConsolidatedToolCallEntry[];
            await this.writeConsolidatedInternal(entries);
            await fs.unlink(this.legacyConsolidatedPath);
        } catch { /* no legacy file either — nothing to migrate */ }
    }

    /** Strip answer field from a full entry to produce an index-only entry. */
    private static toIndexEntry(entry: ConsolidatedToolCallEntry): ConsolidatedIndexEntry {
        const { answer: _, ...rest } = entry;
        return rest;
    }

    /**
     * Internal write that splits entries into index + individual answer files.
     * Cleans up orphaned answer files not in the new entry set.
     */
    private async writeConsolidatedInternal(entries: ConsolidatedToolCallEntry[]): Promise<void> {
        await fs.mkdir(this.entriesDir, { recursive: true });

        // Write each answer file
        const newIds = new Set<string>();
        for (const entry of entries) {
            const safeId = this.sanitizeEntryId(entry.id);
            newIds.add(safeId);
            const answerPath = path.join(this.entriesDir, `${safeId}.md`);
            await this.atomicWrite(answerPath, entry.answer);
        }

        // Write index (answer-free)
        const indexEntries = entries.map(e => FileToolCallCacheStore.toIndexEntry(e));
        await this.atomicWrite(this.consolidatedIndexPath, JSON.stringify(indexEntries, null, 2));

        // Clean up orphaned answer files
        try {
            const files = await fs.readdir(this.entriesDir);
            for (const file of files) {
                if (!file.endsWith('.md')) continue;
                const id = file.slice(0, -3);
                if (!newIds.has(id)) {
                    await fs.unlink(path.join(this.entriesDir, file)).catch(() => {});
                }
            }
        } catch { /* entries dir may not exist yet */ }
    }

    async readConsolidated(): Promise<ConsolidatedToolCallEntry[]> {
        await this.migrateIfNeeded();
        try {
            const data = await fs.readFile(this.consolidatedIndexPath, 'utf-8');
            const indexEntries = JSON.parse(data) as ConsolidatedIndexEntry[];
            const full: ConsolidatedToolCallEntry[] = [];
            for (const entry of indexEntries) {
                const answer = await this.readEntryAnswer(entry.id);
                full.push({ ...entry, answer: answer ?? '' });
            }
            return full;
        } catch {
            return [];
        }
    }

    async writeConsolidated(entries: ConsolidatedToolCallEntry[]): Promise<void> {
        return this.enqueueWrite(async () => {
            await this.writeConsolidatedInternal(entries);
        });
    }

    async readConsolidatedIndex(): Promise<ConsolidatedIndexEntry[]> {
        await this.migrateIfNeeded();
        try {
            const data = await fs.readFile(this.consolidatedIndexPath, 'utf-8');
            return JSON.parse(data) as ConsolidatedIndexEntry[];
        } catch {
            return [];
        }
    }

    async readEntryAnswer(id: string): Promise<string | undefined> {
        try {
            const safeId = this.sanitizeEntryId(id);
            const answerPath = path.join(this.entriesDir, `${safeId}.md`);
            return await fs.readFile(answerPath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    async writeConsolidatedEntry(entry: ConsolidatedToolCallEntry): Promise<void> {
        return this.enqueueWrite(async () => {
            await fs.mkdir(this.entriesDir, { recursive: true });

            // Write answer file
            const safeId = this.sanitizeEntryId(entry.id);
            const answerPath = path.join(this.entriesDir, `${safeId}.md`);
            await this.atomicWrite(answerPath, entry.answer);

            // Update index — read, upsert, write
            let indexEntries: ConsolidatedIndexEntry[] = [];
            try {
                const data = await fs.readFile(this.consolidatedIndexPath, 'utf-8');
                indexEntries = JSON.parse(data) as ConsolidatedIndexEntry[];
            } catch { /* no index yet */ }

            const indexEntry = FileToolCallCacheStore.toIndexEntry(entry);
            const existingIdx = indexEntries.findIndex(e => e.id === entry.id);
            if (existingIdx >= 0) {
                indexEntries[existingIdx] = indexEntry;
            } else {
                indexEntries.push(indexEntry);
            }
            await this.atomicWrite(this.consolidatedIndexPath, JSON.stringify(indexEntries, null, 2));
        });
    }

    async deleteConsolidatedEntry(id: string): Promise<boolean> {
        return this.enqueueWrite(async () => {
            let found = false;

            // Remove from index
            try {
                const data = await fs.readFile(this.consolidatedIndexPath, 'utf-8');
                const indexEntries = JSON.parse(data) as ConsolidatedIndexEntry[];
                const filtered = indexEntries.filter(e => e.id !== id);
                if (filtered.length < indexEntries.length) {
                    found = true;
                    await this.atomicWrite(this.consolidatedIndexPath, JSON.stringify(filtered, null, 2));
                }
            } catch { /* no index */ }

            // Delete answer file
            try {
                const safeId = this.sanitizeEntryId(id);
                await fs.unlink(path.join(this.entriesDir, `${safeId}.md`));
                found = true;
            } catch { /* file may not exist */ }

            return found;
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
        await this.migrateIfNeeded();
        let rawCount = 0;
        try {
            const entries = await fs.readdir(this.rawDir);
            rawCount = entries.filter(e => e.endsWith('.json')).length;
        } catch { /* dir may not exist */ }

        let consolidatedExists = false;
        let consolidatedCount = 0;
        try {
            const data = await fs.readFile(this.consolidatedIndexPath, 'utf-8');
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
