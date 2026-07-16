export {
    SyncEngine,
    resolveConflictSimple,
    nextSyncDelayMs,
    backupTagStamp,
    DEFAULT_SYNC_INTERVAL_MINUTES,
    MAX_SYNC_BACKOFF_MINUTES,
} from './sync-engine';
export type { SyncStatus, SyncEngineOptions, SyncLogger, ReconcileResult } from './sync-engine';
export {
    RECONCILE_MARKER_NAME,
    RECONCILE_MARKER_VERSION,
    reconcileMarkerPath,
    readReconcileMarker,
    writeReconcileMarker,
    isUnrelatedHistoriesError,
    shouldReconcile,
    isNotesTreeNonEmpty,
    isDecodableText,
    localVariantPath,
    planUnionMerge,
    LOCAL_CONFLICT_LABEL,
    REMOTE_CONFLICT_LABEL,
    scanTreeToMap,
    buildConflictBlob,
    applyMergePlan,
    reconcileCommitMessage,
} from './sync-reconcile';
export type {
    ReconcileMarker,
    MergeOutcome,
    MergeEntry,
    MergePlan,
    ConflictResolver,
    ApplyMergePlanOptions,
    ApplyMergePlanResult,
} from './sync-reconcile';
export { registerSyncRoutes } from './sync-handler';
