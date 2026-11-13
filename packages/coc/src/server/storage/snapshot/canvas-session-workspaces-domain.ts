import * as fs from 'node:fs';
import * as path from 'node:path';
import { EMPTY_COLLECT_RESULT, type StorageSnapshotDomain } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

export function createCanvasSessionWorkspacesDomain(): StorageSnapshotDomain<string[]> {
    return {
        id: 'canvas-session-workspaces',
        collect: () => EMPTY_COLLECT_RESULT,
        restoreReplace() {},
        restoreMerge() {},
        planWipe(ctx) {
            return { plan: listRepoFiles(ctx.dataDir, path.join('canvas-ext', 'session-state')), counts: {}, errors: [] };
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
