/**
 * useFileActions — centralises all file-level mutation calls
 * (rename, archive, unarchive, delete, move)
 * against the existing REST API.
 */

import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

export interface FileActionsResult {
    renameFile:    (filePath: string, newName: string) => Promise<void>;
    archiveFile:   (filePath: string, taskRootPath?: string) => Promise<void>;
    unarchiveFile: (filePath: string, taskRootPath?: string) => Promise<void>;
    deleteFile:    (filePath: string, taskRootPath?: string) => Promise<void>;
    moveFile:      (sourcePath: string, destinationFolder: string) => Promise<void>;
    moveFileToWorkspace: (sourcePath: string, destinationWorkspaceId: string, destinationFolder: string) => Promise<void>;
    updateStatus:  (filePath: string, status: string) => Promise<void>;
}

async function runTaskAction(action: Promise<unknown>, label: string): Promise<void> {
    try {
        await action;
    } catch (error) {
        const status = error instanceof CocApiError ? ` (${error.status})` : '';
        throw new Error(`${label} failed${status}: ${getSpaCocClientErrorMessage(error, 'request failed')}`);
    }
}

export interface FileActionsOptions {
    /** Called after a successful archive (allows the parent to update undo state). */
    onArchived?: () => void;
}

export function useFileActions(wsId: string, options?: FileActionsOptions): FileActionsResult {
    const tasks = getSpaCocClient().tasks;

    return {
        renameFile: (filePath, newName) =>
            runTaskAction(tasks.rename(wsId, filePath, newName), 'Rename file'),

        archiveFile: async (filePath, taskRootPath?) => {
            await runTaskAction(tasks.archive(wsId, { path: filePath, action: 'archive', ...(taskRootPath ? { folderPath: taskRootPath } : {}) }), 'Archive file');
            options?.onArchived?.();
        },

        unarchiveFile: (filePath, taskRootPath?) =>
            runTaskAction(tasks.archive(wsId, { path: filePath, action: 'unarchive', ...(taskRootPath ? { folderPath: taskRootPath } : {}) }), 'Unarchive file'),

        deleteFile: (filePath, taskRootPath?) =>
            runTaskAction(tasks.delete(wsId, { path: filePath, ...(taskRootPath ? { folderPath: taskRootPath } : {}) }), 'Delete file'),

        moveFile: (sourcePath, destinationFolder) =>
            runTaskAction(tasks.move(wsId, { sourcePath, destinationFolder }), 'Move file'),

        moveFileToWorkspace: (sourcePath, destinationWorkspaceId, destinationFolder) =>
            runTaskAction(tasks.move(wsId, { sourcePath, destinationFolder, destinationWorkspaceId }), 'Move file'),

        updateStatus: (filePath, status) =>
            runTaskAction(tasks.updateStatus(wsId, filePath, status), 'Update status'),
    };
}

