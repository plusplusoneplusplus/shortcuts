import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { atomicWriteJSON } from '../shared/fs-utils';
import type {
    CancelMapReduceRunResult,
    ClaimedMapReduceItems,
    ClaimedMapReduceReduceStep,
    CreateMapReduceRunInput,
    MapReduceItem,
    MapReduceItemStatus,
    MapReduceReduceStep,
    MapReduceRun,
    MapReduceRunMetadata,
    MapReduceRunSummary,
    UpdateMapReducePlanInput,
} from './types';
import { MAP_REDUCE_ITEM_STATUSES } from './types';
import {
    assertMapReduceDraftStatuses,
    createPendingMapReduceReduceStep,
    normalizeMapReduceItems,
    normalizeMapReduceMaxParallel,
    normalizeMapReduceReduceInstructions,
    normalizeMapReduceReduceStep,
} from './map-reduce-plan-validation';

export interface FileMapReduceRunStoreOptions {
    dataDir: string;
    /**
     * Invoked after every successful run write with the fresh run state.
     * Used to keep the generic task-group registry in sync. Errors thrown
     * by the hook are swallowed — registry sync must never break runs.
     */
    onRunChanged?: (run: MapReduceRun) => void;
}

const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function sanitizeRunId(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid Map Reduce run ID: ${runId}`);
    }
    return runId;
}

function mintRunId(): string {
    return `map-reduce-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyStatusCounts(): Record<MapReduceItemStatus, number> {
    return Object.fromEntries(MAP_REDUCE_ITEM_STATUSES.map(status => [status, 0])) as Record<MapReduceItemStatus, number>;
}

function summarizeRun(run: MapReduceRun): MapReduceRunSummary {
    const counts = emptyStatusCounts();
    for (const item of run.items) {
        counts[item.status] += 1;
    }
    const { items: _items, reduceStep: _reduceStep, ...metadata } = run;
    return {
        ...metadata,
        itemCount: run.items.length,
        itemStatusCounts: counts,
        reduceStatus: run.reduceStep.status,
    };
}

function isTerminalSuccessfulItemStatus(status: MapReduceItemStatus): boolean {
    return status === 'completed' || status === 'skipped';
}

function allItemsTerminalSuccessful(items: MapReduceItem[]): boolean {
    return items.every(item => isTerminalSuccessfulItemStatus(item.status));
}

function dependenciesSatisfied(item: MapReduceItem, items: MapReduceItem[]): boolean {
    const byId = new Map(items.map(entry => [entry.id, entry]));
    return (item.dependsOn ?? []).every(id => {
        const dependency = byId.get(id);
        return dependency ? isTerminalSuccessfulItemStatus(dependency.status) : false;
    });
}

function findRunnableItems(items: MapReduceItem[], limit: number): MapReduceItem[] {
    if (limit <= 0) {
        return [];
    }
    const runnable: MapReduceItem[] = [];
    for (const item of items) {
        if (item.status === 'pending' && dependenciesSatisfied(item, items)) {
            runnable.push(item);
            if (runnable.length >= limit) {
                break;
            }
        }
    }
    return runnable;
}

function findItem(items: MapReduceItem[], itemId: string): MapReduceItem {
    const item = items.find(entry => entry.id === itemId);
    if (!item) {
        throw new Error(`Map Reduce item not found: ${itemId}`);
    }
    return item;
}

function runningItemCount(items: MapReduceItem[]): number {
    return items.filter(item => item.status === 'running').length;
}

function hasRunningItem(items: MapReduceItem[]): boolean {
    return items.some(item => item.status === 'running');
}

function findFailedItem(items: MapReduceItem[]): MapReduceItem | undefined {
    return items.find(item => item.status === 'failed');
}

function clearMapItemExecutionState(item: MapReduceItem, now: string): void {
    item.status = 'running';
    item.startedAt = now;
    item.completedAt = undefined;
    item.error = undefined;
    item.output = undefined;
    item.childTaskId = undefined;
    item.childProcessId = undefined;
}

function clearReduceExecutionState(reduceStep: MapReduceReduceStep, now: string): void {
    reduceStep.status = 'running';
    reduceStep.startedAt = now;
    reduceStep.completedAt = undefined;
    reduceStep.error = undefined;
    reduceStep.childTaskId = undefined;
    reduceStep.childProcessId = undefined;
}

function mapPhaseStatusAfterTerminalChange(items: MapReduceItem[]): MapReduceRun['status'] {
    const failed = findFailedItem(items);
    if (failed) {
        return hasRunningItem(items) ? 'running' : 'failed';
    }
    return allItemsTerminalSuccessful(items) ? 'reducing' : 'running';
}

function mapPhaseStatusAfterManualSkip(items: MapReduceItem[]): MapReduceRun['status'] {
    const failed = findFailedItem(items);
    if (failed) {
        return 'failed';
    }
    return allItemsTerminalSuccessful(items) ? 'reducing' : 'approved';
}

export class FileMapReduceRunStore {
    private readonly dataDir: string;
    private readonly onRunChanged?: (run: MapReduceRun) => void;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(options: FileMapReduceRunStoreOptions) {
        this.dataDir = options.dataDir;
        this.onRunChanged = options.onRunChanged;
    }

    private runsDir(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, 'map-reduce-runs');
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

    private reduceStepPath(workspaceId: string, runId: string): string {
        return path.join(this.runDir(workspaceId, runId), 'reduce-step.json');
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
            if (err?.code === 'ENOENT') {
                return undefined;
            }
            throw err;
        }
    }

    private async writeRun(run: MapReduceRun): Promise<void> {
        const { items, reduceStep, ...metadata } = run;
        await atomicWriteJSON(this.runPath(run.workspaceId, run.runId), metadata);
        await atomicWriteJSON(this.itemsPath(run.workspaceId, run.runId), items);
        await atomicWriteJSON(this.reduceStepPath(run.workspaceId, run.runId), reduceStep);
        try {
            this.onRunChanged?.(run);
        } catch {
            // Registry sync must never break run persistence.
        }
    }

    async createDraftRun(input: CreateMapReduceRunInput): Promise<MapReduceRun> {
        const normalizedItems = normalizeMapReduceItems(input.items);
        const reduceStep = createPendingMapReduceReduceStep();
        assertMapReduceDraftStatuses(normalizedItems, reduceStep);

        return this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const runId = mintRunId();
            const metadata: MapReduceRunMetadata = {
                runId,
                workspaceId: input.workspaceId,
                status: 'draft',
                originalRequest: input.originalRequest,
                reduceInstructions: normalizeMapReduceReduceInstructions(input.reduceInstructions),
                maxParallel: normalizeMapReduceMaxParallel(input.maxParallel),
                childMode: input.childMode,
                createdAt: now,
                updatedAt: now,
            };
            if (input.sharedInstructions) {
                metadata.sharedInstructions = input.sharedInstructions;
            }
            if (input.provider) {
                metadata.provider = input.provider;
            }
            if (input.autoProviderRouting?.requested) {
                metadata.autoProviderRouting = { requested: true };
            }
            if (input.model) {
                metadata.model = input.model;
            }
            if (input.reasoningEffort) {
                metadata.reasoningEffort = input.reasoningEffort;
            }
            if (input.generationProcessId) {
                metadata.generationProcessId = input.generationProcessId;
            }
            if (input.generationId) {
                metadata.generationId = input.generationId;
            }

            const run: MapReduceRun = { ...metadata, items: normalizedItems, reduceStep };
            await this.writeRun(run);
            return run;
        });
    }

    async listRuns(workspaceId: string): Promise<MapReduceRunSummary[]> {
        let entries: string[];
        try {
            entries = await fs.readdir(this.runsDir(workspaceId));
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                return [];
            }
            throw err;
        }

        const runs: MapReduceRun[] = [];
        for (const entry of entries) {
            if (!RUN_ID_PATTERN.test(entry)) {
                continue;
            }
            const run = await this.getRun(workspaceId, entry);
            if (run) {
                runs.push(run);
            }
        }
        return runs
            .map(summarizeRun)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    async getRun(workspaceId: string, runId: string): Promise<MapReduceRun | undefined> {
        const metadata = await this.readJSONIfExists<MapReduceRunMetadata>(this.runPath(workspaceId, runId));
        if (!metadata) {
            return undefined;
        }
        if (metadata.workspaceId !== workspaceId || metadata.runId !== runId) {
            throw new Error(`Map Reduce run metadata mismatch for ${runId}`);
        }
        const rawItems = await this.readJSONIfExists<unknown>(this.itemsPath(workspaceId, runId));
        const rawReduceStep = await this.readJSONIfExists<unknown>(this.reduceStepPath(workspaceId, runId));
        const normalizedMetadata: MapReduceRunMetadata = {
            ...metadata,
            reduceInstructions: normalizeMapReduceReduceInstructions(metadata.reduceInstructions),
            maxParallel: normalizeMapReduceMaxParallel(metadata.maxParallel),
        };
        const items = normalizeMapReduceItems(rawItems);
        const reduceStep = normalizeMapReduceReduceStep(rawReduceStep);
        return { ...normalizedMetadata, items, reduceStep };
    }

    async updateReviewedPlan(workspaceId: string, runId: string, input: UpdateMapReducePlanInput): Promise<MapReduceRun> {
        const normalizedItems = normalizeMapReduceItems(input.items);

        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status !== 'draft') {
                throw new Error(`Map Reduce run '${runId}' is ${current.status}; only draft runs can be edited`);
            }
            assertMapReduceDraftStatuses(normalizedItems, current.reduceStep);

            const { items: _items, reduceStep, ...metadata } = current;
            const nextMetadata: MapReduceRunMetadata = {
                ...metadata,
                ...(input.sharedInstructions !== undefined ? { sharedInstructions: input.sharedInstructions } : {}),
                ...(input.reduceInstructions !== undefined
                    ? { reduceInstructions: normalizeMapReduceReduceInstructions(input.reduceInstructions) }
                    : {}),
                ...(input.maxParallel !== undefined
                    ? { maxParallel: normalizeMapReduceMaxParallel(input.maxParallel) }
                    : {}),
                ...(input.childMode !== undefined ? { childMode: input.childMode } : {}),
                updatedAt: new Date().toISOString(),
            };
            const nextRun: MapReduceRun = { ...nextMetadata, items: normalizedItems, reduceStep };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async approveRun(workspaceId: string, runId: string): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status !== 'draft') {
                throw new Error(`Map Reduce run '${runId}' is ${current.status}; only draft runs can be approved`);
            }
            assertMapReduceDraftStatuses(current.items, current.reduceStep);

            const now = new Date().toISOString();
            const nextRun: MapReduceRun = {
                ...current,
                status: 'approved',
                approvedAt: now,
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async claimRunnableItems(workspaceId: string, runId: string): Promise<ClaimedMapReduceItems | undefined> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'draft') {
                throw new Error(`Map Reduce run '${runId}' must be approved before execution`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'reducing') {
                return undefined;
            }

            const failed = findFailedItem(current.items);
            if (failed) {
                if (hasRunningItem(current.items)) {
                    return undefined;
                }
                const failedRun: MapReduceRun = current.status === 'failed'
                    ? current
                    : { ...current, status: 'failed', updatedAt: new Date().toISOString() };
                if (failedRun !== current) {
                    await this.writeRun(failedRun);
                }
                throw new Error(`Map Reduce run '${runId}' is blocked by failed item '${failed.id}'`);
            }
            if (current.status === 'failed') {
                return undefined;
            }

            if (allItemsTerminalSuccessful(current.items)) {
                if (current.reduceStep.status === 'pending') {
                    const reducingRun: MapReduceRun = {
                        ...current,
                        status: 'reducing',
                        updatedAt: new Date().toISOString(),
                    };
                    await this.writeRun(reducingRun);
                }
                return undefined;
            }

            const availableSlots = Math.max(0, current.maxParallel - runningItemCount(current.items));
            const runnableItems = findRunnableItems(current.items, availableSlots);
            if (runnableItems.length === 0) {
                if (availableSlots === 0 || hasRunningItem(current.items)) {
                    return undefined;
                }
                throw new Error(`Map Reduce run '${runId}' has no runnable pending items`);
            }

            const now = new Date().toISOString();
            for (const item of runnableItems) {
                clearMapItemExecutionState(item, now);
            }
            const nextRun: MapReduceRun = {
                ...current,
                status: 'running',
                updatedAt: now,
                completedAt: undefined,
            };
            await this.writeRun(nextRun);
            return {
                run: nextRun,
                items: runnableItems.map(item => ({ ...item })),
            };
        });
    }

    async claimFailedItemForRetry(workspaceId: string, runId: string, itemId: string): Promise<ClaimedMapReduceItems> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'draft' || current.status === 'reducing') {
                throw new Error(`Map Reduce run '${runId}' is ${current.status}; failed items cannot be retried`);
            }
            if (hasRunningItem(current.items)) {
                throw new Error(`Map Reduce run '${runId}' is still draining running items`);
            }
            const item = findItem(current.items, itemId);
            if (item.status !== 'failed') {
                throw new Error(`Map Reduce item '${itemId}' is ${item.status}; only failed items can be retried`);
            }

            const now = new Date().toISOString();
            clearMapItemExecutionState(item, now);
            const nextRun: MapReduceRun = {
                ...current,
                status: 'running',
                updatedAt: now,
                completedAt: undefined,
            };
            await this.writeRun(nextRun);
            return { run: nextRun, items: [{ ...item }] };
        });
    }

    async linkRunningItemChild(
        workspaceId: string,
        runId: string,
        itemId: string,
        childTaskId: string,
        childProcessId: string,
    ): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            const item = findItem(current.items, itemId);
            if (item.status !== 'running') {
                throw new Error(`Map Reduce item '${itemId}' is ${item.status}; only running items can be linked`);
            }

            item.childTaskId = childTaskId;
            item.childProcessId = childProcessId;
            const nextRun: MapReduceRun = {
                ...current,
                updatedAt: new Date().toISOString(),
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async markRunningItemCompleted(
        workspaceId: string,
        runId: string,
        itemId: string,
        childTaskId?: string,
        output?: unknown,
    ): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled') {
                return current;
            }
            const item = findItem(current.items, itemId);
            if (item.status !== 'running') {
                return current;
            }
            if (childTaskId && item.childTaskId && item.childTaskId !== childTaskId) {
                return current;
            }

            const now = new Date().toISOString();
            item.status = 'completed';
            item.completedAt = now;
            item.error = undefined;
            item.output = output;
            const nextRun: MapReduceRun = {
                ...current,
                status: mapPhaseStatusAfterTerminalChange(current.items),
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async markRunningItemFailed(workspaceId: string, runId: string, itemId: string, error: string, childTaskId?: string): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled') {
                return current;
            }
            const item = findItem(current.items, itemId);
            if (item.status !== 'running') {
                return current;
            }
            if (childTaskId && item.childTaskId && item.childTaskId !== childTaskId) {
                return current;
            }

            const now = new Date().toISOString();
            item.status = 'failed';
            item.completedAt = now;
            item.error = error;
            const nextRun: MapReduceRun = {
                ...current,
                status: mapPhaseStatusAfterTerminalChange(current.items),
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async skipItem(workspaceId: string, runId: string, itemId: string): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'draft' || current.status === 'reducing') {
                throw new Error(`Map Reduce run '${runId}' is ${current.status}; items cannot be skipped`);
            }
            if (hasRunningItem(current.items)) {
                throw new Error(`Map Reduce run '${runId}' is still draining running items`);
            }
            const item = findItem(current.items, itemId);
            if (item.status !== 'pending' && item.status !== 'failed') {
                throw new Error(`Map Reduce item '${itemId}' is ${item.status}; only pending or failed items can be skipped`);
            }

            const now = new Date().toISOString();
            item.status = 'skipped';
            item.completedAt = now;
            item.error = undefined;
            const nextRun: MapReduceRun = {
                ...current,
                status: mapPhaseStatusAfterManualSkip(current.items),
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async claimReduceStep(workspaceId: string, runId: string): Promise<ClaimedMapReduceReduceStep | undefined> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'draft') {
                throw new Error(`Map Reduce run '${runId}' must be approved before reduction`);
            }
            if (current.status === 'cancelled' || current.status === 'completed') {
                return undefined;
            }
            const failed = findFailedItem(current.items);
            if (failed) {
                throw new Error(`Map Reduce run '${runId}' is blocked by failed item '${failed.id}'`);
            }
            if (!allItemsTerminalSuccessful(current.items)) {
                return undefined;
            }
            if (current.reduceStep.status !== 'pending') {
                return undefined;
            }

            const now = new Date().toISOString();
            clearReduceExecutionState(current.reduceStep, now);
            const nextRun: MapReduceRun = {
                ...current,
                status: 'reducing',
                updatedAt: now,
                completedAt: undefined,
            };
            await this.writeRun(nextRun);
            return { run: nextRun, reduceStep: { ...current.reduceStep } };
        });
    }

    async claimFailedReduceStepForRetry(workspaceId: string, runId: string): Promise<ClaimedMapReduceReduceStep> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'draft') {
                throw new Error(`Map Reduce run '${runId}' is ${current.status}; reduce step cannot be retried`);
            }
            const failed = findFailedItem(current.items);
            if (failed) {
                throw new Error(`Map Reduce run '${runId}' is blocked by failed item '${failed.id}'`);
            }
            if (!allItemsTerminalSuccessful(current.items)) {
                throw new Error(`Map Reduce run '${runId}' cannot reduce before all map items are terminal-successful`);
            }
            if (current.reduceStep.status !== 'failed') {
                throw new Error(`Map Reduce reduce step is ${current.reduceStep.status}; only failed reduce steps can be retried`);
            }

            const now = new Date().toISOString();
            clearReduceExecutionState(current.reduceStep, now);
            const nextRun: MapReduceRun = {
                ...current,
                status: 'reducing',
                updatedAt: now,
                completedAt: undefined,
            };
            await this.writeRun(nextRun);
            return { run: nextRun, reduceStep: { ...current.reduceStep } };
        });
    }

    async linkRunningReduceChild(
        workspaceId: string,
        runId: string,
        childTaskId: string,
        childProcessId: string,
    ): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.reduceStep.status !== 'running') {
                throw new Error(`Map Reduce reduce step is ${current.reduceStep.status}; only running reduce steps can be linked`);
            }

            current.reduceStep.childTaskId = childTaskId;
            current.reduceStep.childProcessId = childProcessId;
            const nextRun: MapReduceRun = {
                ...current,
                status: 'reducing',
                updatedAt: new Date().toISOString(),
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async markRunningReduceCompleted(workspaceId: string, runId: string, childTaskId?: string): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled') {
                return current;
            }
            if (current.reduceStep.status !== 'running') {
                return current;
            }
            if (childTaskId && current.reduceStep.childTaskId && current.reduceStep.childTaskId !== childTaskId) {
                return current;
            }

            const now = new Date().toISOString();
            current.reduceStep.status = 'completed';
            current.reduceStep.completedAt = now;
            current.reduceStep.error = undefined;
            const nextRun: MapReduceRun = {
                ...current,
                status: 'completed',
                completedAt: now,
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async markRunningReduceFailed(workspaceId: string, runId: string, error: string, childTaskId?: string): Promise<MapReduceRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            if (current.status === 'cancelled') {
                return current;
            }
            if (current.reduceStep.status !== 'running') {
                return current;
            }
            if (childTaskId && current.reduceStep.childTaskId && current.reduceStep.childTaskId !== childTaskId) {
                return current;
            }

            const now = new Date().toISOString();
            current.reduceStep.status = 'failed';
            current.reduceStep.completedAt = now;
            current.reduceStep.error = error;
            const nextRun: MapReduceRun = {
                ...current,
                status: 'failed',
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async cancelRun(workspaceId: string, runId: string): Promise<CancelMapReduceRunResult> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`Map Reduce run not found: ${runId}`);
            }
            const childTaskIds = [
                ...current.items
                    .filter(item => item.status === 'running' && item.childTaskId)
                    .map(item => item.childTaskId!)
                    .filter(Boolean),
                current.reduceStep.status === 'running' && current.reduceStep.childTaskId
                    ? current.reduceStep.childTaskId
                    : undefined,
            ].filter(Boolean) as string[];
            if (current.status === 'cancelled' || current.status === 'completed') {
                return { run: current, childTaskIds };
            }

            const now = new Date().toISOString();
            for (const item of current.items) {
                if (item.status === 'pending' || item.status === 'running') {
                    item.status = 'skipped';
                    item.completedAt = now;
                    item.error = item.error ?? 'Run cancelled';
                }
            }
            if (current.reduceStep.status === 'pending' || current.reduceStep.status === 'running' || current.reduceStep.status === 'failed') {
                current.reduceStep.status = 'cancelled';
                current.reduceStep.completedAt = now;
                current.reduceStep.error = current.reduceStep.error ?? 'Run cancelled';
            }
            const nextRun: MapReduceRun = {
                ...current,
                status: 'cancelled',
                cancelledAt: now,
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return { run: nextRun, childTaskIds };
        });
    }
}
