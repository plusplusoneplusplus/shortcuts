import { removeManagedPath } from '../../canvas-extensions/generated-packages';
import { listSessionWorkspaceOwners } from '../../canvas-extensions/session-workspace';
import { CanvasStore } from '../../canvas/canvas-store';
import * as path from 'node:path';
import { EMPTY_COLLECT_RESULT, type StorageSnapshotDomain } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

/** Raw retirement filtering only. Snapshot imports never reconstruct executable canvas records. */
function reportDroppedRuntimeRecords(payload: unknown, result: { droppedCanvasRecords?: number }): void {
    const records = (payload as { canvases?: unknown })?.canvases;
    if (!Array.isArray(records)) return;
    const count = records.filter(record => record && typeof record === 'object'
        && (record.type === 'extension' || record.type === 'copilot-extension')).length;
    if (count) result.droppedCanvasRecords = (result.droppedCanvasRecords ?? 0) + count;
}

export function createCanvasSessionWorkspacesDomain(): StorageSnapshotDomain<string[]> {
    return {
        id: 'canvas-session-workspaces',
        async collect(ctx) {
            const canvasStore = new CanvasStore(ctx.dataDir);
            let omitted = 0;
            const workspaceIds = new Set((await ctx.store.getWorkspaces()).map(workspace => workspace.id));
            for (const owner of await listSessionWorkspaceOwners(ctx.dataDir)) workspaceIds.add(owner.workspaceId);
            for (const workspaceId of workspaceIds) {
                omitted += canvasStore.listCanvases(workspaceId).filter(canvas => canvas.type === 'copilot-extension').length;
            }
            return { ...EMPTY_COLLECT_RESULT, warnings: omitted ? [
                `Omitted ${omitted} machine-local extension canvas records; generated source and application state are not exported.`,
            ] : [] };
        },
        restoreReplace(payload, _ctx, result) { reportDroppedRuntimeRecords(payload, result); },
        restoreMerge(payload, _ctx, result) { reportDroppedRuntimeRecords(payload, result); },
        planWipe(ctx) {
            return { plan: [...listRepoFiles(ctx.dataDir, path.join('canvas-ext', 'session-state')), ...listRepoFiles(ctx.dataDir, path.join('canvas-ext', 'generated'))], counts: {}, errors: [] };
        },
        executeWipe(ctx, directories, result) {
            for (const directory of directories ?? []) {
                try {
                    removeManagedPath(ctx.dataDir, directory);
                } catch (error) {
                    result.errors.push(`Failed to delete ${directory}: ${getErrorMessage(error)}`);
                }
            }
        },
    };
}
