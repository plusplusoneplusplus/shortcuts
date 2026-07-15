/**
 * Git operations snapshot domain.
 *
 * Git operation records are wiped but are not part of the export schema, so
 * this domain contributes nothing to collect/restore and only removes per-repo
 * `git-ops.json` files on wipe.
 */

import * as fs from 'fs';
import type { StorageSnapshotDomain } from './types';
import { EMPTY_COLLECT_RESULT } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

export function createGitOpsDomain(): StorageSnapshotDomain<{ gitOpsFiles: string[] }> {
    return {
        id: 'git-ops',
        collect() {
            return EMPTY_COLLECT_RESULT;
        },
        restoreReplace() {
            // Git operation records are wiped but are not part of the export schema.
        },
        restoreMerge() {
            // Git operation records are wiped but are not part of the export schema.
        },
        planWipe(ctx) {
            const gitOpsFiles = listRepoFiles(ctx.dataDir, 'git-ops.json');
            return {
                plan: { gitOpsFiles },
                counts: { deletedGitOps: gitOpsFiles.length },
                errors: [],
            };
        },
        executeWipe(_ctx, plan, result) {
            for (const filePath of plan?.gitOpsFiles ?? []) {
                try {
                    fs.unlinkSync(filePath);
                } catch (err) {
                    result.errors.push(`Failed to delete ${filePath}: ${getErrorMessage(err)}`);
                }
            }
        },
    };
}
