/**
 * Storage snapshot domains — compatibility barrel.
 *
 * The implementation now lives under `storage/snapshot/`, split by domain
 * (core store, queue, image blobs, preferences, schedules, git ops) with a
 * declarative registry. This barrel keeps the public orchestration API stable
 * for existing importers (data-exporter, data-importer, data-wiper).
 *
 * Public payload shapes remain defined in export-import-types.ts.
 */

export {
    collectStorageSnapshot,
    restoreStorageSnapshotReplace,
    restoreStorageSnapshotMerge,
    buildStorageWipePlan,
    applyStorageWipePlanSummary,
    executeStorageWipePlan,
    createSnapshotDomains,
} from './snapshot/registry';

export type {
    CollectedStorageSnapshot,
    StorageWipePlan,
} from './snapshot/types';
