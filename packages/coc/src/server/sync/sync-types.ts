/**
 * Shared types for the notes sync engine and its kernels.
 *
 * Kept in a dependency-free module so the git/mirror/conflict/transaction
 * kernels can share the status and logger contracts without importing each
 * other or the engine facade.
 */

import type { AIInvoker } from '@plusplusoneplusplus/forge';
import type { MergePlan, ReconcileReport, SyncResolutionReport } from './sync-reconcile';

export interface SyncStatus {
    /** Whether a sync is currently in progress */
    inProgress: boolean;
    /** ISO timestamp of last successful sync, or null if never synced */
    lastSyncTime: string | null;
    /** Error message from last sync attempt, or null if OK */
    lastError: string | null;
    /** Whether sync is enabled (gitRemote configured) */
    enabled: boolean;
    /**
     * Whether the in-progress sync is the one-time initial merge. It can take a
     * lot longer than an ordinary tick — it reads both trees and may call the AI
     * once per colliding note — so it is worth saying so rather than showing the
     * usual "syncing" for a minute.
     */
    reconcileInProgress: boolean;
    /**
     * What the initial merge did, or null if no merge established this mirror's
     * baseline. Survives a restart (it is read back off the marker), and is never
     * cleared: it describes a one-time event, and an automatic tick a few minutes
     * later must not be what wipes the summary before the user has read it.
     */
    reconcileReport: ReconcileReport | null;
    /**
     * Whether a commit is waiting to reach the remote because the last push
     * failed. Kept distinct from `lastError`: the local sync did complete (local
     * notes are consistent with the merged tree), only the outbound push didn't
     * land, and it retries next tick. Cleared only by a successful push.
     */
    pushPending: boolean;
    /** The last push failure message, for a tooltip / detail line, or null. */
    lastPushError: string | null;
    /**
     * What the most recent steady-state auto-merge did, or null if none has run.
     * Like `reconcileReport`, it survives a restart and is never cleared by an
     * idle tick; it is replaced when a newer tick resolves conflicts.
     */
    lastResolution: SyncResolutionReport | null;
}

/** What the one-time initial reconcile did, for reporting and for tests. */
export interface ReconcileResult {
    /** Every path's outcome, plus the counts the status report is built from. */
    plan: MergePlan;
    /** SHA of the squashed merge commit, or the remote's HEAD when nothing changed. */
    mergedCommit: string;
    /** Tag holding the remote's pre-merge HEAD, or null when nothing was pushed. */
    backupTag: string | null;
    /** The same outcome as the status reports it, as persisted on the marker. */
    report: ReconcileReport;
}

export interface SyncEngineOptions {
    dataDir: string;
    /** Virtual workspace ID: 'my_work' or 'my_life' */
    workspaceId: string;
    logger?: SyncLogger;
    /** Optional AI invoker for intelligent merge conflict resolution. Falls back to simple resolution when absent. */
    aiInvoker?: AIInvoker;
}

export interface SyncLogger {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
}

export const DEFAULT_LOGGER: SyncLogger = {
    info: (msg) => console.log(`[sync] ${msg}`),
    warn: (msg) => console.warn(`[sync] ${msg}`),
    error: (msg) => console.error(`[sync] ${msg}`),
};
