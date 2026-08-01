import * as fs from 'fs/promises';
import * as path from 'path';
import { getRepoDataPath } from '@plusplusoneplusplus/forge';
import { atomicWriteJSON } from './fs-utils';

/**
 * Run IDs are used verbatim as filesystem directory names, so they are
 * restricted to filesystem-safe characters. Shared by every run store.
 */
export const RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

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

/**
 * Shared file-backed persistence for the near-identical For Each and Map Reduce
 * run stores. Owns the serialized write queue, run-id minting/sanitizing,
 * repo-scoped path layout, the `onRunChanged` notification, the multi-file
 * `writeRun`, and the `listRuns` directory-scan skeleton.
 *
 * Subsystem-specific behavior (which files a run persists, how a run is
 * normalized on read, how a run projects to its list summary) is delegated to
 * the concrete subclass.
 */
export abstract class FileRunStoreBase<
    TRun extends { workspaceId: string; runId: string; updatedAt: string },
    TSummary extends { updatedAt: string },
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
}
