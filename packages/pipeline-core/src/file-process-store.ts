/**
 * File-based ProcessStore Implementation
 *
 * Persistent AI process storage using JSON files in a configurable data directory.
 * Supports multi-workspace process tagging, atomic writes, and automatic retention pruning.
 *
 * No VS Code dependencies - designed for the standalone pipeline server.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';

import { ProcessStore, ProcessFilter, WorkspaceInfo, WikiInfo, ProcessChangeCallback, ProcessOutputEvent, StorageStats } from './process-store';
import {
    AIProcess,
    AIProcessStatus,
    SerializedAIProcess,
    serializeProcess,
    deserializeProcess,
    ProcessEvent
} from './ai/process-types';

/** On-disk shape for individual process files (processes/<id>.json) */
export interface StoredProcessEntry {
    workspaceId: string;
    process: SerializedAIProcess;
}

// ============================================================================
// Process Type Migration
// ============================================================================

/** Map of legacy queue process types to the unified `queue-chat` type. */
const LEGACY_PROCESS_TYPE_MAP: Record<string, string> = {
    'queue-follow-prompt': 'queue-chat',
    'queue-ai-clarification': 'queue-chat',
    'queue-resolve-comments': 'queue-chat',
    'queue-code-review': 'queue-chat',
    'queue-task-generation': 'queue-chat',
    'queue-custom': 'queue-chat',
};

/**
 * Normalize a legacy process type string to the unified model.
 * Processes stored as `queue-follow-prompt`, `queue-ai-clarification`, etc.
 * are migrated to `queue-chat` on read. Non-matching types pass through.
 */
function migrateProcessType(type: string | undefined): string | undefined {
    if (!type) return type;
    return LEGACY_PROCESS_TYPE_MAP[type] ?? type;
}

/** Lightweight index entry stored in processes/index.json */
export interface ProcessIndexEntry {
    id: string;
    workspaceId: string;
    status: string;
    type: string;
    startTime: string;
    endTime?: string;
    promptPreview: string;
    error?: string;
    parentProcessId?: string;
}

export interface FileProcessStoreOptions {
    /** Directory for data files. Default: ~/.coc/ */
    dataDir?: string;
    /** Maximum number of stored processes before pruning. Default: 500 */
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
    private readonly indexPath: string;
    private readonly legacyProcessesPath: string;
    private readonly workspacesPath: string;
    private readonly wikisPath: string;
    private writeQueue: Promise<void>;
    private readonly emitters: Map<string, EventEmitter> = new Map();
    private readonly flushHandlers: Map<string, () => Promise<void>> = new Map();
    private initPromise: Promise<void> | null = null;

    onProcessChange?: ProcessChangeCallback;
    /** Optional callback invoked with entries removed during pruneIfNeeded() */
    onPrune?: (prunedEntries: StoredProcessEntry[]) => void;

    constructor(options?: FileProcessStoreOptions) {
        this.dataDir = options?.dataDir ?? getDefaultDataDir();
        this.maxProcesses = options?.maxProcesses ?? 500;
        this.processesDir = path.join(this.dataDir, 'processes');
        this.indexPath = path.join(this.processesDir, 'index.json');
        this.legacyProcessesPath = path.join(this.dataDir, 'processes.json');
        this.workspacesPath = path.join(this.dataDir, 'workspaces.json');
        this.wikisPath = path.join(this.dataDir, 'wikis.json');
        this.writeQueue = Promise.resolve();
        this.onPrune = options?.onPrune;
    }

    private ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = this.migrateIfNeeded();
        }
        return this.initPromise;
    }

    async addProcess(process: AIProcess): Promise<void> {
        await this.enqueueWrite(async () => {
            await this.ensureInitialized();
            await ensureDataDir(this.processesDir);
            const workspaceId = process.metadata?.workspaceId ?? '';
            const entry: StoredProcessEntry = {
                workspaceId,
                process: serializeProcess(process)
            };
            // Write per-process file first (orphan on crash is harmless)
            await this.writeProcessFile(process.id, entry);
            // Append to index then prune
            const index = await this.readIndex();
            index.push(this.toIndexEntry(entry));
            const pruned = await this.pruneIfNeeded(index);
            await this.writeIndex(pruned);
        });
        this.onProcessChange?.({ type: 'process-added', process });
    }

    async getProcess(id: string): Promise<AIProcess | undefined> {
        await this.ensureInitialized();
        const entry = await this.readProcessFile(id);
        if (!entry) return undefined;
        entry.process.type = migrateProcessType(entry.process.type);
        return deserializeProcess(entry.process);
    }

    async getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]> {
        await this.ensureInitialized();
        let indexEntries = await this.readIndex();

        // Filter on index fields first (no file I/O)
        if (filter?.workspaceId) {
            indexEntries = indexEntries.filter(e => e.workspaceId === filter.workspaceId);
        }
        if (filter?.parentProcessId) {
            indexEntries = indexEntries.filter(e => e.parentProcessId === filter.parentProcessId);
        }
        if (filter?.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            indexEntries = indexEntries.filter(e => statuses.includes(e.status as AIProcessStatus));
        }
        if (filter?.type) {
            indexEntries = indexEntries.filter(e => {
                const migrated = migrateProcessType(e.type);
                return migrated === filter.type || e.type === filter.type;
            });
        }
        if (filter?.since) {
            const sinceTime = filter.since.getTime();
            indexEntries = indexEntries.filter(e => new Date(e.startTime).getTime() >= sinceTime);
        }

        // Apply pagination on index
        if (filter?.limit !== undefined) {
            const offset = filter.offset ?? 0;
            indexEntries = indexEntries.slice(offset, offset + filter.limit);
        }

        // Load only matching process files
        const processes: AIProcess[] = [];
        for (const ie of indexEntries) {
            const entry = await this.readProcessFile(ie.id);
            if (entry) {
                entry.process.type = migrateProcessType(entry.process.type);
                processes.push(deserializeProcess(entry.process));
            }
        }

        return processes;
    }

    async updateProcess(id: string, updates: Partial<AIProcess>): Promise<void> {
        let updated: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            await this.ensureInitialized();
            const entry = await this.readProcessFile(id);
            if (!entry) { return; }

            const existing = deserializeProcess(entry.process);
            const merged = { ...existing, ...updates };
            const newEntry: StoredProcessEntry = {
                workspaceId: merged.metadata?.workspaceId ?? entry.workspaceId,
                process: serializeProcess(merged)
            };
            await this.writeProcessFile(id, newEntry);

            // Update index entry
            const index = await this.readIndex();
            const idx = index.findIndex(e => e.id === id);
            if (idx !== -1) {
                index[idx] = this.toIndexEntry(newEntry);
                await this.writeIndex(index);
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
            await this.ensureInitialized();
            const entry = await this.readProcessFile(id);
            if (!entry) { return; }
            removed = deserializeProcess(entry.process);
            await this.deleteProcessFile(id);
            const index = await this.readIndex();
            const filtered = index.filter(e => e.id !== id);
            await this.writeIndex(filtered);
        });
        if (removed) {
            this.onProcessChange?.({ type: 'process-removed', process: removed });
        }
    }

    async clearProcesses(filter?: ProcessFilter): Promise<number> {
        let count = 0;
        await this.enqueueWrite(async () => {
            await this.ensureInitialized();
            const index = await this.readIndex();
            if (!filter) {
                count = index.length;
                // Delete all process files
                await Promise.all(index.map(e => this.deleteProcessFile(e.id)));
                await this.writeIndex([]);
                return;
            }

            const remaining: ProcessIndexEntry[] = [];
            const toDelete: string[] = [];
            for (const ie of index) {
                let match = true;

                if (filter.workspaceId) {
                    match = ie.workspaceId === filter.workspaceId;
                }

                if (match && filter.parentProcessId) {
                    match = ie.parentProcessId === filter.parentProcessId;
                }

                if (match && filter.status) {
                    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                    match = statuses.includes(ie.status as AIProcessStatus);
                }

                if (match && filter.type) {
                    match = ie.type === filter.type;
                }

                if (match) {
                    count++;
                    toDelete.push(ie.id);
                } else {
                    remaining.push(ie);
                }
            }
            await Promise.all(toDelete.map(id => this.deleteProcessFile(id)));
            await this.writeIndex(remaining);
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
                workspaces[idx] = workspace;
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
        await this.ensureInitialized();
        const [processes, workspaces, wikis] = await Promise.all([
            this.getAllProcesses(),
            this.getWorkspaces(),
            this.getWikis(),
        ]);

        let storageSize = 0;
        // Sum up index file + all per-process files + workspaces + wikis
        for (const filePath of [this.indexPath, this.workspacesPath, this.wikisPath]) {
            try {
                const stat = await fs.stat(filePath);
                storageSize += stat.size;
            } catch {
                // File may not exist yet
            }
        }
        // Add per-process file sizes
        try {
            const entries = await fs.readdir(this.processesDir);
            for (const entry of entries) {
                if (entry === 'index.json') { continue; }
                try {
                    const stat = await fs.stat(path.join(this.processesDir, entry));
                    storageSize += stat.size;
                } catch {
                    // File may have been removed
                }
            }
        } catch {
            // processesDir may not exist yet
        }

        return {
            totalProcesses: processes.length,
            totalWorkspaces: workspaces.length,
            totalWikis: wikis.length,
            storageSize,
        };
    }

    // --- Streaming support (in-memory, not persisted) ---

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

    // --- Internal helpers: index + per-process files ---

    private sanitizeId(id: string): string {
        return id.replace(/[^a-zA-Z0-9\-_]/g, '_');
    }

    private processFilePath(id: string): string {
        return path.join(this.processesDir, `${this.sanitizeId(id)}.json`);
    }

    private async readIndex(): Promise<ProcessIndexEntry[]> {
        try {
            const data = await fs.readFile(this.indexPath, 'utf-8');
            return JSON.parse(data) as ProcessIndexEntry[];
        } catch {
            return [];
        }
    }

    private async writeIndex(entries: ProcessIndexEntry[]): Promise<void> {
        await ensureDataDir(this.processesDir);
        const tmpPath = this.indexPath + '.tmp';
        await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
        await fs.rename(tmpPath, this.indexPath);
    }

    private async readProcessFile(id: string): Promise<StoredProcessEntry | undefined> {
        try {
            const data = await fs.readFile(this.processFilePath(id), 'utf-8');
            return JSON.parse(data) as StoredProcessEntry;
        } catch {
            return undefined;
        }
    }

    private async writeProcessFile(id: string, entry: StoredProcessEntry): Promise<void> {
        const filePath = this.processFilePath(id);
        const tmpPath = filePath + '.tmp';
        await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
        await fs.rename(tmpPath, filePath);
    }

    private async deleteProcessFile(id: string): Promise<void> {
        try {
            await fs.unlink(this.processFilePath(id));
        } catch {
            // Ignore missing file
        }
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
        };
    }

    private async migrateIfNeeded(): Promise<void> {
        try {
            // Check if legacy file exists AND index does NOT
            await fs.access(this.legacyProcessesPath);
            try {
                await fs.access(this.indexPath);
                return; // Already migrated
            } catch {
                // index doesn't exist — proceed with migration
            }
        } catch {
            return; // No legacy file — nothing to migrate
        }

        // Read legacy file
        let entries: StoredProcessEntry[];
        try {
            const data = await fs.readFile(this.legacyProcessesPath, 'utf-8');
            entries = JSON.parse(data) as StoredProcessEntry[];
        } catch {
            return; // Corrupt or empty legacy file
        }

        // Create processes/ directory
        await ensureDataDir(this.processesDir);

        // Write each entry as a per-process file
        for (const entry of entries) {
            await this.writeProcessFile(entry.process.id, entry);
        }

        // Build and write index
        const index = entries.map(e => this.toIndexEntry(e));
        await this.writeIndex(index);

        // Rename legacy file to .bak
        try {
            await fs.rename(this.legacyProcessesPath, this.legacyProcessesPath + '.bak');
        } catch {
            // Best-effort rename
        }
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
        await fs.writeFile(tmpPath, JSON.stringify(workspaces, null, 2), 'utf-8');
        await fs.rename(tmpPath, this.workspacesPath);
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
        await fs.writeFile(tmpPath, JSON.stringify(wikis, null, 2), 'utf-8');
        await fs.rename(tmpPath, this.wikisPath);
    }

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => {}, () => {});
        return result;
    }

    private async pruneIfNeeded(entries: ProcessIndexEntry[]): Promise<ProcessIndexEntry[]> {
        if (entries.length <= this.maxProcesses) {
            return entries;
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
        if (prunedCount > 0) {
            const prunedEntries = terminal.slice(0, prunedCount);

            // Notify about pruned entries (load full data for onPrune callback)
            if (this.onPrune) {
                const fullEntries: StoredProcessEntry[] = [];
                for (const ie of prunedEntries) {
                    const entry = await this.readProcessFile(ie.id);
                    if (entry) { fullEntries.push(entry); }
                }
                if (fullEntries.length > 0) {
                    this.onPrune(fullEntries);
                }
            }

            // Delete pruned process files
            await Promise.all(prunedEntries.map(e => this.deleteProcessFile(e.id)));
        }

        return [...nonTerminal, ...keptTerminal];
    }
}
