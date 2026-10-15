import * as fs from 'node:fs';
import { EMPTY_COLLECT_RESULT, type StorageSnapshotDomain } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

/** Machine-local screenshots participate in wipe, not export or import. */
export function createBrowserScreenshotsDomain(): StorageSnapshotDomain<string[]> {
    return {
        id: 'browser-screenshots',
        collect: () => EMPTY_COLLECT_RESULT,
        restoreReplace() { /* Restores preserve machine-local screenshots. */ },
        restoreMerge() { /* Screenshots are not portable snapshot data. */ },
        planWipe(ctx) {
            return { plan: listRepoFiles(ctx.dataDir, 'browser-screenshots'), counts: {}, errors: [] };
        },
        executeWipe(_ctx, directories, result) {
            for (const directory of directories ?? []) {
                try {
                    fs.rmSync(directory, { recursive: true, force: true });
                } catch (error) {
                    result.errors.push(`Failed to delete ${directory}: ${getErrorMessage(error)}`);
                }
            }
        },
    };
}
