import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { atomicWriteJSON } from '../shared/fs-utils';
import type {
    CreateForEachRunInput,
    ForEachItem,
    ForEachItemStatus,
    ForEachRun,
    ForEachRunMetadata,
    ForEachRunSummary,
    UpdateForEachPlanInput,
} from './types';
import { FOR_EACH_ITEM_STATUSES } from './types';
import { assertDraftInitialStatuses, normalizeForEachItems } from './for-each-plan-validation';

export interface FileForEachRunStoreOptions {
    dataDir: string;
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function sanitizeRunId(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid For Each run ID: ${runId}`);
    }
    return runId;
}

function mintRunId(): string {
    return `for-each-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyStatusCounts(): Record<ForEachItemStatus, number> {
    return Object.fromEntries(FOR_EACH_ITEM_STATUSES.map(status => [status, 0])) as Record<ForEachItemStatus, number>;
}

function summarizeRun(run: ForEachRun): ForEachRunSummary {
    const counts = emptyStatusCounts();
    for (const item of run.items) {
        counts[item.status] += 1;
    }
    const { items: _items, ...metadata } = run;
    return {
        ...metadata,
        itemCount: run.items.length,
        itemStatusCounts: counts,
    };
}

export class FileForEachRunStore {
    private readonly dataDir: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(options: FileForEachRunStoreOptions) {
        this.dataDir = options.dataDir;
    }

    private runsDir(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, 'for-each-runs');
    }

    private runDir(workspaceId: string, runId: string): string {
        return path.join(this.runsDir(workspaceId), sanitizeRunId(runId));
    }

    private runPath(workspaceId: string, runId: string): string {
        return path.join(this.runDir(workspaceId, runId), 'run.json');
    }

    private itemsPath(workspaceId: string, runId: string): string {
        return path.join(this.runDir(workspaceId, runId), 'items.json');
    }

    private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async readJSONIfExists<T>(filePath: string): Promise<T | undefined> {
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(raw) as T;
        } catch (err: any) {
            if (err?.code === 'ENOENT') return undefined;
            throw err;
        }
    }

    async createDraftRun(input: CreateForEachRunInput): Promise<ForEachRun> {
        const normalizedItems = normalizeForEachItems(input.items);
        assertDraftInitialStatuses(normalizedItems);

        return this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const runId = mintRunId();
            const metadata: ForEachRunMetadata = {
                runId,
                workspaceId: input.workspaceId,
                status: 'draft',
                originalRequest: input.originalRequest,
                childMode: input.childMode,
                createdAt: now,
                updatedAt: now,
            };
            if (input.sharedInstructions) metadata.sharedInstructions = input.sharedInstructions;
            if (input.provider) metadata.provider = input.provider;
            if (input.model) metadata.model = input.model;
            if (input.reasoningEffort) metadata.reasoningEffort = input.reasoningEffort;

            await atomicWriteJSON(this.runPath(input.workspaceId, runId), metadata);
            await atomicWriteJSON(this.itemsPath(input.workspaceId, runId), normalizedItems);
            return { ...metadata, items: normalizedItems };
        });
    }

    async listRuns(workspaceId: string): Promise<ForEachRunSummary[]> {
        let entries: string[];
        try {
            entries = await fs.readdir(this.runsDir(workspaceId));
        } catch (err: any) {
            if (err?.code === 'ENOENT') return [];
            throw err;
        }

        const runs: ForEachRun[] = [];
        for (const entry of entries) {
            if (!RUN_ID_PATTERN.test(entry)) continue;
            const run = await this.getRun(workspaceId, entry);
            if (run) runs.push(run);
        }
        return runs
            .map(summarizeRun)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async getRun(workspaceId: string, runId: string): Promise<ForEachRun | undefined> {
        const metadata = await this.readJSONIfExists<ForEachRunMetadata>(this.runPath(workspaceId, runId));
        if (!metadata) return undefined;
        if (metadata.workspaceId !== workspaceId || metadata.runId !== runId) {
            throw new Error(`For Each run metadata mismatch for ${runId}`);
        }
        const rawItems = await this.readJSONIfExists<unknown>(this.itemsPath(workspaceId, runId));
        const items = normalizeForEachItems(rawItems);
        return { ...metadata, items };
    }

    async updateReviewedPlan(workspaceId: string, runId: string, input: UpdateForEachPlanInput): Promise<ForEachRun> {
        const normalizedItems = normalizeForEachItems(input.items);
        assertDraftInitialStatuses(normalizedItems);

        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            if (current.status !== 'draft') {
                throw new Error(`For Each run '${runId}' is ${current.status}; only draft runs can be edited`);
            }

            const { items: _items, ...metadata } = current;
            const nextMetadata: ForEachRunMetadata = {
                ...metadata,
                ...(input.sharedInstructions !== undefined ? { sharedInstructions: input.sharedInstructions } : {}),
                ...(input.childMode !== undefined ? { childMode: input.childMode } : {}),
                updatedAt: new Date().toISOString(),
            };
            await atomicWriteJSON(this.runPath(workspaceId, runId), nextMetadata);
            await atomicWriteJSON(this.itemsPath(workspaceId, runId), normalizedItems);
            return { ...nextMetadata, items: normalizedItems };
        });
    }

    async approveRun(workspaceId: string, runId: string): Promise<ForEachRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            if (current.status !== 'draft') {
                throw new Error(`For Each run '${runId}' is ${current.status}; only draft runs can be approved`);
            }
            assertDraftInitialStatuses(current.items);

            const now = new Date().toISOString();
            const { items, ...metadata } = current;
            const nextMetadata: ForEachRunMetadata = {
                ...metadata,
                status: 'approved',
                approvedAt: now,
                updatedAt: now,
            };
            await atomicWriteJSON(this.runPath(workspaceId, runId), nextMetadata);
            return { ...nextMetadata, items };
        });
    }
}

