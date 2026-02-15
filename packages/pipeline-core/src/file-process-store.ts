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

import { ProcessStore, ProcessFilter, WorkspaceInfo, ProcessChangeCallback, ProcessOutputEvent } from './process-store';
import {
    AIProcess,
    AIProcessStatus,
    SerializedAIProcess,
    serializeProcess,
    deserializeProcess,
    ProcessEvent
} from './ai/process-types';

/** On-disk shape inside processes.json */
interface StoredProcessEntry {
    workspaceId: string;
    process: SerializedAIProcess;
}

export interface FileProcessStoreOptions {
    /** Directory for data files. Default: ~/.coc/ */
    dataDir?: string;
    /** Maximum number of stored processes before pruning. Default: 500 */
    maxProcesses?: number;
}

/** Returns ~/.coc/ with ~ expanded via os.homedir() */
export function getDefaultDataDir(): string {
    return path.join(os.homedir(), '.coc');
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
    private readonly processesPath: string;
    private readonly workspacesPath: string;
    private writeQueue: Promise<void>;
    private readonly emitters: Map<string, EventEmitter> = new Map();

    onProcessChange?: ProcessChangeCallback;

    constructor(options?: FileProcessStoreOptions) {
        this.dataDir = options?.dataDir ?? getDefaultDataDir();
        this.maxProcesses = options?.maxProcesses ?? 500;
        this.processesPath = path.join(this.dataDir, 'processes.json');
        this.workspacesPath = path.join(this.dataDir, 'workspaces.json');
        this.writeQueue = Promise.resolve();
    }

    async addProcess(process: AIProcess): Promise<void> {
        await this.enqueueWrite(async () => {
            await ensureDataDir(this.dataDir);
            const entries = await this.readProcesses();
            const workspaceId = process.metadata?.workspaceId ?? '';
            entries.push({
                workspaceId,
                process: serializeProcess(process)
            });
            const pruned = this.pruneIfNeeded(entries);
            await this.writeProcesses(pruned);
        });
        this.onProcessChange?.({ type: 'process-added', process });
    }

    async getProcess(id: string): Promise<AIProcess | undefined> {
        const entries = await this.readProcesses();
        const entry = entries.find(e => e.process.id === id);
        return entry ? deserializeProcess(entry.process) : undefined;
    }

    async getAllProcesses(filter?: ProcessFilter): Promise<AIProcess[]> {
        const entries = await this.readProcesses();
        let results = entries;

        if (filter?.workspaceId) {
            results = results.filter(e => e.workspaceId === filter.workspaceId);
        }

        let processes = results.map(e => deserializeProcess(e.process));

        if (filter?.status) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            processes = processes.filter(p => statuses.includes(p.status));
        }

        if (filter?.type) {
            processes = processes.filter(p => p.type === filter.type);
        }

        if (filter?.since) {
            const since = filter.since;
            processes = processes.filter(p => p.startTime >= since);
        }

        if (filter?.limit !== undefined) {
            const offset = filter.offset ?? 0;
            processes = processes.slice(offset, offset + filter.limit);
        }

        return processes;
    }

    async updateProcess(id: string, updates: Partial<AIProcess>): Promise<void> {
        let updated: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            const entries = await this.readProcesses();
            const idx = entries.findIndex(e => e.process.id === id);
            if (idx === -1) { return; }

            const existing = deserializeProcess(entries[idx].process);
            const merged = { ...existing, ...updates };
            entries[idx] = {
                workspaceId: merged.metadata?.workspaceId ?? entries[idx].workspaceId,
                process: serializeProcess(merged)
            };
            updated = merged;
            await this.writeProcesses(entries);
        });
        if (updated) {
            this.onProcessChange?.({ type: 'process-updated', process: updated });
        }
    }

    async removeProcess(id: string): Promise<void> {
        let removed: AIProcess | undefined;
        await this.enqueueWrite(async () => {
            const entries = await this.readProcesses();
            const idx = entries.findIndex(e => e.process.id === id);
            if (idx === -1) { return; }
            removed = deserializeProcess(entries[idx].process);
            entries.splice(idx, 1);
            await this.writeProcesses(entries);
        });
        if (removed) {
            this.onProcessChange?.({ type: 'process-removed', process: removed });
        }
    }

    async clearProcesses(filter?: ProcessFilter): Promise<number> {
        let count = 0;
        await this.enqueueWrite(async () => {
            const entries = await this.readProcesses();
            if (!filter) {
                count = entries.length;
                await this.writeProcesses([]);
                return;
            }

            const remaining: StoredProcessEntry[] = [];
            for (const entry of entries) {
                let match = true;

                if (filter.workspaceId) {
                    match = entry.workspaceId === filter.workspaceId;
                }

                if (match && filter.status) {
                    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
                    const process = deserializeProcess(entry.process);
                    match = statuses.includes(process.status);
                }

                if (match && filter.type) {
                    const process = deserializeProcess(entry.process);
                    match = process.type === filter.type;
                }

                if (match) {
                    count++;
                } else {
                    remaining.push(entry);
                }
            }
            await this.writeProcesses(remaining);
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

    // --- Internal helpers ---

    private async readProcesses(): Promise<StoredProcessEntry[]> {
        try {
            const data = await fs.readFile(this.processesPath, 'utf-8');
            return JSON.parse(data) as StoredProcessEntry[];
        } catch {
            return [];
        }
    }

    private async writeProcesses(entries: StoredProcessEntry[]): Promise<void> {
        const tmpPath = this.processesPath + '.tmp';
        await fs.writeFile(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
        await fs.rename(tmpPath, this.processesPath);
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

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => {}, () => {});
        return result;
    }

    private pruneIfNeeded(entries: StoredProcessEntry[]): StoredProcessEntry[] {
        if (entries.length <= this.maxProcesses) {
            return entries;
        }

        // Separate non-terminal (running/queued) from terminal processes
        const nonTerminal: StoredProcessEntry[] = [];
        const terminal: StoredProcessEntry[] = [];
        for (const entry of entries) {
            const status = entry.process.status;
            if (status === 'running' || status === 'queued') {
                nonTerminal.push(entry);
            } else {
                terminal.push(entry);
            }
        }

        // Sort terminal by startTime ascending (oldest first)
        terminal.sort((a, b) => {
            const timeA = new Date(a.process.startTime).getTime();
            const timeB = new Date(b.process.startTime).getTime();
            return timeA - timeB;
        });

        // Remove oldest terminal entries until within limit
        const toKeep = this.maxProcesses - nonTerminal.length;
        const keptTerminal = toKeep > 0 ? terminal.slice(terminal.length - toKeep) : [];

        return [...nonTerminal, ...keptTerminal];
    }
}
