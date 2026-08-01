import type {
    CancelForEachRunResult,
    ClaimedForEachItem,
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
import type { FileRunStoreBaseOptions, ItemRunPolicy, RunArtifact } from '../shared/file-run-store-base';
import { allItemsTerminal, FileRunStoreBase, hasRunningItem } from '../shared/file-run-store-base';

export type FileForEachRunStoreOptions = FileRunStoreBaseOptions<ForEachRun>;

function emptyStatusCounts(): Record<ForEachItemStatus, number> {
    return Object.fromEntries(FOR_EACH_ITEM_STATUSES.map(status => [status, 0])) as Record<ForEachItemStatus, number>;
}

/**
 * For Each runs one item at a time (concurrency 1), never capture item output,
 * and complete the run once every item is terminal — there is no reduce phase.
 */
const forEachItemPolicy: ItemRunPolicy<ForEachRun, ForEachItem> = {
    concurrency: () => 1,
    captureOutput: false,
    statusAfterItemTerminal: items =>
        items.some(item => item.status === 'failed')
            ? 'failed'
            : allItemsTerminal(items) ? 'completed' : 'running',
    statusAfterManualSkip: items =>
        allItemsTerminal(items)
            ? 'completed'
            : items.some(item => item.status === 'failed') ? 'failed' : 'approved',
    drainToTerminal: (run, now) => ({
        ...run,
        status: 'completed',
        completedAt: run.completedAt ?? now,
        updatedAt: now,
    }),
};

export class FileForEachRunStore extends FileRunStoreBase<ForEachRun, ForEachRunSummary, ForEachItem> {
    protected readonly runIdPrefix = 'for-each';
    protected readonly subsystemLabel = 'For Each';
    protected readonly runsSubdir = 'for-each-runs';
    protected readonly policy = forEachItemPolicy;

    protected artifacts(run: ForEachRun): RunArtifact[] {
        const { items, ...metadata } = run;
        return [
            { file: 'run.json', data: metadata },
            { file: 'items.json', data: items },
        ];
    }

    protected summarize(run: ForEachRun): ForEachRunSummary {
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

    async createDraftRun(input: CreateForEachRunInput): Promise<ForEachRun> {
        const normalizedItems = normalizeForEachItems(input.items);
        assertDraftInitialStatuses(normalizedItems);

        return this.enqueueWrite(async () => {
            const now = new Date().toISOString();
            const runId = this.mintRunId();
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
            if (input.autoProviderRouting?.requested) metadata.autoProviderRouting = { requested: true };
            if (input.model) metadata.model = input.model;
            if (input.reasoningEffort) metadata.reasoningEffort = input.reasoningEffort;
            if (input.generationProcessId) metadata.generationProcessId = input.generationProcessId;
            if (input.generationId) metadata.generationId = input.generationId;

            const run: ForEachRun = { ...metadata, items: normalizedItems };
            await this.writeRun(run);
            return run;
        });
    }

    async getRun(workspaceId: string, runId: string): Promise<ForEachRun | undefined> {
        const metadata = await this.readJSONIfExists<ForEachRunMetadata>(this.runPath(workspaceId, runId));
        if (!metadata) return undefined;
        if (metadata.workspaceId !== workspaceId || metadata.runId !== runId) {
            throw new Error(`For Each run metadata mismatch for ${runId}`);
        }
        const rawItems = await this.readJSONIfExists<unknown>(this.artifactPath(workspaceId, runId, 'items.json'));
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
            const nextRun: ForEachRun = { ...nextMetadata, items: normalizedItems };
            await this.writeRun(nextRun);
            return nextRun;
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
            const nextRun: ForEachRun = { ...nextMetadata, items };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async claimNextRunnableItem(workspaceId: string, runId: string): Promise<ClaimedForEachItem | undefined> {
        const claimed = await this.claimRunnable(workspaceId, runId);
        if (!claimed) {
            return undefined;
        }
        // Concurrency is 1, so the shared claim yields at most one item.
        return { run: claimed.run, item: claimed.items[0] };
    }

    async claimFailedItemForRetry(workspaceId: string, runId: string, itemId: string): Promise<ClaimedForEachItem> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'draft') {
                throw new Error(`For Each run '${runId}' is ${current.status}; failed items cannot be retried`);
            }
            if (hasRunningItem(current.items)) {
                throw new Error(`For Each run '${runId}' already has a running item`);
            }
            const item = this.findRunItem(current.items, itemId);
            if (item.status !== 'failed') {
                throw new Error(`For Each item '${itemId}' is ${item.status}; only failed items can be retried`);
            }

            const now = new Date().toISOString();
            item.status = 'running';
            item.startedAt = now;
            item.completedAt = undefined;
            item.error = undefined;
            item.childTaskId = undefined;
            item.childProcessId = undefined;
            const nextRun: ForEachRun = {
                ...current,
                status: 'running',
                updatedAt: now,
                completedAt: undefined,
            };
            await this.writeRun(nextRun);
            return { run: nextRun, item: { ...item } };
        });
    }

    async linkRunningItemChild(
        workspaceId: string,
        runId: string,
        itemId: string,
        childTaskId: string,
        childProcessId: string,
    ): Promise<ForEachRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            const item = this.findRunItem(current.items, itemId);
            if (item.status !== 'running') {
                throw new Error(`For Each item '${itemId}' is ${item.status}; only running items can be linked`);
            }

            item.childTaskId = childTaskId;
            item.childProcessId = childProcessId;
            const nextRun: ForEachRun = {
                ...current,
                updatedAt: new Date().toISOString(),
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async skipItem(workspaceId: string, runId: string, itemId: string): Promise<ForEachRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'draft') {
                throw new Error(`For Each run '${runId}' is ${current.status}; items cannot be skipped`);
            }
            if (hasRunningItem(current.items)) {
                throw new Error(`For Each run '${runId}' already has a running item`);
            }
            const item = this.findRunItem(current.items, itemId);
            if (item.status !== 'pending' && item.status !== 'failed') {
                throw new Error(`For Each item '${itemId}' is ${item.status}; only pending or failed items can be skipped`);
            }

            const nextRun = this.applyManualSkip(current, item, new Date().toISOString());
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async cancelRun(workspaceId: string, runId: string): Promise<CancelForEachRunResult> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            const childTaskIds = current.items
                .filter(item => item.status === 'running' && item.childTaskId)
                .map(item => item.childTaskId!)
                .filter(Boolean);
            if (current.status === 'cancelled') {
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
            const nextRun: ForEachRun = {
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
