/**
 * Data Importer
 *
 * Validates a CoCExportPayload and restores its contents into the process
 * store, queue files, blob files, preferences, and schedules. Supports Replace
 * (wipe-then-restore) and Merge (add-only-missing) modes.
 */

import type {
    CoCExportPayload,
    ImportOptions,
    ImportResult,
} from './export-import-types';
import { validateExportPayload } from './export-import-types';
import {
    restoreStorageSnapshotMerge,
    restoreStorageSnapshotReplace,
} from './storage-snapshot-domains';

// ============================================================================
// Public API
// ============================================================================

/**
 * Import a {@link CoCExportPayload} into the local data store.
 *
 * In **replace** mode the existing data is wiped first, then the payload is
 * fully restored. In **merge** mode only items whose IDs do not already exist
 * in the store are added.
 */
export async function importData(
    payload: CoCExportPayload,
    options: ImportOptions,
): Promise<ImportResult> {
    const validation = validateExportPayload(payload);
    if (!validation.valid) {
        throw new Error(`Invalid payload: ${validation.error}`);
    }

    if (options.mode === 'replace') {
        return replaceImport(payload, options);
    }
    return mergeImport(payload, options);
}

// ============================================================================
// Replace mode
// ============================================================================

async function replaceImport(
    payload: CoCExportPayload,
    options: ImportOptions,
): Promise<ImportResult> {
    const result = createImportResult();

    options.getQueueManager?.()?.reset();

    const wipeResult = await options.wiper.wipeData({ includeWikis: true });
    result.errors.push(...wipeResult.errors);

    await restoreStorageSnapshotReplace(payload, options, result);

    try {
        options.getQueuePersistence?.()?.restore();
    } catch (err) {
        result.errors.push(`Failed to restore queue persistence: ${getErrorMessage(err)}`);
    }

    return result;
}

// ============================================================================
// Merge mode
// ============================================================================

async function mergeImport(
    payload: CoCExportPayload,
    options: ImportOptions,
): Promise<ImportResult> {
    const result = createImportResult();
    await restoreStorageSnapshotMerge(payload, options, result);
    return result;
}

function createImportResult(): ImportResult {
    return {
        importedProcesses: 0,
        importedWorkspaces: 0,
        importedWikis: 0,
        importedQueueFiles: 0,
        importedBlobFiles: 0,
        importedScheduleFiles: 0,
        importedRepoPreferenceFiles: 0,
        errors: [],
    };
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
