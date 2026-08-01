/**
 * Git-backed sync engine for My Work / My Life notes.
 *
 * Each workspace gets its own SyncEngine instance. The engine
 * clones/pulls/pushes a user-configured Git remote to synchronize
 * note files across machines.
 *
 * Mapping (per workspace):
 *   ~/.coc/repos/<workspaceId>/notes/  ↔  ~/.coc/sync/<sync-subfolder>/
 *
 * This file is the thin facade: it owns the {@link SyncStatus}, wires the
 * git / mirror / conflict / transaction / scheduler kernels together, and keeps
 * the public `start` / `stop` / `triggerSync` / `getStatus` API stable. The
 * ordering-sensitive work lives in the kernels beside it (`sync-git`,
 * `sync-mirror`, `sync-conflict`, `sync-transaction`, `sync-scheduler`).
 */

import * as path from 'path';
import { DEFAULT_SYNC_INTERVAL_MINUTES, MAX_SYNC_BACKOFF_MINUTES } from './sync-constants';
import { readReconcileMarker, readResolutionMarker, reconcileReport } from './sync-reconcile';
import { DEFAULT_LOGGER } from './sync-types';
import type { SyncStatus, SyncEngineOptions, SyncLogger } from './sync-types';
import { SyncGitRepository } from './sync-git';
import { SyncMirrorCopier } from './sync-mirror';
import { SyncConflictResolver } from './sync-conflict';
import { SyncTransactionRunner } from './sync-transaction';
import { SyncScheduler } from './sync-scheduler';
import { acquireLock, releaseLock } from './sync-lock';

// ── Re-exports ────────────────────────────────────────────────────────────────
// The engine is the historical entry point; keep its surface stable by
// re-exporting the primitives that moved into the kernel modules.

export { DEFAULT_SYNC_INTERVAL_MINUTES, MAX_SYNC_BACKOFF_MINUTES };
export { SYNC_IGNORE_NAMES, copyDirContents, copyFileIfChanged } from './sync-mirror';
export { resolveConflictSimple, resolveConflictWithAI } from './sync-conflict';
export { nextSyncDelayMs, SyncScheduler } from './sync-scheduler';
export { backupTagStamp } from './sync-transaction';
export { SyncGitRepository } from './sync-git';
export { SyncMirrorCopier } from './sync-mirror';
export { SyncConflictResolver } from './sync-conflict';
export { SyncTransactionRunner } from './sync-transaction';
export type { SyncStatus, SyncEngineOptions, SyncLogger, ReconcileResult } from './sync-types';

export class SyncEngine {
    private readonly workspaceId: string;
    private readonly syncRepoDir: string;
    private readonly lockPath: string;
    private readonly logger: SyncLogger;
    private readonly localDir: string;

    private status: SyncStatus = {
        inProgress: false,
        lastSyncTime: null,
        lastError: null,
        enabled: false,
        reconcileInProgress: false,
        reconcileReport: null,
        pushPending: false,
        lastPushError: null,
        lastResolution: null,
    };

    // Kernels are held as fields (not just constructor locals) so the ordered
    // transaction can be driven and observed in isolation from tests.
    private readonly git: SyncGitRepository;
    private readonly mirror: SyncMirrorCopier;
    private readonly resolver: SyncConflictResolver;
    private readonly transaction: SyncTransactionRunner;
    private readonly scheduler: SyncScheduler;

    /** The remote of the most recent sync, so a scheduled tick knows where to push. */
    private gitRemoteCache: string = '';

    constructor(opts: SyncEngineOptions) {
        this.workspaceId = opts.workspaceId;
        const syncSubfolder = opts.workspaceId.replace(/_/g, '-');
        this.syncRepoDir = path.join(opts.dataDir, 'sync', syncSubfolder);
        // Beside the mirror, never inside it. A lock in the working tree is a
        // file the mirror has to keep explaining away: `git clone .` refuses a
        // directory holding one, `git add -A` commits it to the user's notes,
        // and rebuilding the mirror would delete the lock out from under the
        // tick holding it.
        this.lockPath = path.join(opts.dataDir, 'sync', `${syncSubfolder}.lock`);
        this.logger = opts.logger ?? DEFAULT_LOGGER;
        this.localDir = path.join(opts.dataDir, 'repos', opts.workspaceId, 'notes');

        this.git = new SyncGitRepository(this.syncRepoDir, this.logger);
        this.mirror = new SyncMirrorCopier(this.localDir, this.syncRepoDir);
        this.resolver = new SyncConflictResolver(this.git, this.syncRepoDir, this.logger, opts.aiInvoker);
        this.transaction = new SyncTransactionRunner({
            git: this.git,
            mirror: this.mirror,
            resolver: this.resolver,
            syncRepoDir: this.syncRepoDir,
            localDir: this.localDir,
            logger: this.logger,
            status: this.status,
        });
        this.scheduler = new SyncScheduler({
            logger: this.logger,
            maxBackoffMs: MAX_SYNC_BACKOFF_MINUTES * 60_000,
            tick: () => this.performSync(this.gitRemoteCache).catch(() => {}),
            didFail: () => this.status.lastError !== null,
            shouldRun: () => this.status.enabled,
        });
    }

    /** Returns the current sync status. */
    getStatus(): SyncStatus {
        return { ...this.status };
    }

    /**
     * Start (or reconfigure) the sync engine: do an initial sync, then schedule
     * periodic syncs. Passing an empty gitRemote disables the engine and stops
     * any running timer — useful when the user clears the remote in settings.
     */
    async start(gitRemote: string, intervalMinutes: number): Promise<void> {
        if (!gitRemote) {
            this.logger.info(`Sync disabled for ${this.workspaceId} (no gitRemote configured)`);
            this.status.enabled = false;
            this.gitRemoteCache = '';
            this.scheduler.stop();
            return;
        }

        this.status.enabled = true;
        this.logger.info(`Starting sync engine for ${this.workspaceId}`);

        // The merge that made this mirror's baseline may have happened on a
        // previous run of the server. Its summary is the user's one account of
        // which notes got combined, so read it back rather than showing nothing.
        this.status.reconcileReport = reconcileReport(await readReconcileMarker(this.syncRepoDir));
        // The last steady-state auto-merge may likewise predate this run; its
        // summary is the only record of which notes were combined for the user
        // (and whether any edit was dropped), so hydrate it the same way.
        this.status.lastResolution = await readResolutionMarker(this.syncRepoDir);

        // Fire-and-forget initial sync — don't block server startup
        this.performSync(gitRemote).catch(() => {});

        this.scheduler.start(intervalMinutes);
    }

    /** Stop the periodic sync timer. */
    stop(): void {
        this.scheduler.stop();
    }

    /**
     * Trigger a one-off sync immediately. Returns when complete.
     * Exposed for the manual-trigger REST endpoint.
     */
    async triggerSync(gitRemote: string): Promise<SyncStatus> {
        await this.performSync(gitRemote);
        return this.getStatus();
    }

    /**
     * Guard the ordered transaction with the in-progress flag and the cross-process
     * lock, and fold any thrown failure into `lastError`. The ordering-sensitive
     * body lives in {@link SyncTransactionRunner}; this wrapper only owns the
     * things a skipped/failed tick must leave consistent.
     */
    private async performSync(gitRemote: string): Promise<void> {
        if (this.status.inProgress) {
            this.logger.warn('Sync already in progress, skipping');
            return;
        }

        if (!await acquireLock(this.lockPath)) {
            this.logger.warn('Could not acquire sync lock, skipping');
            return;
        }

        this.gitRemoteCache = gitRemote;
        this.status.inProgress = true;
        this.status.lastError = null;

        try {
            await this.transaction.run(gitRemote);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            this.status.lastError = message;
            this.logger.error(`Sync failed: ${message}`);
        } finally {
            this.status.inProgress = false;
            await releaseLock(this.lockPath);
        }
    }
}
