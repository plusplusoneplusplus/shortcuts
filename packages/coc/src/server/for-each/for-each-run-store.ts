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
import type { FileRunStoreBaseOptions, RunArtifact } from '../shared/file-run-store-base';
import { FileRunStoreBase } from '../shared/file-run-store-base';

export type FileForEachRunStoreOptions = FileRunStoreBaseOptions<ForEachRun>;

function emptyStatusCounts(): Record<ForEachItemStatus, number> {
    return Object.fromEntries(FOR_EACH_ITEM_STATUSES.map(status => [status, 0])) as Record<ForEachItemStatus, number>;
}

function isTerminalItemStatus(status: ForEachItemStatus): boolean {
    return status === 'completed' || status === 'skipped';
}

function allItemsTerminal(items: ForEachItem[]): boolean {
    return items.every(item => isTerminalItemStatus(item.status));
}

function dependenciesSatisfied(item: ForEachItem, items: ForEachItem[]): boolean {
    const byId = new Map(items.map(entry => [entry.id, entry]));
    return (item.dependsOn ?? []).every(id => {
        const dependency = byId.get(id);
        return dependency ? isTerminalItemStatus(dependency.status) : false;
    });
}

function findNextRunnableItem(items: ForEachItem[]): ForEachItem | undefined {
    return items.find(item => item.status === 'pending' && dependenciesSatisfied(item, items));
}

function findItem(items: ForEachItem[], itemId: string): ForEachItem {
    const item = items.find(entry => entry.id === itemId);
    if (!item) {
        throw new Error(`For Each item not found: ${itemId}`);
    }
    return item;
}

function hasRunningItem(items: ForEachItem[]): boolean {
    return items.some(item => item.status === 'running');
}

function hasFailedItem(items: ForEachItem[]): boolean {
    return items.some(item => item.status === 'failed');
}

export class FileForEachRunStore extends FileRunStoreBase<ForEachRun, ForEachRunSummary> {
    protected readonly runIdPrefix = 'for-each';
    protected readonly subsystemLabel = 'For Each';
    protected readonly runsSubdir = 'for-each-runs';

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
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
            }
            if (current.status === 'draft') {
                throw new Error(`For Each run '${runId}' must be approved before execution`);
            }
            if (current.status === 'cancelled' || current.status === 'completed') {
                return undefined;
            }
            if (hasRunningItem(current.items)) {
                return undefined;
            }
            const failed = current.items.find(item => item.status === 'failed');
            if (failed) {
                throw new Error(`For Each run '${runId}' is blocked by failed item '${failed.id}'`);
            }

            const nextItem = findNextRunnableItem(current.items);
            if (!nextItem) {
                if (allItemsTerminal(current.items)) {
                    const now = new Date().toISOString();
                    const completedRun: ForEachRun = {
                        ...current,
                        status: 'completed',
                        completedAt: current.completedAt ?? now,
                        updatedAt: now,
                    };
                    await this.writeRun(completedRun);
                    return undefined;
                }
                throw new Error(`For Each run '${runId}' has no runnable pending items`);
            }

            const now = new Date().toISOString();
            nextItem.status = 'running';
            nextItem.startedAt = now;
            nextItem.completedAt = undefined;
            nextItem.error = undefined;
            nextItem.childTaskId = undefined;
            nextItem.childProcessId = undefined;
            const nextRun: ForEachRun = {
                ...current,
                status: 'running',
                updatedAt: now,
                completedAt: undefined,
            };
            await this.writeRun(nextRun);
            return { run: nextRun, item: { ...nextItem } };
        });
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
            const item = findItem(current.items, itemId);
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
            const item = findItem(current.items, itemId);
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

    async markRunningItemCompleted(workspaceId: string, runId: string, itemId: string, childTaskId?: string): Promise<ForEachRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
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
            const nextRun: ForEachRun = {
                ...current,
                status: allItemsTerminal(current.items) ? 'completed' : 'running',
                completedAt: allItemsTerminal(current.items) ? now : undefined,
                updatedAt: now,
            };
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async markRunningItemFailed(workspaceId: string, runId: string, itemId: string, error: string, childTaskId?: string): Promise<ForEachRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`For Each run not found: ${runId}`);
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
            const nextRun: ForEachRun = {
                ...current,
                status: 'failed',
                updatedAt: now,
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
            const item = findItem(current.items, itemId);
            if (item.status !== 'pending' && item.status !== 'failed') {
                throw new Error(`For Each item '${itemId}' is ${item.status}; only pending or failed items can be skipped`);
            }

            const now = new Date().toISOString();
            item.status = 'skipped';
            item.completedAt = now;
            item.error = undefined;
            const nextStatus = allItemsTerminal(current.items)
                ? 'completed'
                : hasFailedItem(current.items)
                    ? 'failed'
                    : 'approved';
            const nextRun: ForEachRun = {
                ...current,
                status: nextStatus,
                updatedAt: now,
                completedAt: nextStatus === 'completed' ? now : undefined,
            };
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
