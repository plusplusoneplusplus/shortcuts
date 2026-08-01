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
import type { FileRunStoreBaseOptions, ItemRunPolicy, RunArtifact } from '../shared/file-run-store-base';
import { allItemsTerminal, FileRunStoreBase, findFailedItem, hasRunningItem } from '../shared/file-run-store-base';

export type FileMapReduceRunStoreOptions = FileRunStoreBaseOptions<MapReduceRun>;

function emptyStatusCounts(): Record<MapReduceItemStatus, number> {
    return Object.fromEntries(MAP_REDUCE_ITEM_STATUSES.map(status => [status, 0])) as Record<MapReduceItemStatus, number>;
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
    return allItemsTerminal(items) ? 'reducing' : 'running';
}

function mapPhaseStatusAfterManualSkip(items: MapReduceItem[]): MapReduceRun['status'] {
    const failed = findFailedItem(items);
    if (failed) {
        return 'failed';
    }
    return allItemsTerminal(items) ? 'reducing' : 'approved';
}

/**
 * Map Reduce runs up to `maxParallel` items at once, captures each item's
 * output for the reduce step, and hands off to the reduce phase (rather than
 * completing) once every map item is terminal-successful.
 */
const mapReduceItemPolicy: ItemRunPolicy<MapReduceRun, MapReduceItem> = {
    concurrency: run => run.maxParallel,
    captureOutput: true,
    statusAfterItemTerminal: items => mapPhaseStatusAfterTerminalChange(items),
    statusAfterManualSkip: items => mapPhaseStatusAfterManualSkip(items),
    drainToTerminal: (run, now) =>
        run.reduceStep.status === 'pending'
            ? { ...run, status: 'reducing', updatedAt: now }
            : undefined,
};

export class FileMapReduceRunStore extends FileRunStoreBase<MapReduceRun, MapReduceRunSummary, MapReduceItem> {
    protected readonly runIdPrefix = 'map-reduce';
    protected readonly subsystemLabel = 'Map Reduce';
    protected readonly runsSubdir = 'map-reduce-runs';
    protected readonly policy = mapReduceItemPolicy;

    protected artifacts(run: MapReduceRun): RunArtifact[] {
        const { items, reduceStep, ...metadata } = run;
        return [
            { file: 'run.json', data: metadata },
            { file: 'items.json', data: items },
            { file: 'reduce-step.json', data: reduceStep },
        ];
    }

    protected summarize(run: MapReduceRun): MapReduceRunSummary {
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

    async createDraftRun(input: CreateMapReduceRunInput): Promise<MapReduceRun> {
        const normalizedItems = normalizeMapReduceItems(input.items);
        const reduceStep = createPendingMapReduceReduceStep();
        assertMapReduceDraftStatuses(normalizedItems, reduceStep);

        return this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const runId = this.mintRunId();
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

    async getRun(workspaceId: string, runId: string): Promise<MapReduceRun | undefined> {
        const metadata = await this.readJSONIfExists<MapReduceRunMetadata>(this.runPath(workspaceId, runId));
        if (!metadata) {
            return undefined;
        }
        if (metadata.workspaceId !== workspaceId || metadata.runId !== runId) {
            throw new Error(`Map Reduce run metadata mismatch for ${runId}`);
        }
        const rawItems = await this.readJSONIfExists<unknown>(this.artifactPath(workspaceId, runId, 'items.json'));
        const rawReduceStep = await this.readJSONIfExists<unknown>(this.artifactPath(workspaceId, runId, 'reduce-step.json'));
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
        return this.claimRunnable(workspaceId, runId);
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
            const item = this.findRunItem(current.items, itemId);
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
            const item = this.findRunItem(current.items, itemId);
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
            const item = this.findRunItem(current.items, itemId);
            if (item.status !== 'pending' && item.status !== 'failed') {
                throw new Error(`Map Reduce item '${itemId}' is ${item.status}; only pending or failed items can be skipped`);
            }

            const nextRun = this.applyManualSkip(current, item, new Date().toISOString());
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
            if (!allItemsTerminal(current.items)) {
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
            if (!allItemsTerminal(current.items)) {
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
