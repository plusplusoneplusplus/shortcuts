import * as fs from 'node:fs';
import { DELEGATED_JOBS_FILE } from '../../delegation/delegated-job-store';
import { EMPTY_COLLECT_RESULT, type StorageSnapshotDomain } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

/** Operational delivery receipts stay machine-local and are cleared with server data. */
export function createDelegatedJobsDomain(): StorageSnapshotDomain<string[]> {
    return {
        id: 'delegated-jobs',
        collect: () => EMPTY_COLLECT_RESULT,
        restoreReplace() { /* Importing receipts could replay results into unrelated chats. */ },
        restoreMerge() { /* Receipts are not portable conversation data. */ },
        planWipe(ctx) {
            return { plan: listRepoFiles(ctx.dataDir, DELEGATED_JOBS_FILE), counts: {}, errors: [] };
        },
        executeWipe(_ctx, files, result) {
            for (const file of files ?? []) {
                try {
                    fs.unlinkSync(file);
                } catch (error) {
                    result.errors.push(`Failed to delete ${file}: ${getErrorMessage(error)}`);
                }
            }
        },
    };
}
