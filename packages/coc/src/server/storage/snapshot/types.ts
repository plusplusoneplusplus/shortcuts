/**
 * Storage snapshot domain contract.
 *
 * Shared types every snapshot domain implements so export, import, and wipe
 * behavior stays aligned. Public payload shapes remain defined in
 * export-import-types.ts.
 */

import type {
    AIProcess,
    ProcessStore,
    TaskQueueManager,
    WikiInfo,
    WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import type {
    CoCExportPayload,
    ExportMetadata,
    ImageBlobEntry,
    ImportResult,
    QueuePersistence,
    QueueSnapshot,
    RepoPreferencesSnapshot,
    ScheduleSnapshot,
} from '../export-import-types';

/** Read-only context available while collecting or planning a snapshot. */
export interface StorageSnapshotContext {
    dataDir: string;
    store: ProcessStore;
}

/** Collect/plan context extended with the live queue accessors used on import. */
export interface RestoreSnapshotContext extends StorageSnapshotContext {
    getQueueManager?: () => TaskQueueManager | undefined;
    getQueuePersistence?: () => QueuePersistence | undefined;
}

/** One domain's contribution to a collected snapshot. */
export interface CollectResult {
    data: Partial<StorageSnapshotData>;
    metadata: Partial<ExportMetadata>;
    warnings: string[];
}

/** Every persisted data family gathered into a single snapshot. */
export interface StorageSnapshotData {
    processes: AIProcess[];
    workspaces: WorkspaceInfo[];
    wikis: WikiInfo[];
    queueHistory: QueueSnapshot[];
    preferences: Record<string, unknown>;
    imageBlobs: ImageBlobEntry[];
    repoPreferences: RepoPreferencesSnapshot[];
    scheduleHistory: ScheduleSnapshot[];
}

/** Per-domain dry-run counts contributed to the aggregate wipe plan. */
export interface WipeCounts {
    deletedProcesses: number;
    deletedWorkspaces: number;
    deletedWikis: number;
    deletedQueues: number;
    deletedSchedules: number;
    deletedGitOps: number;
    deletedRepoPreferences: number;
    deletedPreferences: boolean;
    deletedWikiDirs: string[];
}

/** A domain's wipe plan: the concrete deletions plus their dry-run counts. */
export interface WipePlanResult<TPlan> {
    plan: TPlan;
    counts: Partial<WipeCounts>;
    errors: string[];
}

/**
 * Contract every storage family implements. A domain owns collect (export),
 * restore (import replace/merge), and wipe (plan + execute) for its data so the
 * three stay aligned as new families are added.
 */
export interface StorageSnapshotDomain<TPlan = unknown> {
    readonly id: string;
    collect(ctx: StorageSnapshotContext): Promise<CollectResult> | CollectResult;
    restoreReplace(payload: CoCExportPayload, ctx: RestoreSnapshotContext, result: ImportResult): Promise<void> | void;
    restoreMerge(payload: CoCExportPayload, ctx: RestoreSnapshotContext, result: ImportResult): Promise<void> | void;
    planWipe(ctx: StorageSnapshotContext & { includeWikis: boolean }): Promise<WipePlanResult<TPlan>> | WipePlanResult<TPlan>;
    executeWipe(ctx: StorageSnapshotContext & { includeWikis: boolean }, plan: TPlan, result: { errors: string[] }): Promise<void> | void;
}

/** Full snapshot returned by {@link collectStorageSnapshot}. */
export interface CollectedStorageSnapshot extends StorageSnapshotData {
    metadata: ExportMetadata;
    warnings: string[];
}

/** Aggregate wipe plan built from every domain's per-domain plan. */
export interface StorageWipePlan {
    domainPlans: Map<string, unknown>;
    deletedProcesses: number;
    deletedWorkspaces: number;
    deletedWikis: number;
    deletedQueues: number;
    deletedSchedules: number;
    deletedGitOps: number;
    deletedRepoPreferences: number;
    deletedPreferences: boolean;
    deletedWikiDirs: string[];
    preservedFiles: string[];
    errors: string[];
}

/** Shared empty result for domains that contribute nothing to a collect pass. */
export const EMPTY_COLLECT_RESULT: CollectResult = {
    data: {},
    metadata: {},
    warnings: [],
};
