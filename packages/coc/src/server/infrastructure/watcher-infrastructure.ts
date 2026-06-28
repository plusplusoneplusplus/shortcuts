/**
 * Watcher Infrastructure Builder
 *
 * Creates TaskWatcher, WorkflowWatcher, and TemplateWatcher instances,
 * bootstraps them for already-registered workspaces (server restart scenario),
 * and monkey-patches store.registerWorkspace / store.removeWorkspace so watchers
 * stay in sync as workspaces are added or removed at runtime.
 *
 * Extracted from createExecutionServer to keep index.ts focused on composition.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { TaskWatcher } from '../tasks/task-watcher';
import { WorkflowWatcher } from '../workflows/workflow-watcher';
import { TemplateWatcher } from '../templates/template-watcher';
import { NotesWatcher } from '../notes/notes-watcher';
import { resolveTaskRoot } from '../tasks/task-root-resolver';
import { isMigrationNeeded, migrateTasksToRepoScoped } from '../tasks/task-migration';
import { taskCache } from '../tasks/task-cache';
import { getRepoDataPath } from '../paths';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';

// ============================================================================
// Types
// ============================================================================

export interface WatcherInfrastructure {
    taskWatcher: TaskWatcher;
    pipelineWatcher: WorkflowWatcher;
    templateWatcher: TemplateWatcher;
    notesWatcher: NotesWatcher;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Creates all three file watchers, bootstraps them for pre-existing workspaces,
 * and wires store registration/removal hooks so watchers track workspace changes.
 *
 * @param store     - Process store (for workspace enumeration and hook interception).
 * @param dataDir   - Root data directory used to resolve per-repo task roots.
 * @param wsServer  - WebSocket server that receives file-change broadcasts.
 * @param bridge    - Multi-repo bridge for registering repo IDs on workspace add.
 * @returns The three watcher instances for use during server shutdown.
 */
export async function createWatcherInfrastructure(
    store: ProcessStore,
    dataDir: string,
    wsServer: ProcessWebSocketServer,
    bridge: MultiRepoQueueRouter,
): Promise<WatcherInfrastructure> {
    const taskWatcher = new TaskWatcher((workspaceId) => {
        taskCache.invalidateWorkspace(workspaceId);
        wsServer.broadcastProcessEvent({ type: 'tasks-changed', workspaceId, timestamp: Date.now() });
    });
    const pipelineWatcher = new WorkflowWatcher((workspaceId) => {
        wsServer.broadcastProcessEvent({ type: 'workflows-changed', workspaceId, timestamp: Date.now() });
    });
    const templateWatcher = new TemplateWatcher((workspaceId) => {
        wsServer.broadcastProcessEvent({ type: 'templates-changed', workspaceId, timestamp: Date.now() });
    });
    const notesWatcher = new NotesWatcher((workspaceId, changedPaths) => {
        wsServer.broadcastProcessEvent({ type: 'notes-changed', workspaceId, changedPaths, timestamp: Date.now() });
    });

    // Bootstrap watchers for workspaces that already exist (server restart scenario)
    const existingWorkspaces = await store.getWorkspaces();
    for (const ws of existingWorkspaces) {
        if (isMigrationNeeded(ws.rootPath, ws.id, dataDir)) {
            const result = await migrateTasksToRepoScoped({ workspaceRoot: ws.rootPath, workspaceId: ws.id, dataDir });
            if (result.migrated) {
                process.stderr.write(`[TaskMigration] ${result.fileCount} files: ${ws.rootPath}\n`);
            }
        }
        taskWatcher.watchWorkspace(ws.id, resolveTaskRoot({ dataDir, rootPath: ws.rootPath, workspaceId: ws.id }).absolutePath);
        pipelineWatcher.watchWorkspace(ws.id, ws.rootPath);
        templateWatcher.watchWorkspace(ws.id, ws.rootPath);
        notesWatcher.watchWorkspace(ws.id, getRepoDataPath(dataDir, ws.id, 'notes'));
        bridge.registerRepoId(ws.id, ws.rootPath);
    }

    // Intercept store workspace registration/removal to keep watchers in sync
    const originalRegister = store.registerWorkspace!.bind(store);
    const originalRemove = store.removeWorkspace!.bind(store);

    store.registerWorkspace = async (workspace) => {
        await originalRegister(workspace);
        if (isMigrationNeeded(workspace.rootPath, workspace.id, dataDir)) {
            const result = await migrateTasksToRepoScoped({ workspaceRoot: workspace.rootPath, workspaceId: workspace.id, dataDir });
            if (result.migrated) {
                process.stderr.write(`[TaskMigration] ${result.fileCount} files: ${workspace.rootPath}\n`);
            }
        }
        taskWatcher.watchWorkspace(workspace.id, resolveTaskRoot({ dataDir, rootPath: workspace.rootPath, workspaceId: workspace.id }).absolutePath);
        pipelineWatcher.watchWorkspace(workspace.id, workspace.rootPath);
        templateWatcher.watchWorkspace(workspace.id, workspace.rootPath);
        notesWatcher.watchWorkspace(workspace.id, getRepoDataPath(dataDir, workspace.id, 'notes'));
        bridge.registerRepoId(workspace.id, workspace.rootPath);
    };

    store.removeWorkspace = async (id) => {
        taskWatcher.unwatchWorkspace(id);
        pipelineWatcher.unwatchWorkspace(id);
        templateWatcher.unwatchWorkspace(id);
        notesWatcher.unwatchWorkspace(id);
        return originalRemove(id);
    };

    return { taskWatcher, pipelineWatcher, templateWatcher, notesWatcher };
}
