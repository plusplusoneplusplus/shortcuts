/**
 * Owns the lifecycle shared by every background git operation exposed over REST:
 * job-ID minting, the "already running" guard, `GitOpsStore` create/update,
 * terminal status mapping, mutable git-cache invalidation, and the
 * `gitChanged` websocket broadcast.
 *
 * Route handlers supply only the parsed input and the `BranchService` call;
 * everything else lives here so a fix to job or broadcast semantics lands once.
 */

import type { GitOpJob, GitOpMetadata, GitOpStatus, GitOpType, GitOpsStore } from '@plusplusoneplusplus/forge';
import { conflict } from '../errors';
import { gitCache } from './git-cache';

/** Minimal websocket surface the runner needs — keeps tests free of a real WS server. */
export interface GitChangeBroadcaster {
    broadcastGitChanged(workspaceId: string, reason: string): void;
}

/** Minimal git-cache surface the runner needs. */
export interface GitMutableCache {
    invalidateMutable(workspaceId: string): void;
}

export interface GitOperationRunnerDeps {
    gitOpsStore: GitOpsStore;
    getWsServer?: () => GitChangeBroadcaster | undefined;
    /** Defaults to the module-level `gitCache`. Injectable for tests. */
    cache?: GitMutableCache;
    /** Job-ID entropy. Injectable so tests can assert deterministic IDs. */
    generateJobSuffix?: () => string;
}

/** The shape every `BranchService` mutation returns. */
export interface GitOperationOutcome {
    success: boolean;
    error?: string;
}

export interface StartGitOperationOptions {
    workspaceId: string;
    op: GitOpType;
    /** The actual git work. Resolved value maps to success/failed; a rejection maps to failed. */
    run: () => Promise<GitOperationOutcome>;
    /**
     * When set, reject with 409 and this message if an operation of the same
     * type is already running for the workspace.
     */
    rejectIfRunning?: string;
    /** Invalidate mutable git cache entries once the operation reaches a terminal state. */
    invalidateCache?: boolean;
    /** Broadcast reason. Defaults to the op name. */
    broadcastReason?: string;
}

export class GitOperationRunner {
    constructor(private readonly deps: GitOperationRunnerDeps) {}

    /** `<op>-<epochMillis>-<suffix>` — stable prefix so job IDs stay greppable by op. */
    createJobId(op: GitOpType): string {
        const suffix = this.deps.generateJobSuffix?.() ?? Math.random().toString(36).slice(2, 8);
        return `${op}-${Date.now()}-${suffix}`;
    }

    /** Throw a 409 when an operation of this type is already running. */
    async ensureNotRunning(workspaceId: string, op: GitOpType, message: string): Promise<void> {
        const running = await this.deps.gitOpsStore.getRunning(workspaceId, op);
        if (running.length > 0) throw conflict(message);
    }

    invalidateCache(workspaceId: string): void {
        (this.deps.cache ?? gitCache).invalidateMutable(workspaceId);
    }

    broadcast(workspaceId: string, reason: string): void {
        this.deps.getWsServer?.()?.broadcastGitChanged(workspaceId, reason);
    }

    /** Persist a job record. Used for both running jobs and already-terminal ones. */
    async createJob(job: Omit<GitOpJob, 'pid'> & { pid?: number }): Promise<GitOpJob> {
        const record: GitOpJob = { pid: process.pid, ...job };
        await this.deps.gitOpsStore.create(record);
        return record;
    }

    /** Record an already-completed operation (e.g. a synchronous patch transfer). */
    async recordCompleted(options: {
        workspaceId: string;
        op: GitOpType;
        startedAt: string;
        status?: GitOpStatus;
        metadata?: GitOpMetadata;
    }): Promise<GitOpJob> {
        return this.createJob({
            id: this.createJobId(options.op),
            workspaceId: options.workspaceId,
            op: options.op,
            status: options.status ?? 'success',
            startedAt: options.startedAt,
            finishedAt: new Date().toISOString(),
            metadata: options.metadata,
        });
    }

    /**
     * Start a background git operation.
     *
     * Creates the `running` job, returns its ID immediately, and settles the job
     * (status, cache, broadcast) when `run()` resolves or rejects.
     */
    async start(options: StartGitOperationOptions): Promise<{ jobId: string }> {
        const { workspaceId, op } = options;
        if (options.rejectIfRunning) {
            await this.ensureNotRunning(workspaceId, op, options.rejectIfRunning);
        }

        const jobId = this.createJobId(op);
        await this.createJob({
            id: jobId,
            workspaceId,
            op,
            status: 'running',
            startedAt: new Date().toISOString(),
        });

        const reason = options.broadcastReason ?? op;
        void options.run()
            .then(
                (result): { status: Exclude<GitOpStatus, 'running'>; error?: string } =>
                    ({ status: result.success ? 'success' : 'failed', error: result.error }),
                (err): { status: Exclude<GitOpStatus, 'running'>; error?: string } =>
                    ({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' }),
            )
            .then(terminal => this.settle(workspaceId, jobId, {
                ...terminal,
                invalidateCache: options.invalidateCache,
                broadcastReason: reason,
            }))
            // A failure to *record* the outcome must not surface as an unhandled rejection;
            // `settle` has already invalidated and broadcast by this point.
            .catch(() => { /* status reporting is best-effort */ });

        return { jobId };
    }

    /**
     * Move a job to a terminal state and run the follow-up side effects.
     * Exposed for operations driven by an external lifecycle (e.g. the queue).
     */
    async settle(
        workspaceId: string,
        jobId: string,
        options: {
            status: Exclude<GitOpStatus, 'running'>;
            error?: string;
            invalidateCache?: boolean;
            broadcastReason: string;
        },
    ): Promise<void> {
        try {
            await this.deps.gitOpsStore.update(workspaceId, jobId, {
                status: options.status,
                finishedAt: new Date().toISOString(),
                error: options.error,
            });
        } finally {
            if (options.invalidateCache) this.invalidateCache(workspaceId);
            this.broadcast(workspaceId, options.broadcastReason);
        }
    }
}
