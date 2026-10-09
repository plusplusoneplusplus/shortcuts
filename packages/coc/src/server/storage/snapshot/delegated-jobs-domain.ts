import * as fs from 'node:fs';
import { DELEGATED_JOBS_FILE } from '../../delegation/delegated-job-store';
import { SENTINEL_TODOS_FILE } from '../../sentinel-todos/sentinel-todo-store';
import { EMPTY_COLLECT_RESULT, type StorageSnapshotDomain } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

/** Operational delivery receipts stay machine-local and are cleared with server data. */
export function createDelegatedJobsDomain(): StorageSnapshotDomain<string[]> {
    return createMachineLocalRepoFileDomain('delegated-jobs', DELEGATED_JOBS_FILE);
}

/** Sentinel to-do ledgers are keyed by local chat IDs, so they follow the same policy. */
export function createSentinelTodosDomain(): StorageSnapshotDomain<string[]> {
    return createMachineLocalRepoFileDomain('sentinel-todos', SENTINEL_TODOS_FILE);
}

function createMachineLocalRepoFileDomain(id: string, filename: string): StorageSnapshotDomain<string[]> {
    return {
        id,
        collect: () => EMPTY_COLLECT_RESULT,
        restoreReplace() { /* Importing could attach records to unrelated chats. */ },
        restoreMerge() { /* Not portable conversation data. */ },
        planWipe(ctx) {
            return { plan: listRepoFiles(ctx.dataDir, filename), counts: {}, errors: [] };
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
