/**
 * useFileActions — centralises all file-level mutation calls
 * (rename, archive, unarchive, delete, move)
 * against the existing REST API.
 */

import { getApiBase } from '../utils/config';

export interface FileActionsResult {
    renameFile:    (filePath: string, newName: string) => Promise<void>;
    archiveFile:   (filePath: string) => Promise<void>;
    unarchiveFile: (filePath: string) => Promise<void>;
    deleteFile:    (filePath: string) => Promise<void>;
    moveFile:      (sourcePath: string, destinationFolder: string) => Promise<void>;
    moveFileToWorkspace: (sourcePath: string, destinationWorkspaceId: string, destinationFolder: string) => Promise<void>;
    updateStatus:  (filePath: string, status: string) => Promise<void>;
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

export interface FileActionsOptions {
    /** Called after a successful archive (allows the parent to update undo state). */
    onArchived?: () => void;
}

export function useFileActions(wsId: string, options?: FileActionsOptions): FileActionsResult {
    const base = `/workspaces/${encodeURIComponent(wsId)}/tasks`;

    return {
        renameFile: (filePath, newName) =>
            apiFetch('PATCH', base, { path: filePath, newName }),

        archiveFile: async (filePath) => {
            await apiFetch('POST', `${base}/archive`, { path: filePath, action: 'archive' });
            options?.onArchived?.();
        },

        unarchiveFile: (filePath) =>
            apiFetch('POST', `${base}/archive`, { path: filePath, action: 'unarchive' }),

        deleteFile: (filePath) =>
            apiFetch('DELETE', base, { path: filePath }),

        moveFile: (sourcePath, destinationFolder) =>
            apiFetch('POST', `${base}/move`, { sourcePath, destinationFolder }),

        moveFileToWorkspace: (sourcePath, destinationWorkspaceId, destinationFolder) =>
            apiFetch('POST', `${base}/move`, { sourcePath, destinationFolder, destinationWorkspaceId }),

        updateStatus: (filePath, status) =>
            apiFetch('PATCH', base, { path: filePath, status }),
    };
}

