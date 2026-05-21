/**
 * File-based ProcessStore Implementation
 *
 * Persistent AI process storage using JSON files in a configurable data directory.
 * Per-workspace subdirectory layout: repos/<workspaceId>/processes/index.json + repos/<workspaceId>/processes/<id>.json
 * Cross-workspace ID lookups via index scan across per-workspace index.json files.
 * Empty workspaceId maps to repos/_default/processes/.
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
    ConversationTurn,
    TimelineItem,
    SerializedAIProcess,
    serializeProcess,
    deserializeProcess,
    ProcessEvent
} from './ai/process-types';
import { withRetry } from './runtime/retry';
import { getLogger } from './logger';
import { computeMessagePreview } from './utils/message-preview';

/** On-disk shape for individual process files (repos/<workspaceId>/processes/<id>.json) */
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
        this.processesDir = path.join(this.dataDir, 'repos');
        this.workspacesPath = path.join(this.dataDir, 'workspaces.json');
        this.wikisPath = path.join(this.dataDir, 'wikis.json');
        this.writeQueue = Promise.resolve();
        this.onPrune = options?.onPrune;
    }

    // --- Per-workspace directory helpers ---

    private workspaceDirFor(workspaceId: string): string {
        return path.join(this.processesDir, workspaceId || '_default', 'processes');
    }

    private indexPathFor(workspaceId: string): string {
        return path.join(this.workspaceDirFor(workspaceId), 'index.json');
    }

    private resolveFilePath(workspaceId: string, processId: string): string {
        return path.join(this.workspaceDirFor(workspaceId), this.sanitizeId(processId) + '.json');
    }

    // --- Pruned bucket helpers (processes/pruned/YYYY-MM/) ---

    private prunedRootFor(workspaceId: string): string {
        return path.join(this.workspaceDirFor(workspaceId), 'pruned');
    }

    private prunedBucketFor(workspaceId: string, startTime: string): string {
        const bucket = new Date(startTime).toISOString().slice(0, 7);
        return path.join(this.prunedRootFor(workspaceId), bucket);
    }

    private prunedBucketIndexPathFor(workspaceId: string, startTime: string): string {
        return path.join(this.prunedBucketFor(workspaceId, startTime), 'index.json');
    }

    public getPrunedProcessFilePath(workspaceId: string, processId: string, startTime: string): string {
        return path.join(this.prunedBucketFor(workspaceId, startTime), this.sanitizeId(processId) + '.json');
    }

    private async readPrunedBucketIndex(workspaceId: string, startTime: string): Promise<ProcessIndexEntry[]> {
        try {
            const data = await fs.readFile(this.prunedBucketIndexPathFor(workspaceId, startTime), 'utf-8');
            return JSON.parse(data) as ProcessIndexEntry[];
        } catch {
            return [];
        }
    }

    private async writePrunedBucketIndex(workspaceId: string, startTime: string, entries: ProcessIndexEntry[]): Promise<void> {
        const bucketDir = this.prunedBucketFor(workspaceId, startTime);
        await ensureDataDir(bucketDir);
        const indexPath = this.prunedBucketIndexPathFor(workspaceId, startTime);
        const tmpPath = indexPath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
            await fs.rename(tmpPath, indexPath);
        });
    }

    // --- Process CRUD ---

    async addProcess(process: AIProcess): Promise<void> {
        const withLastEvent = { ...process, lastEventAt: process.lastEventAt ?? process.startTime };
        await this.enqueueWrite(async () => {
            const workspaceId = withLastEvent.metadata?.workspaceId ?? '';
            await ensureDataDir(this.workspaceDirFor(workspaceId));
            const entry: StoredProcessEntry = {
                workspaceId,
                process: serializeProcess(withLastEvent)
            };
            // Write per-process file first (orphan on crash is harmless)
            await this.writeProcessFile(workspaceId, process.id, entry);
            // Upsert into workspace index, prune, then write back
            const index = await this.readIndex(workspaceId);
            const existingIdx = index.findIndex(e => e.id === process.id);
            if (existingIdx >= 0) {
                index[existingIdx] = this.toIndexEntry(entry);
            } else {
                index.push(this.toIndexEntry(entry));
            }
            const pruned = await this.pruneWorkspaceIfNeeded(workspaceId, index);
            await this.writeIndex(workspaceId, pruned);
        });
        this.onProcessChange?.({ type: 'process-added', process });
    }

    async getProcess(id: string, workspaceId?: string): Promise<AIProcess | undefined> {
        if (workspaceId !== undefined) {
            // Direct path — workspaceId hint provided
            const entry = await this.readProcessFile(workspaceId, id);
            if (!entry) return undefined;
            const result = deserializeProcess(entry.process);
            result.dataFilePath = this.resolveFilePath(workspaceId, id);
            return result;
        }
        // Scan workspace index files to find owning workspace
        const wsId = await this.findWorkspaceIdForProcess(id);
        if (wsId === undefined) return undefined;
        const entry = await this.readProcessFile(wsId, id);
        if (!entry) return undefined;
        const result = deserializeProcess(entry.process);
        result.dataFilePath = this.resolveFilePath(wsId, id);
        return result;
    }

    async getProcessCount(filter?: ProcessFilter): Promise<number> {
        if (filter?.workspaceId) {
            let indexEntries = await this.readIndex(filter.workspaceId);
            indexEntries = this.applyIndexFilters(indexEntries, filter);
            return indexEntries.length;
        }
        let allIndexEntries = await this.aggregateAllIndices();
        allIndexEntries = this.applyIndexFilters(allIndexEntries, filter);
        return allIndexEntries.length;
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
            return this.applyExclude(processes, filter?.exclude);
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
        return this.applyExclude(processes, filter?.exclude);
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

    async getProcessIds(filter?: ProcessFilter): Promise<string[]> {
        const filterWithoutPagination = filter ? { ...filter, limit: undefined, offset: undefined } : undefined;
        const { entries } = await this.getProcessSummaries(filterWithoutPagination);
        return entries.map(e => e.id);
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
            entries = entries.filter(e => new Date(e.lastEventAt ?? e.startTime).getTime() >= sinceTime);
        }
        if (filter?.until) {
            const untilTime = filter.until.getTime();
            entries = entries.filter(e => new Date(e.lastEventAt ?? e.startTime).getTime() < untilTime);
        }
        return entries;
    }

    /** Strip fields specified by `exclude` from loaded process objects. */
    private applyExclude(processes: AIProcess[], exclude?: string[]): AIProcess[] {
        if (!exclude || exclude.length === 0) { return processes; }
        const stripConversation = exclude.includes('conversation');
        const stripToolCalls = exclude.includes('toolCalls');
        if (!stripConversation && !stripToolCalls) { return processes; }
        return processes.map(p => {
            if (stripConversation) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { conversationTurns, fullPrompt, result, ...rest } = p;
                return rest as AIProcess;
            }
            if (stripToolCalls && p.conversationTurns) {
                return {
                    ...p,
                    conversationTurns: p.conversationTurns.map(turn => {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { toolCalls, ...rest } = turn;
                        return rest;
                    }),
                };
            }
            return p;
        });
    }

    /** Returns true when filter contains any field that narrows which processes match (beyond workspaceId). */
    private hasContentFilters(filter?: ProcessFilter): boolean {
        return !!(filter?.parentProcessId || filter?.status || filter?.type || filter?.since);
    }

    async updateProcess(id: string, updates: Partial<AIProcess>): Promise<void> {
        if ('conversationTurns' in updates) {
            throw new Error('Use appendConversationTurn/upsertStreamingTurn/updateTurnContent to modify conversationTurns');
        }
        let updated: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            const workspaceId = await this.findWorkspaceIdForProcess(id);
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

    /**
     * Atomically append a conversation turn inside the write queue.
     *
     * Reads the current process, optionally filters out streaming assistant turns,
     * calls makeTurn with the computed index, appends the turn, and writes back —
     * all inside a single enqueueWrite slot. This prevents lost-update races between
     * the api-handler (user turns) and the follow-up executor (assistant turns).
     */
    async appendConversationTurn(
        processId: string,
        makeTurn: (turnIndex: number) => ConversationTurn,
        options?: {
            filterStreaming?: boolean;
            additionalUpdates?:
                | Partial<Omit<AIProcess, 'conversationTurns'>>
                | ((current: AIProcess) => Partial<Omit<AIProcess, 'conversationTurns'>>);
        }
    ): Promise<{ turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined> {
        let appendResult: { turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined;
        let updatedProcess: AIProcess | undefined;

        await this.enqueueWrite(async () => {
            const workspaceId = await this.findWorkspaceIdForProcess(processId);
            if (workspaceId === undefined) { return; }

            const entry = await this.readProcessFile(workspaceId, processId);
            if (!entry) { return; }

            const existing = deserializeProcess(entry.process);

            let turns = existing.conversationTurns ?? [];
            let stableTurnIndex: number | undefined;
            if (options?.filterStreaming) {
                // Recover the original turnIndex from the streaming turn being replaced,
                // so the final assistant turn keeps the correct position in the conversation.
                for (let i = turns.length - 1; i >= 0; i--) {
                    if (turns[i].role === 'assistant' && turns[i].streaming && turns[i].turnIndex != null) {
                        stableTurnIndex = turns[i].turnIndex;
                        break;
                    }
                }
                turns = turns.filter(t => !(t.role === 'assistant' && t.streaming));

                // Guard: discard stale stableTurnIndex if a new user turn was appended
                // after the streaming turn (cancel + new follow-up race condition).
                if (stableTurnIndex !== undefined) {
                    const maxExistingIndex = Math.max(...turns.map(t => t.turnIndex ?? -1));
                    if (stableTurnIndex <= maxExistingIndex) {
                        stableTurnIndex = undefined;
                    }
                }
            }

            const fallbackIndex = options?.filterStreaming
                ? Math.max(turns.length, Math.max(...turns.map(t => t.turnIndex ?? -1)) + 1)
                : turns.length;
            const turn = makeTurn(stableTurnIndex ?? fallbackIndex);
            const allTurns = [...turns, turn];

            const extraUpdates = typeof options?.additionalUpdates === 'function'
                ? options.additionalUpdates(existing)
                : (options?.additionalUpdates ?? {});

            const merged: AIProcess = { ...existing, ...extraUpdates, conversationTurns: allTurns, lastEventAt: new Date() };
            if (typeof turn.content === 'string' && turn.content.trim().length > 0) {
                merged.lastMessagePreview = computeMessagePreview(turn.content);
            }
            const newEntry: StoredProcessEntry = {
                workspaceId: merged.metadata?.workspaceId ?? entry.workspaceId,
                process: serializeProcess(merged),
            };
            await this.writeProcessFile(workspaceId, processId, newEntry);

            const index = await this.readIndex(workspaceId);
            const idx = index.findIndex(e => e.id === processId);
            if (idx !== -1) {
                index[idx] = this.toIndexEntry(newEntry);
                await this.writeIndex(workspaceId, index);
            }

            appendResult = { turn, allTurns };
            updatedProcess = merged;
        });

        if (updatedProcess) {
            this.onProcessChange?.({ type: 'process-updated', process: updatedProcess });
        }

        return appendResult;
    }

    /**
     * Atomically upsert a streaming assistant turn inside the write queue.
     * If a streaming assistant turn already exists, updates it in-place.
     * Otherwise, appends a new assistant turn.
     */
    async upsertStreamingTurn(
        processId: string,
        content: string,
        streaming: boolean,
        timeline?: TimelineItem[],
    ): Promise<void> {
        let updatedProcess: AIProcess | undefined;

        await this.enqueueWrite(async () => {
            const workspaceId = await this.findWorkspaceIdForProcess(processId);
            if (workspaceId === undefined) { return; }

            const entry = await this.readProcessFile(workspaceId, processId);
            if (!entry) { return; }

            const existing = deserializeProcess(entry.process);
            const turns = existing.conversationTurns ?? [];

            // Search backwards for existing streaming assistant turn
            let streamingIdx = -1;
            for (let i = turns.length - 1; i >= 0; i--) {
                if (turns[i].role === 'assistant' && turns[i].streaming) {
                    streamingIdx = i;
                    break;
                }
            }

            let updatedTurns: ConversationTurn[];
            if (streamingIdx !== -1) {
                updatedTurns = turns.map((turn, i) =>
                    i === streamingIdx
                        ? { ...turn, content, streaming: streaming || undefined, ...(timeline ? { timeline } : {}) }
                        : turn
                );
            } else {
                updatedTurns = [
                    ...turns,
                    {
                        role: 'assistant' as const,
                        content,
                        timestamp: new Date(),
                        turnIndex: turns.length,
                        streaming: streaming || undefined,
                        timeline: timeline ?? [],
                    },
                ];
            }

            const merged: AIProcess = { ...existing, conversationTurns: updatedTurns };
            const newEntry: StoredProcessEntry = {
                workspaceId: merged.metadata?.workspaceId ?? entry.workspaceId,
                process: serializeProcess(merged),
            };
            await this.writeProcessFile(workspaceId, processId, newEntry);

            const index = await this.readIndex(workspaceId);
            const idx = index.findIndex(e => e.id === processId);
            if (idx !== -1) {
                index[idx] = this.toIndexEntry(newEntry);
                await this.writeIndex(workspaceId, index);
            }

            updatedProcess = merged;
        });

        if (updatedProcess) {
            this.onProcessChange?.({ type: 'process-updated', process: updatedProcess });
        }
    }

    /**
     * Atomically update the content of a conversation turn at a specific index.
     */
    async updateTurnContent(
        processId: string,
        turnIndex: number,
        content: string,
    ): Promise<void> {
        let updatedProcess: AIProcess | undefined;

        await this.enqueueWrite(async () => {
            const workspaceId = await this.findWorkspaceIdForProcess(processId);
            if (workspaceId === undefined) { return; }

            const entry = await this.readProcessFile(workspaceId, processId);
            if (!entry) { return; }

            const existing = deserializeProcess(entry.process);
            const turns = existing.conversationTurns ?? [];
            if (turnIndex < 0 || turnIndex >= turns.length) { return; }

            const updatedTurns = turns.map((turn, i) =>
                i === turnIndex ? { ...turn, content } : turn
            );

            const merged: AIProcess = { ...existing, conversationTurns: updatedTurns };
            const newEntry: StoredProcessEntry = {
                workspaceId: merged.metadata?.workspaceId ?? entry.workspaceId,
                process: serializeProcess(merged),
            };
            await this.writeProcessFile(workspaceId, processId, newEntry);

            const index = await this.readIndex(workspaceId);
            const idx = index.findIndex(e => e.id === processId);
            if (idx !== -1) {
                index[idx] = this.toIndexEntry(newEntry);
                await this.writeIndex(workspaceId, index);
            }

            updatedProcess = merged;
        });

        if (updatedProcess) {
            this.onProcessChange?.({ type: 'process-updated', process: updatedProcess });
        }
    }

    async removeProcess(id: string): Promise<void> {
        let removed: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            const workspaceId = await this.findWorkspaceIdForProcess(id);
            if (workspaceId === undefined) { return; }

            const entry = await this.readProcessFile(workspaceId, id);
            if (!entry) { return; }
            removed = deserializeProcess(entry.process);
            await this.deleteProcessFile(workspaceId, id);
            const index = await this.readIndex(workspaceId);
            const filtered = index.filter(e => e.id !== id);
            await this.writeIndex(workspaceId, filtered);
        });
        if (removed) {
            this.onProcessChange?.({ type: 'process-removed', process: removed });
        }
    }

    async clearProcesses(filter?: ProcessFilter): Promise<number> {
        let count = 0;
        await this.enqueueWrite(async () => {
            const hasExtra = this.hasContentFilters(filter);
            const workspaceDirs = filter?.workspaceId
                ? [filter.workspaceId]
                : await this.listWorkspaceDirs();

            await Promise.all(workspaceDirs.map(async (wsId) => {
                if (!hasExtra) {
                    // Fast path: wipe entire workspace dir
                    const index = await this.readIndex(wsId);
                    const allIds = index.map(e => e.id);
                    await Promise.all([
                        ...allIds.map(id => this.deleteProcessFile(wsId, id)),
                        fs.unlink(this.indexPathFor(wsId)).catch(() => {}),
                    ]);
                    try { await fs.rmdir(this.workspaceDirFor(wsId)); } catch { /* best effort */ }
                    count += allIds.length;
                } else {
                    // Filter-based path
                    const index = await this.readIndex(wsId);
                    const remaining: ProcessIndexEntry[] = [];
                    const toDelete: string[] = [];

                    for (const ie of index) {
                        let match = true;
                        if (match && filter?.parentProcessId) {
                            match = ie.parentProcessId === filter.parentProcessId;
                        }
                        if (match && filter?.status) {
                            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                            match = statuses.includes(ie.status as AIProcessStatus);
                        }
                        if (match && filter?.type) { match = ie.type === filter.type; }
                        if (match && filter?.since) {
                            match = new Date(ie.startTime).getTime() >= filter.since.getTime();
                        }

                        if (match) { toDelete.push(ie.id); }
                        else { remaining.push(ie); }
                    }

                    await Promise.all(toDelete.map(id => this.deleteProcessFile(wsId, id)));

                    // Remove workspace dir when it becomes empty (only in cross-workspace scan)
                    if (remaining.length === 0 && !filter?.workspaceId) {
                        await fs.unlink(this.indexPathFor(wsId)).catch(() => {});
                        try { await fs.rmdir(this.workspaceDirFor(wsId)); } catch { /* best effort */ }
                    } else {
                        await this.writeIndex(wsId, remaining);
                    }

                    count += toDelete.length;
                }
            }));
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
                if ('extraSkillFolders' in updates) { workspaces[idx].extraSkillFolders = updates.extraSkillFolders; }
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
        const [summaries, wikis, workspaceDirIds] = await Promise.all([
            this.getProcessSummaries(),
            this.getWikis(),
            this.listWorkspaceDirs(),
        ]);

        // Stat meta files in parallel
        const metaSizes = await Promise.all(
            [this.workspacesPath, this.wikisPath].map(async (filePath) => {
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
            totalWorkspaces: workspaceDirIds.length,
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

    private async readProcessFile(workspaceId: string, id: string): Promise<StoredProcessEntry | undefined> {
        try {
            const data = await fs.readFile(this.resolveFilePath(workspaceId, id), 'utf-8');
            return JSON.parse(data) as StoredProcessEntry;
        } catch {
            return undefined;
        }
    }

    private async writeProcessFile(workspaceId: string, id: string, entry: StoredProcessEntry): Promise<void> {
        const filePath = this.resolveFilePath(workspaceId, id);
        const tmpPath = filePath + '.tmp';
        await this.retryAtomicWrite(tmpPath, async () => {
            await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), 'utf-8');
            await fs.rename(tmpPath, filePath);
        });
    }

    private async moveProcessToPruned(workspaceId: string, entry: ProcessIndexEntry): Promise<void> {
        const src = this.resolveFilePath(workspaceId, entry.id);
        const destDir = this.prunedBucketFor(workspaceId, entry.startTime);
        await ensureDataDir(destDir);
        const dest = this.getPrunedProcessFilePath(workspaceId, entry.id, entry.startTime);
        try {
            await fs.rename(src, dest);
        } catch {
            // Cross-device fallback: copy then delete
            const data = await fs.readFile(src, 'utf-8').catch(() => null);
            if (data) {
                await fs.writeFile(dest, data, 'utf-8');
                await fs.unlink(src).catch(() => {});
            }
        }
    }

    private async deleteProcessFile(workspaceId: string, id: string): Promise<void> {
        try {
            await fs.unlink(this.resolveFilePath(workspaceId, id));
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

    /**
     * Scan per-workspace index.json files to find the workspaceId that owns the given process id.
     * Returns undefined if not found in any workspace.
     */
    private async findWorkspaceIdForProcess(id: string): Promise<string | undefined> {
        const workspaceDirs = await this.listWorkspaceDirs();
        for (const wsId of workspaceDirs) {
            const entries = await this.readIndex(wsId);
            if (entries.some(e => e.id === id)) {
                return wsId;
            }
        }
        return undefined;
    }

    private toIndexEntry(entry: StoredProcessEntry): ProcessIndexEntry {
        const askUserCount = Array.isArray(entry.process.pendingAskUser) ? entry.process.pendingAskUser.length : 0;
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
            customTitle: entry.process.customTitle,
            lastMessagePreview: entry.process.lastMessagePreview,
            duration: entry.process.endTime && entry.process.startTime
                ? new Date(entry.process.endTime).getTime() - new Date(entry.process.startTime).getTime()
                : undefined,
            lastEventAt: entry.process.lastEventAt,
            activityAt: entry.process.lastEventAt ?? entry.process.startTime,
            pendingAskUserCount: askUserCount > 0 ? askUserCount : undefined,
        };
    }

    private async pruneWorkspaceIfNeeded(
        workspaceId: string,
        entries: ProcessIndexEntry[]
    ): Promise<ProcessIndexEntry[]> {
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
        terminal.sort((a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
        );

        // Remove oldest terminal entries until within limit
        const toKeep = this.maxProcesses - nonTerminal.length;
        const keptTerminal = toKeep > 0 ? terminal.slice(terminal.length - toKeep) : [];
        const prunedEntries = terminal.slice(0, terminal.length - keptTerminal.length);

        if (prunedEntries.length > 0) {
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

            // Group pruned entries by YYYY-MM bucket and write each bucket index
            const byBucket = new Map<string, ProcessIndexEntry[]>();
            for (const e of prunedEntries) {
                const bucket = new Date(e.startTime).toISOString().slice(0, 7);
                if (!byBucket.has(bucket)) { byBucket.set(bucket, []); }
                byBucket.get(bucket)!.push(e);
            }
            for (const [, bucketEntries] of byBucket) {
                const existing = await this.readPrunedBucketIndex(workspaceId, bucketEntries[0].startTime);
                await this.writePrunedBucketIndex(workspaceId, bucketEntries[0].startTime, [...existing, ...bucketEntries]);
            }

            // Move pruned process files into their bucket directories
            await Promise.all(prunedEntries.map(e => this.moveProcessToPruned(workspaceId, e)));
        }

        return [...nonTerminal, ...keptTerminal];
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
