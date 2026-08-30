import { useState, useEffect, useCallback } from 'react';
import type { Editor } from '@tiptap/react';

/** Shape of `editor.storage.findAndReplace`, as far as the panel needs it. */
export interface FindAndReplaceState {
    searchTerm: string;
    caseSensitive: boolean;
    useRegex: boolean;
    wholeWord: boolean;
    results: { from: number; to: number }[];
    currentIndex: number | null;
}

export const EMPTY_FIND_STATE: FindAndReplaceState = {
    searchTerm: '',
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
    results: [],
    currentIndex: null,
};

/**
 * Read the find-and-replace extension state off the editor. Re-reading on every
 * transaction is what keeps the match counter live; that re-render comes from
 * `useEditorTransactionTick`, subscribed once by `NoteEditorToolbar` for the
 * whole toolbar.
 *
 * Tolerates an editor without the extension by falling back to empty state.
 */
export function useFindAndReplaceState(editor: Editor): FindAndReplaceState {
    const state = (editor.storage as { findAndReplace?: FindAndReplaceState } | undefined)
        ?.findAndReplace;
    return state ?? EMPTY_FIND_STATE;
}

/** Current selection as plain text, or '' when the selection is empty/unavailable. */
export function getSelectedText(editor: Editor): string {
    const selection = editor.state?.selection;
    if (!selection || selection.empty) return '';
    const text = editor.state.doc.textBetween(selection.from, selection.to, ' ');
    // Multi-line selections are almost never a search term.
    return text.includes('\n') ? '' : text;
}

export interface FindReplaceToolbarController {
    /** Whether the secondary find/replace row is showing. */
    open: boolean;
    /** Open the panel. */
    openFind: () => void;
    /** Close the panel and drop the search, so no stale highlights survive. */
    closeFind: () => void;
    /** Open when closed, close (and clear) when open. */
    toggleFind: () => void;
}

/**
 * Owns whether the find/replace row is showing, and keeps that in step with the
 * editor's search state.
 *
 * Two invariants live here rather than in the panel:
 *  - closing always clears the search term, so a stale set of match outlines
 *    cannot survive on the document with no visible way to dismiss them;
 *  - source mode (`hidden`) force-closes, because it swaps in a separate
 *    raw-markdown editor the extension does not reach — leaving the panel
 *    floating over a document it can no longer search reads as broken.
 */
export function useFindReplaceToolbarController(
    editor: Editor | null,
    hidden?: boolean,
): FindReplaceToolbarController {
    const [open, setOpen] = useState(false);

    const closeFind = useCallback(() => {
        setOpen(false);
        editor?.commands?.clearSearch?.();
    }, [editor]);

    const openFind = useCallback(() => setOpen(true), []);

    const toggleFind = useCallback(() => {
        // Reads `open` through the setter so the callback stays stable.
        setOpen((wasOpen) => {
            if (wasOpen) editor?.commands?.clearSearch?.();
            return !wasOpen;
        });
    }, [editor]);

    useEffect(() => {
        if (hidden) closeFind();
    }, [hidden, closeFind]);

    return { open, openFind, closeFind, toggleFind };
}
