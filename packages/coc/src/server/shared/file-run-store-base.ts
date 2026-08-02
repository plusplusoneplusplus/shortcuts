import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { atomicWriteJSON } from './fs-utils';

/**
 * Run IDs are used verbatim as filesystem directory names, so they are
 * restricted to filesystem-safe characters. Shared by every run store.
 */
export const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/** The five item lifecycle states shared by every run subsystem. */
export type RunItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Minimal shape of a run item the shared item state machine mutates. */
export interface RunItemLike {
    id: string;
    status: RunItemStatus;
    dependsOn?: string[];
    childProcessId?: string;
    childTaskId?: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
    output?: unknown;
}

/** Minimal shape of a run the shared item state machine reads and rewrites. */
export interface RunLike<TItem extends RunItemLike> {
    workspaceId: string;
    runId: string;
    status: string;
    updatedAt: string;
    completedAt?: string;
    items: TItem[];
}

/**
 * The four genuine forks between the For Each and Map Reduce item state
 * machines, made explicit. Everything else about claiming/marking/skipping
 * items is shared in {@link FileRunStoreBase}.
 */
export interface ItemRunPolicy<TRun extends RunLike<TItem>, TItem extends RunItemLike> {
    /** Max items allowed running at once. for-each: `() => 1`; map-reduce: `r => r.maxParallel`. */
    concurrency(run: TRun): number;
    /** Whether a completing item persists its child output (map-reduce only). */
    captureOutput: boolean;
    /** Run status after an item reaches a terminal (completed/failed) state. */
    statusAfterItemTerminal(items: TItem[], run: TRun): TRun['status'];
    /** Run status after a manual skip. */
    statusAfterManualSkip(items: TItem[], run: TRun): TRun['status'];
    /**
     * State to persist when a claim finds every item terminal and nothing left
     * to run. for-each completes the run; map-reduce hands off to its reduce
     * phase (only while the reduce step is still pending). Returns the run to
     * write, or `undefined` to write nothing.
     */
    drainToTerminal(run: TRun, now: string): TRun | undefined;
}

/** One JSON file persisted for a run, relative to the run directory. */
export interface RunArtifact {
    /** File name inside the run directory, e.g. `run.json`. */
    file: string;
    /** Serializable payload written to that file. */
    data: unknown;
}

export interface FileRunStoreBaseOptions<TRun> {
    dataDir: string;
    /**
     * Invoked after every successful run write with the fresh run state.
     * Used to keep the generic task-group registry in sync. Errors thrown
     * by the hook are swallowed — registry sync must never break runs.
     */
    onRunChanged?: (run: TRun) => void;
}

export function isTerminalItemStatus(status: RunItemStatus): boolean {
    return status === 'completed' || status === 'skipped';
}

export function allItemsTerminal(items: RunItemLike[]): boolean {
    return items.every(item => isTerminalItemStatus(item.status));
}

export function hasRunningItem(items: RunItemLike[]): boolean {
    return items.some(item => item.status === 'running');
}

export function findFailedItem<TItem extends RunItemLike>(items: TItem[]): TItem | undefined {
    return items.find(item => item.status === 'failed');
}

function dependenciesSatisfied(item: RunItemLike, items: RunItemLike[]): boolean {
    const byId = new Map(items.map(entry => [entry.id, entry]));
    return (item.dependsOn ?? []).every(id => {
        const dependency = byId.get(id);
        return dependency ? isTerminalItemStatus(dependency.status) : false;
    });
}

function findRunnableItems<TItem extends RunItemLike>(items: TItem[], limit: number): TItem[] {
    if (limit <= 0) {
        return [];
    }
    const runnable: TItem[] = [];
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

function clearItemExecutionState(item: RunItemLike, now: string, captureOutput: boolean): void {
    item.status = 'running';
    item.startedAt = now;
    item.completedAt = undefined;
    item.error = undefined;
    if (captureOutput) {
        item.output = undefined;
    }
    item.childTaskId = undefined;
    item.childProcessId = undefined;
}

/** Result of a successful item claim: the persisted run plus the claimed items. */
export interface ClaimedRunItems<TRun, TItem> {
    run: TRun;
    items: TItem[];
}

/**
 * Shared file-backed persistence for the near-identical For Each and Map Reduce
 * run stores. Owns the serialized write queue, run-id minting/sanitizing,
 * repo-scoped path layout, the `onRunChanged` notification, the multi-file
 * `writeRun`, the `listRuns` directory-scan skeleton, and the item state
 * machine (claim / mark completed / mark failed / manual skip) parametrized by
 * an {@link ItemRunPolicy}.
 *
 * Subsystem-specific behavior (which files a run persists, how a run is
 * normalized on read, how a run projects to its list summary, and the four
 * policy forks) is delegated to the concrete subclass.
 */
export abstract class FileRunStoreBase<
    TRun extends RunLike<TItem>,
    TSummary extends { updatedAt: string },
    TItem extends RunItemLike,
> {
    protected readonly dataDir: string;
    private readonly onRunChanged?: (run: TRun) => void;
    private writeQueue: Promise<void> = Promise.resolve();

    /** Prefix for minted run IDs, e.g. `for-each` or `map-reduce`. */
    protected abstract readonly runIdPrefix: string;
    /** Human-readable subsystem label for error messages, e.g. `For Each`. */
    protected abstract readonly subsystemLabel: string;
    /** Repo-scoped storage subdirectory, e.g. `for-each-runs`. */
    protected abstract readonly runsSubdir: string;
    /** The four genuine item state-machine forks for this subsystem. */
    protected abstract readonly policy: ItemRunPolicy<TRun, TItem>;

    constructor(options: FileRunStoreBaseOptions<TRun>) {
        this.dataDir = options.dataDir;
        this.onRunChanged = options.onRunChanged;
    }

    /** Files persisted for one run, in write order (run metadata first). */
    protected abstract artifacts(run: TRun): RunArtifact[];

    /** Load and normalize a run from disk; normalization differs per subsystem. */
    abstract getRun(workspaceId: string, runId: string): Promise<TRun | undefined>;

    /** Project a run into its list-summary shape. */
    protected abstract summarize(run: TRun): TSummary;

    protected sanitizeRunId(runId: string): string {
        if (!RUN_ID_PATTERN.test(runId)) {
            throw new Error(`Invalid ${this.subsystemLabel} run ID: ${runId}`);
        }
        return runId;
    }

    protected mintRunId(): string {
        return `${this.runIdPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    protected notifyRunChanged(run: TRun): void {
        try {
            this.onRunChanged?.(run);
        } catch {
            // Registry sync must never break run persistence.
        }
    }

    protected runsDir(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, this.runsSubdir);
    }

    protected runDir(workspaceId: string, runId: string): string {
        return path.join(this.runsDir(workspaceId), this.sanitizeRunId(runId));
    }

    protected runPath(workspaceId: string, runId: string): string {
        return this.artifactPath(workspaceId, runId, 'run.json');
    }

    /** Absolute path to a named artifact file inside a run's directory. */
    protected artifactPath(workspaceId: string, runId: string, file: string): string {
        return path.join(this.runDir(workspaceId, runId), file);
    }

    protected findRunItem(items: TItem[], itemId: string): TItem {
        const item = items.find(entry => entry.id === itemId);
        if (!item) {
            throw new Error(`${this.subsystemLabel} item not found: ${itemId}`);
        }
        return item;
    }

    protected enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.writeQueue.then(fn);
        this.writeQueue = result.then(() => undefined, () => undefined);
        return result;
    }

    protected async readJSONIfExists<T>(filePath: string): Promise<T | undefined> {
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            return JSON.parse(raw) as T;
        } catch (err: any) {
            if (err?.code === 'ENOENT') return undefined;
            throw err;
        }
    }

    protected async writeRun(run: TRun): Promise<void> {
        for (const artifact of this.artifacts(run)) {
            await atomicWriteJSON(this.artifactPath(run.workspaceId, run.runId, artifact.file), artifact.data);
        }
        this.notifyRunChanged(run);
    }

    async listRuns(workspaceId: string): Promise<TSummary[]> {
        let entries: string[];
        try {
            entries = await fs.readdir(this.runsDir(workspaceId));
        } catch (err: any) {
            if (err?.code === 'ENOENT') return [];
            throw err;
        }

        const runs: TRun[] = [];
        for (const entry of entries) {
            if (!RUN_ID_PATTERN.test(entry)) continue;
            const run = await this.getRun(workspaceId, entry);
            if (run) runs.push(run);
        }
        return runs
            .map(run => this.summarize(run))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    /**
     * Shared item claim. Honors the policy's concurrency fork (for-each claims
     * a single item because concurrency is 1; map-reduce fills open parallel
     * slots), the `blocked by failed item` guard, and the terminal handoff
     * (`drainToTerminal`). Returns the persisted run plus the newly-running
     * items, or `undefined` when nothing is claimable right now.
     */
    protected claimRunnable(workspaceId: string, runId: string): Promise<ClaimedRunItems<TRun, TItem> | undefined> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`${this.subsystemLabel} run not found: ${runId}`);
            }
            if (current.status === 'draft') {
                throw new Error(`${this.subsystemLabel} run '${runId}' must be approved before execution`);
            }
            if (current.status === 'cancelled' || current.status === 'completed' || current.status === 'reducing') {
                return undefined;
            }

            const failed = findFailedItem(current.items);
            if (failed) {
                if (hasRunningItem(current.items)) {
                    return undefined;
                }
                if (current.status !== 'failed') {
                    const failedRun = { ...current, status: 'failed', updatedAt: new Date().toISOString() } as TRun;
                    await this.writeRun(failedRun);
                }
                throw new Error(`${this.subsystemLabel} run '${runId}' is blocked by failed item '${failed.id}'`);
            }
            if (current.status === 'failed') {
                return undefined;
            }

            if (allItemsTerminal(current.items)) {
                const drained = this.policy.drainToTerminal(current, new Date().toISOString());
                if (drained) {
                    await this.writeRun(drained);
                }
                return undefined;
            }

            const runningCount = current.items.filter(item => item.status === 'running').length;
            const availableSlots = Math.max(0, this.policy.concurrency(current) - runningCount);
            const runnableItems = findRunnableItems(current.items, availableSlots);
            if (runnableItems.length === 0) {
                if (availableSlots === 0 || hasRunningItem(current.items)) {
                    return undefined;
                }
                throw new Error(`${this.subsystemLabel} run '${runId}' has no runnable pending items`);
            }

            const now = new Date().toISOString();
            for (const item of runnableItems) {
                clearItemExecutionState(item, now, this.policy.captureOutput);
            }
            const nextRun = { ...current, status: 'running', updatedAt: now, completedAt: undefined } as TRun;
            await this.writeRun(nextRun);
            return { run: nextRun, items: runnableItems.map(item => ({ ...item })) };
        });
    }

    async markRunningItemCompleted(
        workspaceId: string,
        runId: string,
        itemId: string,
        childTaskId?: string,
        output?: unknown,
    ): Promise<TRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`${this.subsystemLabel} run not found: ${runId}`);
            }
            if (current.status === 'cancelled') {
                return current;
            }
            const item = this.findRunItem(current.items, itemId);
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
            if (this.policy.captureOutput) {
                item.output = output;
            }
            const nextStatus = this.policy.statusAfterItemTerminal(current.items, current);
            const nextRun = {
                ...current,
                status: nextStatus,
                completedAt: nextStatus === 'completed' ? now : undefined,
                updatedAt: now,
            } as TRun;
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    async markRunningItemFailed(
        workspaceId: string,
        runId: string,
        itemId: string,
        error: string,
        childTaskId?: string,
    ): Promise<TRun> {
        return this.enqueueWrite(async () => {
            const current = await this.getRun(workspaceId, runId);
            if (!current) {
                throw new Error(`${this.subsystemLabel} run not found: ${runId}`);
            }
            if (current.status === 'cancelled') {
                return current;
            }
            const item = this.findRunItem(current.items, itemId);
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
            const nextRun = {
                ...current,
                status: this.policy.statusAfterItemTerminal(current.items, current),
                updatedAt: now,
            } as TRun;
            await this.writeRun(nextRun);
            return nextRun;
        });
    }

    /**
     * Applies a manual skip to `item` and returns the run to persist. Callers
     * own the subsystem-specific guard checks (which statuses forbid skipping,
     * the drain-first requirement) before invoking this shared core.
     */
    protected applyManualSkip(current: TRun, item: TItem, now: string): TRun {
        item.status = 'skipped';
        item.completedAt = now;
        item.error = undefined;
        const nextStatus = this.policy.statusAfterManualSkip(current.items, current);
        return {
            ...current,
            status: nextStatus,
            completedAt: nextStatus === 'completed' ? now : undefined,
            updatedAt: now,
        } as TRun;
    }
}
