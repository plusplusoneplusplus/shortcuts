/**
 * Data Wiper
 *
 * Wipes all runtime/persistent data while preserving system configuration
 * files. Dry-run and execution share the same storage-domain wipe plan.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import {
    applyStorageWipePlanSummary,
    buildStorageWipePlan,
    executeStorageWipePlan,
} from './storage-snapshot-domains';

// ============================================================================
// Types
// ============================================================================

export interface WipeOptions {
    /** Whether to delete generated wiki output directories on disk. */
    includeWikis: boolean;
    /** Dry-run mode: compute summary without actually deleting data. */
    dryRun?: boolean;
}

export interface WipeResult {
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

// ============================================================================
// DataWiper
// ============================================================================

export class DataWiper {
    constructor(
        private readonly dataDir: string,
        private readonly store: ProcessStore,
    ) {}

    /**
     * Get a dry-run summary of what would be deleted.
     */
    async getDryRunSummary(options: Pick<WipeOptions, 'includeWikis'> = { includeWikis: false }): Promise<WipeResult> {
        return this.doWipe({ ...options, dryRun: true });
    }

    /**
     * Wipe all runtime data. Returns a summary of what was deleted.
     */
    async wipeData(options: WipeOptions): Promise<WipeResult> {
        return this.doWipe(options);
    }

    private async doWipe(options: WipeOptions & { dryRun?: boolean }): Promise<WipeResult> {
        const { includeWikis, dryRun = false } = options;
        const plan = await buildStorageWipePlan({
            dataDir: this.dataDir,
            store: this.store,
            includeWikis,
        });
        const result = createEmptyWipeResult();
        applyStorageWipePlanSummary(result, plan);

        if (!dryRun) {
            await executeStorageWipePlan({
                dataDir: this.dataDir,
                store: this.store,
                includeWikis,
            }, plan, result);
        }

        return result;
    }
}

function createEmptyWipeResult(): WipeResult {
    return {
        deletedProcesses: 0,
        deletedWorkspaces: 0,
        deletedWikis: 0,
        deletedQueues: 0,
        deletedSchedules: 0,
        deletedGitOps: 0,
        deletedRepoPreferences: 0,
        deletedPreferences: false,
        deletedWikiDirs: [],
        preservedFiles: [],
        errors: [],
    };
}
