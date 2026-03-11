/**
 * Global Workspace bootstrapper.
 *
 * Creates a virtual workspace backed by `~/.coc/global-workspace/`
 * that serves as the default queue for tasks not tied to any repo.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/pipeline-core';

export const GLOBAL_WORKSPACE_ID = 'global-workspace-00';
export const GLOBAL_WORKSPACE_NAME = 'Global';

/**
 * Ensure the global workspace directory exists and is registered in the store.
 * Idempotent — safe to call on every server restart.
 */
export async function ensureGlobalWorkspace(dataDir: string, store: ProcessStore): Promise<WorkspaceInfo> {
    const rootPath = path.join(dataDir, 'global-workspace');
    fs.mkdirSync(rootPath, { recursive: true });
    const ws: WorkspaceInfo = {
        id: GLOBAL_WORKSPACE_ID,
        name: GLOBAL_WORKSPACE_NAME,
        rootPath,
        virtual: true,
    };
    await store.registerWorkspace(ws);
    return ws;
}
