import type { RequestAdapter } from '../types';

/**
 * What the one-time initial merge did with a single note.
 *
 * There is deliberately no "deleted" outcome: on first contact a note present on
 * only one side is always kept, so the merge can only ever add.
 */
export type MergeOutcome =
    /** Present on both sides, byte-identical — nothing to do. */
    | 'identical'
    /** Present only on this device — added to the merged tree. */
    | 'addedFromLocal'
    /** Present only on the remote — preserved as-is. */
    | 'keptFromRemote'
    /** Present on both sides with differing text — the two versions were combined into one. */
    | 'combined'
    /** Present on both sides, differing, and not text — both versions were kept. */
    | 'keptBothBinary';

/** A binary both sides changed, and where this device's version was parked. */
export interface FlaggedBinary {
    /** Repo-relative POSIX path, holding the remote's version. */
    path: string;
    /** Where the local version was kept instead of being overwritten. */
    localVariantPath: string;
}

/**
 * What the one-time initial merge did, in the terms the user is told it in.
 *
 * Mirrors the server's `ReconcileReport`. Produced once when a mirror's baseline
 * is established by a merge, and never cleared afterwards.
 */
export interface ReconcileReport {
    /** How many notes landed in each outcome. */
    counts: Record<MergeOutcome, number>;
    /** How many notes the merged tree holds in total. */
    total: number;
    /** The notes whose two versions were combined into one. */
    combined: string[];
    /** Binaries kept in both versions, which a human should look at. */
    flagged: FlaggedBinary[];
    /** Tag holding the remote's pre-merge state, or null when nothing was pushed. */
    backupTag: string | null;
    /** SHA of the squashed merge commit. */
    mergedCommit: string;
    /** ISO timestamp of the merge. */
    reconciledAt: string;
}

/**
 * How a single conflicted note was resolved by a steady-state auto-merge.
 * Mirrors the server's `ResolutionStrategy`.
 *   - `ai`: the AI resolver combined both sides into one.
 *   - `simple`: textual concatenation kept both sides (no AI, or AI failed).
 *   - `keptRemoteFallback`: resolution errored, so the remote copy was kept and
 *     this device's edit was dropped — the one lossy outcome.
 */
export type ResolutionStrategy = 'ai' | 'simple' | 'keptRemoteFallback';

/** One conflicted note and how the auto-merge resolved it. */
export interface ResolvedFile {
    /** Repo-relative path of the conflicted note. */
    path: string;
    strategy: ResolutionStrategy;
}

/**
 * What the most recent steady-state auto-merge did. Mirrors the server's
 * `SyncResolutionReport`. Produced whenever a tick resolves real conflicts, and
 * never cleared by a later idle tick — only replaced by a newer resolution.
 */
export interface SyncResolutionReport {
    /** ISO timestamp of when the resolution committed. */
    resolvedAt: string;
    /** Files that had a real conflict this tick, with how each was resolved. */
    files: ResolvedFile[];
    /** SHA of the merge-resolution commit. */
    commit: string;
}

export interface SyncStatus {
    enabled: boolean;
    inProgress: boolean;
    lastSyncTime: string | null;
    lastError: string | null;
    /** Whether the in-progress sync is the one-time initial merge, which runs far longer than a tick. */
    reconcileInProgress: boolean;
    /** What the initial merge did, or null if no merge established this mirror's baseline. */
    reconcileReport: ReconcileReport | null;
    /**
     * Whether a commit is waiting to reach the remote because the last push
     * failed. Distinct from `lastError`: the local sync completed; only the
     * outbound push didn't land, and it retries next tick.
     */
    pushPending: boolean;
    /** The last push failure message, for a tooltip / detail line, or null. */
    lastPushError: string | null;
    /** What the most recent steady-state auto-merge did, or null if none has run. */
    lastResolution: SyncResolutionReport | null;
}

export class SyncClient {
    constructor(private readonly transport: RequestAdapter) {}

    getStatus(workspaceId: string): Promise<SyncStatus> {
        return this.transport.request<SyncStatus>(`/workspaces/${encodeURIComponent(workspaceId)}/sync/status`);
    }

    trigger(workspaceId: string): Promise<SyncStatus> {
        return this.transport.request<SyncStatus>(`/workspaces/${encodeURIComponent(workspaceId)}/sync/trigger`, { method: 'POST' });
    }
}
