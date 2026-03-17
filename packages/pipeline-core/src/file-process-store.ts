/**
 * File-based ProcessStore Implementation
 *
 * Persistent AI process storage using JSON files in a configurable data directory.
 * Per-workspace subdirectory layout: processes/<workspaceId>/index.json + processes/<workspaceId>/<id>.json
 * Cross-workspace ID lookups via processes/_id-map.json.
 * Empty workspaceId maps to processes/_default/.
 *
 * No VS Code dependencies - designed for the standalone pipeline server.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

import { ProcessStore, ProcessFilter, ProcessIndexEntry, WorkspaceInfo, WikiInfo, ProcessChangeCallback, ProcessOutputEvent, StorageStats } from './process-store';
import {
    AIProcess,
    AIProcessStatus,
    SerializedAIProcess,
    serializeProcess,
    deserializeProcess,
    ProcessEvent
} from './ai/process-types';
import { withRetry } from './runtime/retry';
import { getLogger } from './logger';

/** On-disk shape for individual process files (processes/<workspaceId>/<id>.json) */
export interface StoredProcessEntry {
    workspaceId: string;
    process: SerializedAIProcess;
}

// Re-export ProcessIndexEntry from process-store for backward compatibility
export type { ProcessIndexEntry } from './process-store';

export interface FileProcessStoreOptions {
    /** Directory for data files. Default: ~/.coc/ */
    dataDir?: string;
    /** Maximum number of stored processes per workspace before pruning. Default: 500 */
    maxProcesses?: number;
    /** Optional callback invoked with entries removed during pruneIfNeeded() */
    onPrune?: (prunedEntries: StoredProcessEntry[]) => void;
}

/** Returns ~/.coc/ with ~ expanded via os.homedir(), overridden by COC_DATA_DIR env var */
export function getDefaultDataDir(): string {
    return process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc');
}

/** Creates directory (and parents) if it doesn't exist. Returns resolved path. */
export async function ensureDataDir(dirPath: string): Promise<string> {
    const resolved = path.resolve(dirPath);
    await fs.mkdir(resolved, { recursive: true });
    return resolved;
}

export class FileProcessStore implements ProcessStore {
    private readonly dataDir: string;
    private readonly maxProcesses: number;
    private readonly processesDir: string;
    private readonly idMapPath: string;
    private readonly workspacesPath: string;
    private readonly wikisPath: string;
    private writeQueue: Promise<void>;
    private readonly emitters: Map<string, EventEmitter> = new Map();
    private readonly flushHandlers: Map<string, () => Promise<void>> = new Map();

    onProcessChange?: ProcessChangeCallback;
    /** Optional callback invoked with entries removed during pruneIfNeeded() */
    onPrune?: (prunedEntries: StoredProcessEntry[]) => void;

    constructor(options?: FileProcessStoreOptions) {
        this.dataDir = options?.dataDir ?? getDefaultDataDir();
        this.maxProcesses = options?.maxProcesses ?? 500;
        this.processesDir = path.join(this.dataDir, 'processes');
        this.idMapPath = path.join(this.processesDir, '_id-map.json');
        this.workspacesPath = path.join(this.dataDir, 'workspaces.json');
        this.wikisPath = path.join(this.dataDir, 'wikis.json');
        this.writeQueue = Promise.resolve();
        this.onPrune = options?.onPrune;
    }

    // --- Per-workspace directory helpers ---

    private workspaceDirFor(workspaceId: string): string {
        return path.join(this.processesDir, workspaceId || '_default');
    }

    private indexPathFor(workspaceId: string): string {
        return path.join(this.workspaceDirFor(workspaceId), 'index.json');
    }

    private processFilePathFor(workspaceId: string, id: string): string {
        return path.join(this.workspaceDirFor(workspaceId), this.sanitizeId(id) + '.json');
    }

    // --- Process CRUD ---

    async addProcess(process: AIProcess): Promise<void> {
        await this.enqueueWrite(async () => {
            const workspaceId = process.metadata?.workspaceId ?? '';
            await ensureDataDir(this.workspaceDirFor(workspaceId));
            const entry: StoredProcessEntry = {
                workspaceId,
                process: serializeProcess(process)
            };
            // Write per-process file first (orphan on crash is harmless)
            await this.writeProcessFile(workspaceId, process.id, entry);
            // Append to workspace index then prune
            const index = await this.readIndex(workspaceId);
            index.push(this.toIndexEntry(entry));
            const { pruned, prunedIds } = await this.pruneIfNeeded(workspaceId, index);
            await this.writeIndex(workspaceId, pruned);
            // Update _id-map.json: add new entry, remove pruned entries
            const idMap = await this.readIdMap();
            idMap[process.id] = workspaceId;
            for (const id of prunedIds) { delete idMap[id]; }
            await this.writeIdMap(idMap);
        });
        this.onProcessChange?.({ type: 'process-added', process });
    }

    async getProcess(id: string, workspaceId?: string): Promise<AIProcess | undefined> {
        if (workspaceId !== undefined) {
            // Direct path — skip _id-map.json lookup
            const entry = await this.readProcessFile(workspaceId, id);
            if (!entry) return undefined;
            return deserializeProcess(entry.process);
        }
        // Look up workspaceId via _id-map.json
        const idMap = await this.readIdMap();
        const wsId = idMap[id];
        if (wsId === undefined) return undefined;
        const entry = await this.readProcessFile(wsId, id);
        if (!entry) return undefined;
        return deserializeProcess(entry.process);
    }

    async getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]> {
        if (filter?.workspaceId) {
            let indexEntries = await this.readIndex(filter.workspaceId);
            indexEntries = this.applyIndexFilters(indexEntries, filter);
            if (filter.limit !== undefined) {
                const offset = filter.offset ?? 0;
                indexEntries = indexEntries.slice(offset, offset + filter.limit);
            }
            const processes: AIProcess[] = [];
            for (const ie of indexEntries) {
                const entry = await this.readProcessFile(filter.workspaceId, ie.id);
                if (entry) { processes.push(deserializeProcess(entry.process)); }
            }
            return processes;
        }

        // Aggregate across all workspace subdirs
        let allIndexEntries = await this.aggregateAllIndices();
        allIndexEntries = this.applyIndexFilters(allIndexEntries, filter);
        if (filter?.limit !== undefined) {
            const offset = filter.offset ?? 0;
            allIndexEntries = allIndexEntries.slice(offset, offset + filter.limit);
        }
        const processes: AIProcess[] = [];
        for (const ie of allIndexEntries) {
            const entry = await this.readProcessFile(ie.workspaceId, ie.id);
            if (entry) { processes.push(deserializeProcess(entry.process)); }
        }
        return processes;
    }

    async getProcessSummaries(filter?: ProcessFilter): Promise<{ entries: ProcessIndexEntry[]; total: number }> {
        if (filter?.workspaceId) {
            let indexEntries = await this.readIndex(filter.workspaceId);
            indexEntries = this.applyIndexFilters(indexEntries, filter);
            const total = indexEntries.length;
            if (filter.limit !== undefined) {
                const offset = filter.offset ?? 0;
                indexEntries = indexEntries.slice(offset, offset + filter.limit);
            }
            return { entries: indexEntries, total };
        }

        let allIndexEntries = await this.aggregateAllIndices();
        allIndexEntries = this.applyIndexFilters(allIndexEntries, filter);
        const total = allIndexEntries.length;
        if (filter?.limit !== undefined) {
            const offset = filter.offset ?? 0;
            allIndexEntries = allIndexEntries.slice(offset, offset + filter.limit);
        }
        return { entries: allIndexEntries, total };
    }

    private applyIndexFilters(
        indexEntries: ProcessIndexEntry[],
        filter?: ProcessFilter
    ): ProcessIndexEntry[] {
        let entries = indexEntries;
        if (filter?.workspaceId) {
            entries = entries.filter(e => e.workspaceId === filter.workspaceId);
        }
        if (filter?.parentProcessId) {
            entries = entries.filter(e => e.parentProcessId === filter.parentProcessId);
        }
        if (filter?.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            entries = entries.filter(e => statuses.includes(e.status as AIProcessStatus));
        }
        if (filter?.type) {
            entries = entries.filter(e => e.type === filter.type);
        }
        if (filter?.since) {
            const sinceTime = filter.since.getTime();
            entries = entries.filter(e => new Date(e.startTime).getTime() >= sinceTime);
        }
        return entries;
    }

    async updateProcess(id: string, updates: Partial<AIProcess>): Promise<void> {
        let updated: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            const idMap = await this.readIdMap();
            const workspaceId = idMap[id];
            if (workspaceId === undefined) { return; }

            const entry = await this.readProcessFile(workspaceId, id);
            if (!entry) { return; }

            const existing = deserializeProcess(entry.process);
            const merged = { ...existing, ...updates };
            const newEntry: StoredProcessEntry = {
                workspaceId: merged.metadata?.workspaceId ?? entry.workspaceId,
                process: serializeProcess(merged)
            };
            await this.writeProcessFile(workspaceId, id, newEntry);

            // Update workspace index entry
            const index = await this.readIndex(workspaceId);
            const idx = index.findIndex(e => e.id === id);
            if (idx !== -1) {
                index[idx] = this.toIndexEntry(newEntry);
                await this.writeIndex(workspaceId, index);
            }
            updated = merged;
        });
        if (updated) {
            this.onProcessChange?.({ type: 'process-updated', process: updated });
        }
    }

    async removeProcess(id: string): Promise<void> {
        let removed: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            const idMap = await this.readIdMap();
            const workspaceId = idMap[id];
            if (workspaceId === undefined) { return; }

            const entry = await this.readProcessFile(workspaceId, id);
            if (!entry) { return; }
            removed = deserializeProcess(entry.process);
            await this.deleteProcessFile(workspaceId, id);
            const index = await this.readIndex(workspaceId);
            const filtered = index.filter(e => e.id !== id);
            await this.writeIndex(workspaceId, filtered);
            // Remove from _id-map.json
            delete idMap[id];
            await this.writeIdMap(idMap);
        });
        if (removed) {
            this.onProcessChange?.({ type: 'process-removed', process: removed });
        }
    }

    async clearProcesses(filter?: ProcessFilter): Promise<number> {
        let count = 0;
        await this.enqueueWrite(async () => {
            const workspaceDirs = filter?.workspaceId
                ? [filter.workspaceId]
                : await this.listWorkspaceDirs();

            const deletedIds: string[] = [];
            for (const wsId of workspaceDirs) {
                const index = await this.readIndex(wsId);
                const remaining: ProcessIndexEntry[] = [];
                const toDelete: string[] = [];

                for (const ie of index) {
                    let match = true;
                    // workspaceId is already handled by iterating the right workspaceDirs
                    if (match && filter?.parentProcessId) {
                        match = ie.parentProcessId === filter.parentProcessId;
                    }
                    if (match && filter?.status) {
                        const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                        match = statuses.includes(ie.status as AIProcessStatus);
                    }
                    if (match && filter?.type) { match = ie.type === filter.type; }

                    if (match) { toDelete.push(ie.id); }
                    else { remaining.push(ie); }
                }

                await Promise.all(toDelete.map(id => this.deleteProcessFile(wsId, id)));
                await this.writeIndex(wsId, remaining);
                count += toDelete.length;
                deletedIds.push(...toDelete);
            }

            // Update _id-map.json
            if (deletedIds.length > 0) {
                const idMap = await this.readIdMap();
                for (const id of deletedIds) { delete idMap[id]; }
                await this.writeIdMap(idMap);
            }
        });
        this.onProcessChange?.({ type: 'processes-cleared' });
        return count;
    }

    async registerWorkspace(workspace: WorkspaceInfo): Promise<void> {
        await this.enqueueWrite(async () => {
            await ensureDataDir(this.dataDir);
            const workspaces = await this.readWorkspaces();
            const idx = workspaces.findIndex(w => w.id === workspace.id);
            if (idx >= 0) {
                workspaces[idx] = { ...workspaces[idx], ...workspace };
            } else {
                workspaces.push(workspace);
            }
            await this.writeWorkspaces(workspaces);
        });
    }

    async getWorkspaces(): Promise<WorkspaceInfo[]> {
        return this.readWorkspaces();
    }

    async removeWorkspace(id: string): Promise<boolean> {
        let found = false;
        await this.enqueueWrite(async () => {
            const workspaces = await this.readWorkspaces();
            const idx = workspaces.findIndex(w => w.id === id);
            if (idx >= 0) {
                workspaces.splice(idx, 1);
                await this.writeWorkspaces(workspaces);
                found = true;
            }
        });
        return found;
    }

    async updateWorkspace(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<WorkspaceInfo | undefined> {
        let updated: WorkspaceInfo | undefined;
        await this.enqueueWrite(async () => {
            const workspaces = await this.readWorkspaces();
            const idx = workspaces.findIndex(w => w.id === id);
            if (idx >= 0) {
                if (updates.name !== undefined) { workspaces[idx].name = updates.name; }
                if (updates.rootPath !== undefined) { workspaces[idx].rootPath = updates.rootPath; }
                if (updates.color !== undefined) { workspaces[idx].color = updates.color; }
                if (updates.remoteUrl !== undefined) { workspaces[idx].remoteUrl = updates.remoteUrl; }
                if ('enabledMcpServers' in updates) { workspaces[idx].enabledMcpServers = updates.enabledMcpServers; }
                if ('disabledSkills' in updates) { workspaces[idx].disabledSkills = updates.disabledSkills; }
                updated = { ...workspaces[idx] };
                await this.writeWorkspaces(workspaces);
            }
        });
        return updated;
    }

    // --- Wiki CRUD ---

    async registerWiki(wiki: WikiInfo): Promise<void> {
        await this.enqueueWrite(async () => {
            await ensureDataDir(this.dataDir);
            const wikis = await this.readWikis();
            const idx = wikis.findIndex(w => w.id === wiki.id);
            if (idx >= 0) {
                wikis[idx] = wiki;
            } else {
                wikis.push(wiki);
            }
            await this.writeWikis(wikis);
        });
    }

    async getWikis(): Promise<WikiInfo[]> {
        return this.readWikis();
    }

    async removeWiki(id: string): Promise<boolean> {
        let found = false;
        await this.enqueueWrite(async () => {
            const wikis = await this.readWikis();
            const idx = wikis.findIndex(w => w.id === id);
            if (idx >= 0) {
                wikis.splice(idx, 1);
                await this.writeWikis(wikis);
                found = true;
            }
        });
        return found;
    }

    async updateWiki(id: string, updates: Partial<Omit<WikiInfo, 'id'>>): Promise<WikiInfo | undefined> {
        let updated: WikiInfo | undefined;
        await this.enqueueWrite(async () => {
            const wikis = await this.readWikis();
            const idx = wikis.findIndex(w => w.id === id);
            if (idx >= 0) {
                if (updates.name !== undefined) { wikis[idx].name = updates.name; }
                if (updates.wikiDir !== undefined) { wikis[idx].wikiDir = updates.wikiDir; }
                if (updates.repoPath !== undefined) { wikis[idx].repoPath = updates.repoPath; }
                if (updates.color !== undefined) { wikis[idx].color = updates.color; }
                if (updates.aiEnabled !== undefined) { wikis[idx].aiEnabled = updates.aiEnabled; }
                if (updates.registeredAt !== undefined) { wikis[idx].registeredAt = updates.registeredAt; }
                updated = { ...wikis[idx] };
                await this.writeWikis(wikis);
            }
        });
        return updated;
    }

    // --- Admin: bulk clear & stats ---

    async clearAllWorkspaces(): Promise<number> {
        let count = 0;
        await this.enqueueWrite(async () => {
            const workspaces = await this.readWorkspaces();
            count = workspaces.length;
            if (count > 0) {
                await this.writeWorkspaces([]);
            }
        });
        return count;
    }

    async clearAllWikis(): Promise<number> {
        let count = 0;
        await this.enqueueWrite(async () => {
            const wikis = await this.readWikis();
            count = wikis.length;
            if (count > 0) {
                await this.writeWikis([]);
            }
        });
        return count;
    }

    async getStorageStats(): Promise<StorageStats> {
        // Use getProcessSummaries() instead of getAllProcesses() to avoid reading every process file
        const [summaries, workspaces, wikis] = await Promise.all([
            this.getProcessSummaries(),
            this.getWorkspaces(),
            this.getWikis(),
        ]);

        // Stat meta files in parallel
        const metaSizes = await Promise.all(
            [this.idMapPath, this.workspacesPath, this.wikisPath].map(async (filePath) => {
                try {
                    const stat = await fs.stat(filePath);
                    return stat.size;
                } catch {
                    return 0;
                }
            })
        );
        let storageSize = metaSizes.reduce((sum, size) => sum + size, 0);

        // Sum file sizes in each workspace dir
        try {
            const workspaceDirIds = await this.listWorkspaceDirs();
            for (const wsId of workspaceDirIds) {
                const wsDir = this.workspaceDirFor(wsId);
                try {
                    const entries = await fs.readdir(wsDir);
                    const sizes = await Promise.all(
                        entries.map(async (entry) => {
                            try {
                                const stat = await fs.stat(path.join(wsDir, entry));
                                return stat.isFile() ? stat.size : 0;
                            } catch {
                                return 0;
                            }
                        })
                    );
                    storageSize += sizes.reduce((sum, size) => sum + size, 0);
                } catch {
                    // workspace dir may not exist
                }
            }
        } catch {
            // processesDir may not exist yet
        }

        return {
            totalProcesses: summaries.total,
            totalWorkspaces: workspaces.length,
            totalWikis: wikis.length,
            storageSize,
        };
    }

    // --- Internal helpers: per-workspace index + process files ---

    /** Transient FS error codes worth retrying */
    private static readonly RETRYABLE_FS_ERRORS = new Set(['EACCES', 'EBUSY', 'EPERM', 'ENOLCK', 'EIO']);

    /**
     * Wrap an atomic write (writeFile + rename) with retry logic.
     * Retries only on transient FS errors; cleans up stale .tmp on final failure.
     */
    private async retryAtomicWrite(tmpPath: string, fn: () => Promise<void>): Promise<void> {
        const logger = getLogger();
        try {
            await withRetry(fn, {
                attempts: 3,
                delayMs: 100,
                backoff: 'exponential',
                maxDelayMs: 2000,
                operationName: `atomic write ${path.basename(tmpPath)}`,
                retryOn: (error: unknown) => {
                    const code = (error as NodeJS.ErrnoException)?.code;
                    return !!code && FileProcessStore.RETRYABLE_FS_ERRORS.has(code);
                },
                onAttempt: (attempt, maxAttempts, lastError) => {
                    if (attempt > 1) {
                        const code = (lastError as NodeJS.ErrnoException)?.code ?? 'unknown';
                        logger.warn('FileProcessStore', `Retrying atomic write (attempt ${attempt}/${maxAttempts}) after ${code}: ${path.basename(tmpPath)}`);
                    }
                },
            });
        } catch (outerError) {
            // Best-effort cleanup of stale .tmp file
            try { await fs.unlink(tmpPath); } catch { /* ignore */ }
            throw outerError;
        }
    }

    private sanitizeId(id: string): string {
        return id.replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    private async readIndex(workspaceId: string): Promise<ProcessIndexEntry[]> {
        try {
            const data = await fs.readFile(this.indexPathFor(workspaceId), 'utf-8');
            return JSON.parse(data) as ProcessIndexEntry[];
        } catch {
            return [];
        }
    }

    private async writeIndex(workspaceId: string, entries: ProcessIndexEntry[]): Promise<void> {
        await ensureDataDir(this.workspaceDirFor(workspaceId));
        const indexPath = this.indexPathFor(workspaceId);
        const tmpPath = indexPath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
            await fs.rename(tmpPath, indexPath);
        });
    }

    private async readIdMap(): Promise<Record<string, string>> {
        try {
            const data = await fs.readFile(this.idMapPath, 'utf-8');
            return JSON.parse(data) as Record<string, string>;
        } catch {
            return {};
        }
    }

    private async writeIdMap(map: Record<string, string>): Promise<void> {
        const tmpPath = this.idMapPath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(map, null, 2), 'utf-8');
            await fs.rename(tmpPath, this.idMapPath);
        });
    }

    private async readProcessFile(workspaceId: string, id: string): Promise<StoredProcessEntry | undefined> {
        try {
            const data = await fs.readFile(this.processFilePathFor(workspaceId, id), 'utf-8');
            return JSON.parse(data) as StoredProcessEntry;
        } catch {
            return undefined;
        }
    }

    private async writeProcessFile(workspaceId: string, id: string, entry: StoredProcessEntry): Promise<void> {
        const filePath = this.processFilePathFor(workspaceId, id);
        const tmpPath = filePath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
            await fs.rename(tmpPath, filePath);
        });
    }

    private async deleteProcessFile(workspaceId: string, id: string): Promise<void> {
        try {
            await fs.unlink(this.processFilePathFor(workspaceId, id));
        } catch {
            // Ignore missing file
        }
    }

    private async listWorkspaceDirs(): Promise<string[]> {
        try {
            const entries = await fs.readdir(this.processesDir, { withFileTypes: true });
            return entries
                .filter(e => e.isDirectory())
                .map(e => e.name);
        } catch {
            return [];
        }
    }

    private async aggregateAllIndices(): Promise<ProcessIndexEntry[]> {
        const workspaceDirs = await this.listWorkspaceDirs();
        const all: ProcessIndexEntry[] = [];
        for (const wsId of workspaceDirs) {
            const entries = await this.readIndex(wsId);
            all.push(...entries);
        }
        return all;
    }

    private toIndexEntry(entry: StoredProcessEntry): ProcessIndexEntry {
        return {
            id: entry.process.id,
            workspaceId: entry.workspaceId,
            status: entry.process.status,
            type: entry.process.type || 'clarification',
            startTime: entry.process.startTime,
            endTime: entry.process.endTime,
            promptPreview: entry.process.promptPreview,
            error: entry.process.error,
            parentProcessId: entry.process.parentProcessId,
            title: entry.process.title,
            duration: entry.process.endTime && entry.process.startTime
                ? new Date(entry.process.endTime).getTime() - new Date(entry.process.startTime).getTime()
                : undefined,
        };
    }

    private async pruneIfNeeded(workspaceId: string, entries: ProcessIndexEntry[]): Promise<{ pruned: ProcessIndexEntry[], prunedIds: string[] }> {
        if (entries.length <= this.maxProcesses) {
            return { pruned: entries, prunedIds: [] };
        }

        // Separate non-terminal (running/queued) from terminal processes
        const nonTerminal: ProcessIndexEntry[] = [];
        const terminal: ProcessIndexEntry[] = [];
        for (const entry of entries) {
            if (entry.status === 'running' || entry.status === 'queued') {
                nonTerminal.push(entry);
            } else {
                terminal.push(entry);
            }
        }

        // Sort terminal by startTime ascending (oldest first)
        terminal.sort((a, b) => {
            const timeA = new Date(a.startTime).getTime();
            const timeB = new Date(b.startTime).getTime();
            return timeA - timeB;
        });

        // Remove oldest terminal entries until within limit
        const toKeep = this.maxProcesses - nonTerminal.length;
        const keptTerminal = toKeep > 0 ? terminal.slice(terminal.length - toKeep) : [];

        const prunedCount = terminal.length - keptTerminal.length;
        const prunedIds: string[] = [];

        if (prunedCount > 0) {
            const prunedEntries = terminal.slice(0, prunedCount);
            prunedIds.push(...prunedEntries.map(e => e.id));

            // Notify about pruned entries (load full data for onPrune callback)
            if (this.onPrune) {
                const fullEntries: StoredProcessEntry[] = [];
                for (const ie of prunedEntries) {
                    const entry = await this.readProcessFile(workspaceId, ie.id);
                    if (entry) { fullEntries.push(entry); }
                }
                if (fullEntries.length > 0) {
                    this.onPrune(fullEntries);
                }
            }

            // Delete pruned process files
            await Promise.all(prunedEntries.map(e => this.deleteProcessFile(workspaceId, e.id)));
        }

        return { pruned: [...nonTerminal, ...keptTerminal], prunedIds };
    }

    onProcessOutput(id: string, callback: (event: ProcessOutputEvent) => void): () => void {
        let emitter = this.emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            this.emitters.set(id, emitter);
        }
        const listener = (event: ProcessOutputEvent) => callback(event);
        emitter.on('output', listener);
        return () => {
            emitter!.removeListener('output', listener);
        };
    }

    emitProcessOutput(id: string, content: string): void {
        let emitter = this.emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            this.emitters.set(id, emitter);
        }
        const event: ProcessOutputEvent = { type: 'chunk', content };
        emitter.emit('output', event);
    }

    emitProcessComplete(id: string, status: AIProcessStatus, duration: string): void {
        const emitter = this.emitters.get(id);
        if (!emitter) { return; }
        const event: ProcessOutputEvent = { type: 'complete', status, duration };
        emitter.emit('output', event);
        // Clean up emitter after notifying all listeners
        this.emitters.delete(id);
    }

    emitProcessEvent(id: string, event: ProcessOutputEvent): void {
        let emitter = this.emitters.get(id);
        if (!emitter) {
            emitter = new EventEmitter();
            this.emitters.set(id, emitter);
        }
        emitter.emit('output', event);
    }

    registerFlushHandler(id: string, handler: () => Promise<void>): void {
        this.flushHandlers.set(id, handler);
    }

    unregisterFlushHandler(id: string): void {
        this.flushHandlers.delete(id);
    }

    async requestFlush(id: string): Promise<void> {
        const handler = this.flushHandlers.get(id);
        if (handler) { await handler(); }
    }

    private async readWorkspaces(): Promise<WorkspaceInfo[]> {
        try {
            const data = await fs.readFile(this.workspacesPath, 'utf-8');
            return JSON.parse(data) as WorkspaceInfo[];
        } catch {
            return [];
        }
    }

    private async writeWorkspaces(workspaces: WorkspaceInfo[]): Promise<void> {
        const tmpPath = this.workspacesPath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(workspaces, null, 2), 'utf-8');
            await fs.rename(tmpPath, this.workspacesPath);
        });
    }

    private async readWikis(): Promise<WikiInfo[]> {
        try {
            const data = await fs.readFile(this.wikisPath, 'utf-8');
            return JSON.parse(data) as WikiInfo[];
        } catch {
            return [];
        }
    }

    private async writeWikis(wikis: WikiInfo[]): Promise<void> {
        const tmpPath = this.wikisPath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(wikis, null, 2), 'utf-8');
            await fs.rename(tmpPath, this.wikisPath);
        });
    }

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => {}, () => {});
        return result;
    }

}
