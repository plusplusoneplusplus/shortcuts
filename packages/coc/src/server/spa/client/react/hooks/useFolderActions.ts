/**
 * useFolderActions — centralises all folder-level mutation calls
 * (rename, createSubfolder, createTask, archive, unarchive, move, delete)
 * against the existing REST API.
 */

import { getApiBase } from '../utils/config';

export interface FolderActionsResult {
    renameFolder:    (folderPath: string, newName: string) => Promise<void>;
    createSubfolder: (parentPath: string, name: string) => Promise<void>;
    createTask:      (folderPath: string, name: string, docType?: string) => Promise<void>;
    archiveFolder:   (folderPath: string) => Promise<void>;
    unarchiveFolder: (folderPath: string) => Promise<void>;
    moveFolder:      (sourcePath: string, destinationFolder: string) => Promise<void>;
    moveFolderToWorkspace: (sourcePath: string, destinationWorkspaceId: string, destinationFolder: string) => Promise<void>;
    deleteFolder:    (folderPath: string) => Promise<void>;
}

async function apiFetch(method: string, url: string, body: object): Promise<void> {
    const res = await fetch(getApiBase() + url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`${method} ${url} failed (${res.status}): ${text}`);
    }
}

export function useFolderActions(wsId: string): FolderActionsResult {
    const base = `/workspaces/${encodeURIComponent(wsId)}/tasks`;

    return {
        renameFolder: (folderPath, newName) =>
            apiFetch('PATCH', base, { path: folderPath, newName }),

        createSubfolder: (parentPath, name) =>
            apiFetch('POST', base, { type: 'folder', name, parent: parentPath }),

        createTask: (folderPath, name, docType?) => {
            const body: Record<string, string> = { name, folder: folderPath };
            if (docType !== undefined) {
                body.docType = docType;
            }
            return apiFetch('POST', base, body);
        },

        archiveFolder: (folderPath) =>
            apiFetch('POST', `${base}/archive`, { path: folderPath, action: 'archive' }),

        unarchiveFolder: (folderPath) =>
            apiFetch('POST', `${base}/archive`, { path: folderPath, action: 'unarchive' }),

        moveFolder: (sourcePath, destinationFolder) =>
            apiFetch('POST', `${base}/move`, { sourcePath, destinationFolder }),

        moveFolderToWorkspace: (sourcePath, destinationWorkspaceId, destinationFolder) =>
            apiFetch('POST', `${base}/move`, { sourcePath, destinationFolder, destinationWorkspaceId }),

        deleteFolder: (folderPath) =>
            apiFetch('DELETE', base, { path: folderPath }),
    };
}
