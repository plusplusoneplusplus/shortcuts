/**
 * useChatFolderAssignment — filing rows into (and out of) chat folders from the
 * row context menu (AC-06).
 *
 * Membership is a property of the process, so a move is a write against the
 * process endpoints, not against the folder. The update is optimistic: the
 * process-summary index is patched through `onProcessFoldersChanged` — the same
 * seam AC-05's undo uses — and reconciled by the next summaries fetch.
 */
import { useCallback, useRef } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { resolveMoveTargets } from '../chat-folder-assignment';

export interface UseChatFolderAssignmentOptions {
    /** The workspace the rows belong to; routes the write at its clone's server. */
    workspaceId: string | undefined;
    /** `processId -> folderId` for the rows currently on screen. */
    folderIdByProcess: ReadonlyMap<string, string>;
    /** Patch the process-summary index so the move shows before the refetch. */
    onProcessFoldersChanged?: (processIds: string[], folderId: string | null) => void;
    /** Surfaces failures; the list itself never blanks on an error. */
    onError?: (message: string) => void;
}

export interface UseChatFolderAssignmentResult {
    /**
     * File every id into `folderId`, or unfile them all with `null`.
     * Rows already in the target are skipped, and an empty result issues no request.
     */
    moveToFolder: (ids: readonly string[], folderId: string | null) => Promise<void>;
}

/**
 * The processes API of the CoC server that owns `workspaceId`. Filing is a write
 * against process ids that only exist on that clone's server, so it must follow
 * the clone rather than the page origin.
 */
function processesApi(workspaceId: string | undefined): any {
    const client = getCocClientForWorkspace(workspaceId) as any;
    return client?.processes;
}

export function useChatFolderAssignment(
    options: UseChatFolderAssignmentOptions,
): UseChatFolderAssignmentResult {
    const { workspaceId, folderIdByProcess, onProcessFoldersChanged, onError } = options;
    // Read membership at click time, not render time — a background refresh
    // between opening the menu and picking a folder must not stale the diff.
    const folderIdByProcessRef = useRef(folderIdByProcess);
    folderIdByProcessRef.current = folderIdByProcess;

    const moveToFolder = useCallback(async (ids: readonly string[], folderId: string | null): Promise<void> => {
        const before = folderIdByProcessRef.current;
        const targets = resolveMoveTargets(ids, before, folderId);
        if (targets.length === 0) {return;}
        const api = processesApi(workspaceId);
        // Snapshot the prior placement so a failed write can be rolled back
        // row by row rather than left showing a move that never landed.
        const previous = targets.map(id => ({ id, folderId: before.get(id) ?? null }));

        onProcessFoldersChanged?.(targets, folderId);
        try {
            if (targets.length === 1 && typeof api?.setProcessFolder === 'function') {
                await api.setProcessFolder(targets[0], folderId);
            } else if (typeof api?.setProcessFolderBatch === 'function') {
                await api.setProcessFolderBatch(targets, folderId);
            } else {
                return;
            }
        } catch {
            for (const entry of previous) {
                onProcessFoldersChanged?.([entry.id], entry.folderId);
            }
            onError?.(folderId === null ? 'Could not remove from folder' : 'Could not move to folder');
        }
    }, [workspaceId, onProcessFoldersChanged, onError]);

    return { moveToFolder };
}
