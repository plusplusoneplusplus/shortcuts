/**
 * NoteEditCard — compact card shown in chat bubbles for AI note edits.
 *
 * Provides "Show/Hide changes" toggle (fires custom events to the NoteEditor)
 * and an "Undo" button (calls the REST endpoint to revert).
 */

import React, { useState, useCallback } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../../api/cocClient';

export interface NoteEditCardProps {
    editId: string;
    processId: string;
    wsId: string;
    notePath: string;
    noteTitle?: string;
    preEditContent: string;
    postEditContent: string;
    turnIndex: number;
    tooLarge?: boolean;
}

export function NoteEditCard({
    editId,
    processId,
    wsId,
    notePath,
    noteTitle,
    preEditContent,
    postEditContent,
    tooLarge,
}: NoteEditCardProps) {
    const [changesVisible, setChangesVisible] = useState(false);
    const [undoState, setUndoState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
    const label = noteTitle ?? notePath.split('/').pop() ?? 'note';

    const handleToggleChanges = useCallback(() => {
        if (!changesVisible) {
            window.dispatchEvent(
                new CustomEvent('note-edit-show', {
                    detail: { editId, wsId, notePath, preEditContent, postEditContent },
                }),
            );
        } else {
            window.dispatchEvent(
                new CustomEvent('note-edit-hide', { detail: { editId, wsId } }),
            );
        }
        setChangesVisible((v) => !v);
    }, [changesVisible, editId, wsId, notePath, preEditContent, postEditContent]);

    const handleUndo = useCallback(async () => {
        setUndoState('loading');
        try {
            try {
                await getSpaCocClient().notes.undoNoteEdit(processId, editId);
            } catch (error) {
                if (!(error instanceof CocApiError && error.status === 409)) throw error;
                const confirmed = window.confirm(
                    'The note was modified after this AI edit. Undo anyway?',
                );
                if (!confirmed) {
                    setUndoState('idle');
                    return;
                }
                await getSpaCocClient().notes.undoNoteEdit(processId, editId, { force: true });
            }

            setUndoState('done');
            setChangesVisible(false);
        } catch {
            setUndoState('error');
            setTimeout(() => setUndoState('idle'), 3000);
        }
    }, [processId, editId]);

    return (
        <div
            className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg border border-green-200 dark:border-green-900 bg-green-50 dark:bg-[#1b3a1b] text-xs"
            data-testid="note-edit-card"
        >
            <span className="text-green-600 dark:text-green-400 font-semibold">✦</span>
            <span className="flex-1 text-[#333] dark:text-[#ccc] truncate">
                Edited: <span className="font-medium">{label}</span>
            </span>
            {!tooLarge && (
                <button
                    onClick={handleToggleChanges}
                    className="px-2 py-0.5 rounded bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#333] dark:text-[#ccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2d2d2d]"
                    data-testid="note-edit-toggle-changes"
                >
                    {changesVisible ? 'Hide changes' : 'Show changes'}
                </button>
            )}
            <button
                onClick={handleUndo}
                disabled={undoState !== 'idle' || tooLarge}
                className="px-2 py-0.5 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#888] hover:text-[#333] dark:hover:text-white disabled:opacity-50"
                title={tooLarge ? 'Content too large to undo' : 'Undo AI edit'}
                data-testid="note-edit-undo"
            >
                {undoState === 'loading'
                    ? '…'
                    : undoState === 'done'
                      ? '✓'
                      : undoState === 'error'
                        ? '✗'
                        : '↩ Undo'}
            </button>
        </div>
    );
}
