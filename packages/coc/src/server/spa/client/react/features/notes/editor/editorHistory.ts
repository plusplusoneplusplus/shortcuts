/**
 * Helpers for managing TipTap / prosemirror-history state on the note editor.
 *
 * The note editor keeps a single TipTap instance mounted across note switches
 * for performance. The default UndoRedo extension records every transaction —
 * including `setContent` — on a shared undo stack. Without resetting that
 * stack when a new note is loaded, Ctrl+Z would walk back across notes and
 * replace the visible note's content with a previously loaded note.
 *
 * This module provides a single helper, `resetEditorHistory`, which rebuilds
 * the editor's `EditorState` from scratch. Plugin state fields are
 * reinitialized via `state.init()`, which gives the history plugin a fresh,
 * empty undo/redo stack while preserving the current document, selection,
 * and stored marks.
 */

import type { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';

/**
 * Clear the editor's undo/redo history without changing the visible document.
 *
 * Safe to call after `setContent` to scope the history to the most recently
 * loaded content.
 */
export function resetEditorHistory(editor: Editor | null | undefined): void {
    if (!editor || editor.isDestroyed) return;
    const view = editor.view;
    if (!view) return;
    const oldState = view.state;
    const newState = EditorState.create({
        doc: oldState.doc,
        plugins: oldState.plugins,
        selection: oldState.selection,
        storedMarks: oldState.storedMarks,
    });
    view.updateState(newState);
}
