/**
 * Tests for resetEditorHistory — the helper that gives every loaded note
 * its own per-note undo/redo stack on the shared TipTap instance.
 *
 * Uses a real Tiptap editor (not mocked) so the prosemirror-history plugin
 * actually runs and we can observe undo behavior end to end.
 */

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { undoDepth, redoDepth } from '@tiptap/pm/history';

import { resetEditorHistory } from '../../../../src/server/spa/client/react/features/notes/editor/editorHistory';

function makeEditor(initial = '<p></p>') {
    return new Editor({
        extensions: [StarterKit],
        content: initial,
    });
}

describe('resetEditorHistory', () => {
    it('clears the undo stack while preserving the current document', () => {
        const editor = makeEditor('<p>start</p>');

        // Make some edits so the undo stack is populated.
        editor.commands.setContent('<p>note A loaded</p>');
        editor.commands.insertContent(' edit-1');

        expect(undoDepth(editor.state)).toBeGreaterThan(0);
        const beforeReset = editor.getHTML();

        resetEditorHistory(editor);

        expect(undoDepth(editor.state)).toBe(0);
        expect(redoDepth(editor.state)).toBe(0);
        expect(editor.getHTML()).toBe(beforeReset);

        editor.destroy();
    });

    it('Ctrl+Z after switching notes does NOT bring back the previous note (regression)', () => {
        const editor = makeEditor('<p></p>');

        // Simulate loading note A and the user editing it.
        editor.commands.setContent('<p>content of note A</p>');
        editor.commands.insertContent(' edited in A');
        // Sanity: undo would currently take us back through note A's history.
        expect(undoDepth(editor.state)).toBeGreaterThan(0);

        // Simulate switching to note B (mirrors NoteEditor.tsx load flow).
        editor.commands.setContent('<p>content of note B</p>');
        resetEditorHistory(editor);
        const afterSwitch = editor.getHTML();

        // The user types something in note B.
        editor.commands.focus();
        editor.commands.insertContent(' typed in B');
        const beforeUndo = editor.getHTML();
        expect(beforeUndo).toContain('typed in B');

        // Press undo: should only undo the last edit in note B, never reach note A.
        editor.commands.undo();
        const afterOneUndo = editor.getHTML();
        expect(afterOneUndo).toBe(afterSwitch);
        expect(afterOneUndo).not.toContain('note A');
        expect(afterOneUndo).not.toContain('typed in B');

        // Pressing undo again should be a no-op — note A's history is gone.
        editor.commands.undo();
        expect(editor.getHTML()).toBe(afterSwitch);
        expect(editor.getHTML()).not.toContain('note A');

        editor.destroy();
    });

    it('preserves undo for edits made AFTER a reset', () => {
        const editor = makeEditor('<p></p>');

        editor.commands.setContent('<p>note B</p>');
        resetEditorHistory(editor);
        const baseline = editor.getHTML();

        editor.commands.focus();
        editor.commands.insertContent(' first edit');
        editor.commands.insertContent(' second edit');

        expect(editor.getHTML()).toContain('first edit');
        expect(editor.getHTML()).toContain('second edit');
        expect(undoDepth(editor.state)).toBeGreaterThan(0);

        // Walk the undo stack all the way back to the post-reset baseline.
        while (undoDepth(editor.state) > 0) {
            editor.commands.undo();
        }
        expect(editor.getHTML()).toBe(baseline);

        editor.destroy();
    });

    it('handles a null or destroyed editor without throwing', () => {
        expect(() => resetEditorHistory(null)).not.toThrow();
        expect(() => resetEditorHistory(undefined)).not.toThrow();

        const editor = makeEditor('<p>x</p>');
        editor.destroy();
        expect(() => resetEditorHistory(editor)).not.toThrow();
    });
});
