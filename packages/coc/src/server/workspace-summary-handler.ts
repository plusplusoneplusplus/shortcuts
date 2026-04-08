/**
 * Workspace Summary REST API route.
 *
 * Provides a single GET /api/workspaces/:id/summary endpoint that returns
 * both workflows and tasks in one response, replacing the separate
 * GET /workflows and GET /tasks list endpoints.
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore, TaskFolder, TaskDocument } from '@plusplusoneplusplus/forge';
import { getFullTaskHierarchy } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail } from './shared/handler-utils';
import type { Route } from './types';
import { DEFAULT_WORKFLOWS_FOLDER } from './workflow-constants';
import { discoverAndEnrichWorkflows } from './workflow-utils';
import { resolveTaskRoot, resolveAllTaskRoots } from './task-root-resolver';
import { readTasksSettings, buildArchiveFolderNode, mergeTaskFoldersAsVirtualRoot } from './tasks-handler-utils';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively set `taskRootPath` on every folder and document in a TaskFolder tree.
 */
function annotateTaskRootPath(folder: TaskFolder, rootPath: string): void {
    folder.taskRootPath = rootPath;
    for (const doc of folder.singleDocuments) doc.taskRootPath = rootPath;
    for (const group of folder.documentGroups) {
        for (const doc of group.documents) doc.taskRootPath = rootPath;
    }
    const contextDocs: TaskDocument[] = (folder as any).contextDocuments ?? [];
    for (const doc of contextDocs) doc.taskRootPath = rootPath;
    for (const child of folder.children) annotateTaskRootPath(child, rootPath);
}

/**
 * Resolve the full task hierarchy for a workspace, including archive folders
 * and multi-folder merge when additional folder paths are configured.
 */
async function resolveTasksForWorkspace(
    dataDir: string,
    rootPath: string,
    workspaceId: string,
    includeArchiveFolder: boolean,
): Promise<TaskFolder> {
    const taskRootOpts = { dataDir, rootPath, workspaceId };
    const resolvedFolder = resolveTaskRoot(taskRootOpts).absolutePath;

    const tasksSettings = await readTasksSettings(dataDir, workspaceId);
    const additionalPaths = tasksSettings.folderPaths;

    const scanFolder = async (folderPath: string) => {
        const hierarchy = await getFullTaskHierarchy(folderPath);
        annotateTaskRootPath(hierarchy, folderPath);
        if (includeArchiveFolder) {
            const archiveDir = path.join(folderPath, 'archive');
            try {
                const stat = await fs.promises.stat(archiveDir);
                if (stat.isDirectory()) {
                    const archiveNode = await buildArchiveFolderNode(archiveDir);
                    annotateTaskRootPath(archiveNode, folderPath);
                    hierarchy.children = hierarchy.children || [];
                    hierarchy.children.push(archiveNode);
                }
            } catch { /* archive folder doesn't exist — skip */ }
        }
        return hierarchy;
    };

    if (additionalPaths.length > 0) {
        const allRoots = resolveAllTaskRoots(taskRootOpts, additionalPaths);
        const scanned = await Promise.all(
            allRoots.map(async (root) => {
                try {
                    const stat = await fs.promises.stat(root.absolutePath);
                    if (!stat.isDirectory()) return null;
                    const folder = await scanFolder(root.absolutePath);
                    return { folder, label: root.label };
                } catch {
                    return null;
                }
            }),
        );
        const validFolders = scanned.filter((s): s is NonNullable<typeof s> => s !== null);
        if (validFolders.length === 1) {
            return validFolders[0].folder;
        }
        return mergeTaskFoldersAsVirtualRoot(validFolders);
    }

    return scanFolder(resolvedFolder);
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register the workspace summary route.
 */
export function registerWorkspaceSummaryRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/summary$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);
            const includeArchiveFolder = parsed.query.showArchived === 'true';

            try {
                const [workflows, tasks] = await Promise.all([
                    Promise.resolve(discoverAndEnrichWorkflows(pipelinesDir)),
                    resolveTasksForWorkspace(dataDir, ws.rootPath, ws.id, includeArchiveFolder),
                ]);
                sendJSON(res, 200, { workflows, tasks });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to fetch workspace summary: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
