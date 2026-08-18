/**
 * useCommitListDragController — keeps the two drag systems on a commit row apart.
 *
 * A row can start two different native drags:
 *  - **reorder** — from the ⠿ handle, moves an unpushed commit within the list.
 *  - **session context** — from the row body, attaches the commit (or the whole
 *    multi-selection) to an AI session as context.
 *
 * They are exposed as separate, explicitly named prop bundles so a row can
 * never accidentally write a context payload during a reorder drag, and so
 * reorder drops outside the unpushed range are rejected in one place.
 */

import { useState, useCallback } from 'react';
import {
    createGitCommitContextDragPayload,
    type GitCommitContextDragPayload,
    writePointerContextDragData,
    writeSessionContextDragBundle,
} from '../../chat/sessionContextDrag';
import type { GitCommitItem } from './commitListTypes';

/** Reorder drag props applied to the row wrapper (drop target side). */
export interface CommitReorderDropProps {
    onDragOver?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    onDragEnd?: () => void;
}

export interface CommitListDragController {
    dragIndex: number | null;
    dragOverIndex: number | null;
    /** Payload for the row's session-context drag, or null when disabled. */
    buildContextPayload: (commit: GitCommitItem) => GitCommitContextDragPayload | null;
    handleCommitContextDragStart: (e: React.DragEvent, sessionContextPayload: GitCommitContextDragPayload) => void;
    handleReorderDragStart: (e: React.DragEvent, index: number) => void;
    getReorderDropProps: (index: number, canDrag: boolean) => CommitReorderDropProps;
}

export function useCommitListDragController(options: {
    commits: GitCommitItem[];
    selectedHashes?: ReadonlySet<string>;
    workspaceId?: string;
    unpushedCount: number;
    sessionContextDragEnabled: boolean;
    onReorder?: (newOrder: GitCommitItem[]) => void;
}): CommitListDragController {
    const { commits, selectedHashes, workspaceId, unpushedCount, sessionContextDragEnabled, onReorder } = options;

    // Drag-and-drop reorder state
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    const buildContextPayload = useCallback((commit: GitCommitItem): GitCommitContextDragPayload | null => {
        if (!(sessionContextDragEnabled && workspaceId)) return null;
        return createGitCommitContextDragPayload(commit, { activeWorkspaceId: workspaceId });
    }, [sessionContextDragEnabled, workspaceId]);

    // --- Session-context drag -------------------------------------------------

    const handleCommitContextDragStart = useCallback((e: React.DragEvent, sessionContextPayload: GitCommitContextDragPayload) => {
        e.stopPropagation();
        const draggedHash = sessionContextPayload.commitHash;
        // Bundle the whole selection only when the dragged commit is part of an
        // active multi-selection (AC-02); an unselected commit carries just
        // itself. The dragged item stays first so singular readers see it.
        if (selectedHashes && selectedHashes.size > 1 && selectedHashes.has(draggedHash)) {
            const selectedPayloads = commits
                .filter(c => c.hash !== draggedHash && selectedHashes.has(c.hash))
                .map(c => createGitCommitContextDragPayload(c, { activeWorkspaceId: workspaceId }))
                .filter((p): p is GitCommitContextDragPayload => p !== null);
            writeSessionContextDragBundle(e.dataTransfer, [sessionContextPayload, ...selectedPayloads]);
            return;
        }
        writePointerContextDragData(e.dataTransfer, sessionContextPayload);
    }, [selectedHashes, commits, workspaceId]);

    // --- Reorder drag ---------------------------------------------------------

    const handleReorderDragStart = useCallback((e: React.DragEvent, index: number) => {
        e.stopPropagation();
        setDragIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
        // dragIndex is only set by handleReorderDragStart, so a session-context
        // drag passing over the list never turns into a reorder preview.
        if (dragIndex === null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIndex(index);
    }, [dragIndex]);

    const handleDragEnd = useCallback(() => {
        setDragIndex(null);
        setDragOverIndex(null);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, dropIndex: number) => {
        e.preventDefault();
        if (dragIndex === null || dragIndex === dropIndex) {
            setDragIndex(null);
            setDragOverIndex(null);
            return;
        }
        // Only reorder within unpushed commits
        if (dragIndex >= unpushedCount || dropIndex >= unpushedCount) {
            setDragIndex(null);
            setDragOverIndex(null);
            return;
        }
        const newCommits = [...commits];
        const [moved] = newCommits.splice(dragIndex, 1);
        newCommits.splice(dropIndex, 0, moved);
        onReorder?.(newCommits);
        setDragIndex(null);
        setDragOverIndex(null);
    }, [dragIndex, commits, unpushedCount, onReorder]);

    const getReorderDropProps = useCallback((index: number, canDrag: boolean): CommitReorderDropProps => {
        if (!canDrag) return {};
        return {
            onDragOver: (e: React.DragEvent) => handleDragOver(e, index),
            onDrop: (e: React.DragEvent) => handleDrop(e, index),
            onDragEnd: handleDragEnd,
        };
    }, [handleDragOver, handleDrop, handleDragEnd]);

    return {
        dragIndex,
        dragOverIndex,
        buildContextPayload,
        handleCommitContextDragStart,
        handleReorderDragStart,
        getReorderDropProps,
    };
}
