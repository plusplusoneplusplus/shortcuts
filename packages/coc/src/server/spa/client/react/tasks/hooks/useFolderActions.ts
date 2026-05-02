/**
 * useFolderActions — centralises all folder-level mutation calls
 * (rename, createSubfolder, createTask, archive, unarchive, move, delete)
 * against the existing REST API.
 */

import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

export interface FolderActionsResult {
    renameFolder:    (folderPath: string, newName: string) => Promise<void>;
    createSubfolder: (parentPath: string, name: string) => Promise<void>;
    createTask:      (folderPath: string, name: string, docType?: string) => Promise<void>;
    archiveFolder:   (folderPath: string, taskRootPath?: string) => Promise<void>;
    unarchiveFolder: (folderPath: string, taskRootPath?: string) => Promise<void>;
    moveFolder:      (sourcePath: string, destinationFolder: string) => Promise<void>;
    moveFolderToWorkspace: (sourcePath: string, destinationWorkspaceId: string, destinationFolder: string) => Promise<void>;
    deleteFolder:    (folderPath: string, taskRootPath?: string) => Promise<void>;
}

async function runTaskAction(action: Promise<unknown>, label: string): Promise<void> {
    try {
        await action;
    } catch (error) {
        const status = error instanceof CocApiError ? ` (${error.status})` : '';
        throw new Error(`${label} failed${status}: ${getSpaCocClientErrorMessage(error, 'request failed')}`);
    }
}

export interface FolderActionsOptions {
    /** Called after a successful archive (allows the parent to update undo state). */
    onArchived?: () => void;
}

export function useFolderActions(wsId: string, options?: FolderActionsOptions): FolderActionsResult {
    const tasks = getSpaCocClient().tasks;

    return {
        renameFolder: (folderPath, newName) =>
            runTaskAction(tasks.rename(wsId, folderPath, newName), 'Rename folder'),

        createSubfolder: (parentPath, name) =>
            runTaskAction(tasks.create(wsId, { type: 'folder', name, parent: parentPath }), 'Create folder'),

        createTask: (folderPath, name, docType?) => {
            const body: { name: string; folder: string; docType?: string } = { name, folder: folderPath };
            if (docType !== undefined) {
                body.docType = docType;
            }
            return runTaskAction(tasks.create(wsId, body), 'Create task');
        },

        archiveFolder: async (folderPath, taskRootPath?) => {
            await runTaskAction(tasks.archive(wsId, { path: folderPath, action: 'archive', ...(taskRootPath ? { folderPath: taskRootPath } : {}) }), 'Archive folder');
            options?.onArchived?.();
        },

        unarchiveFolder: (folderPath, taskRootPath?) =>
            runTaskAction(tasks.archive(wsId, { path: folderPath, action: 'unarchive', ...(taskRootPath ? { folderPath: taskRootPath } : {}) }), 'Unarchive folder'),

        moveFolder: (sourcePath, destinationFolder) =>
            runTaskAction(tasks.move(wsId, { sourcePath, destinationFolder }), 'Move folder'),

        moveFolderToWorkspace: (sourcePath, destinationWorkspaceId, destinationFolder) =>
            runTaskAction(tasks.move(wsId, { sourcePath, destinationFolder, destinationWorkspaceId }), 'Move folder'),

        deleteFolder: (folderPath, taskRootPath?) =>
            runTaskAction(tasks.delete(wsId, { path: folderPath, ...(taskRootPath ? { folderPath: taskRootPath } : {}) }), 'Delete folder'),
    };
}

