/**
 * sidenoteRefPlacement — notes-quick-ask, AC-03 wiring (embed an answered
 * side-note into the live TipTap doc as a `[^qa-<id>]` footnote marker) with the
 * AC-05 pending-drop falling out of the same re-anchor.
 *
 * These tests drive a REAL Tiptap editor (StarterKit + SidenoteRefExtension) so
 * the insert → getHTML → htmlToMarkdown path is exercised end-to-end, the same
 * way sidenoteFootnote.test.ts validates the serialization triple.
 */

import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { SidenoteRefExtension }
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/sidenoteRefExtension';
import {
    deleteSidenoteRef,
    insertSidenoteRef,
    resolveSidenoteInsertPos,
} from '../../../../src/server/spa/client/react/features/notes/editor/extensions/sidenoteRefPlacement';
import { htmlToMarkdown }
    from '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown';

function makeEditor(html: string): Editor {
    return new Editor({
        extensions: [
            StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: false }),
            SidenoteRefExtension,
        ],
        content: html,
    });
}

const SENTENCE = '<p>we optimize the loss with gradient descent over many epochs</p>';
const ANCHOR = {
    selectedText: 'gradient descent',
    contextBefore: 'we optimize the loss with ',
    contextAfter: ' over many epochs',
};

describe('resolveSidenoteInsertPos', () => {
    it('resolves to the position just after the anchored phrase', () => {
        const editor = makeEditor(SENTENCE);
        try {
            const pos = resolveSidenoteInsertPos(editor.state.doc, ANCHOR);
            expect(pos).not.toBeNull();
            // The phrase ends right before ' over many epochs'; the text right
            // after `pos` must be the suffix, i.e. the marker sits after the phrase.
            expect(editor.state.doc.textBetween(pos!, pos! + 5, '')).toBe(' over');
        } finally {
            editor.destroy();
        }
    });

    it('returns null when the phrase is absent (deleted → pending drop)', () => {
        const editor = makeEditor('<p>a totally different note body</p>');
        try {
            expect(resolveSidenoteInsertPos(editor.state.doc, ANCHOR)).toBeNull();
        } finally {
            editor.destroy();
        }
    });

    it('returns null for an empty anchor phrase', () => {
        const editor = makeEditor(SENTENCE);
        try {
            expect(resolveSidenoteInsertPos(editor.state.doc, { selectedText: '' })).toBeNull();
        } finally {
            editor.destroy();
        }
    });
});

describe('insertSidenoteRef', () => {
    it('embeds a marker at the phrase that serializes to footnote form', () => {
        const editor = makeEditor(SENTENCE);
        try {
            const inserted = insertSidenoteRef(editor, ANCHOR, {
                refId: 'note1',
                question: 'what is this?',
                answer: 'Iterative first-order optimization.',
            });
            expect(inserted).toBe(true);

            const html = editor.getHTML();
            expect(html).toContain('class="qa-sidenote-ref"');
            expect(html).toContain('data-qa-id="note1"');
            expect(html).toContain('data-qa-answer="Iterative first-order optimization."');

            // The persisted markdown carries the trailing marker at the phrase and
            // the answer in a definition block at the file bottom.
            expect(htmlToMarkdown(html)).toBe(
                'we optimize the loss with gradient descent[^qa-note1] over many epochs\n\n'
                + '[^qa-note1]: {"q":"what is this?","a":"Iterative first-order optimization."}\n',
            );
        } finally {
            editor.destroy();
        }
    });

    it('omits the question from the definition for a default (empty) ask', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, { refId: 'd1', answer: 'A.' });
            expect(htmlToMarkdown(editor.getHTML())).toBe(
                'we optimize the loss with gradient descent[^qa-d1] over many epochs\n\n'
                + '[^qa-d1]: {"a":"A."}\n',
            );
        } finally {
            editor.destroy();
        }
    });

    it('does not insert and returns false when the phrase is gone (AC-05 pending drop)', () => {
        const editor = makeEditor('<p>the phrase was deleted mid-generation</p>');
        try {
            const before = editor.getHTML();
            const inserted = insertSidenoteRef(editor, ANCHOR, { refId: 'x', answer: 'orphan' });
            expect(inserted).toBe(false);
            expect(editor.getHTML()).toBe(before);
            expect(editor.getHTML()).not.toContain('qa-sidenote-ref');
            // No marker → the save pipeline emits no dangling definition either.
            expect(htmlToMarkdown(editor.getHTML())).not.toContain('[^qa-');
        } finally {
            editor.destroy();
        }
    });

    it('re-anchors against the CURRENT doc so text typed before the phrase does not misplace the marker', () => {
        // Simulates the non-blocking case: the user prepended a sentence while the
        // answer was in flight. The marker must still land after the phrase.
        const editor = makeEditor(
            '<p>A brand new opening sentence. we optimize the loss with gradient descent over many epochs</p>',
        );
        try {
            expect(insertSidenoteRef(editor, ANCHOR, { refId: 'g1', answer: 'grounded' })).toBe(true);
            expect(htmlToMarkdown(editor.getHTML())).toBe(
                'A brand new opening sentence. we optimize the loss with gradient descent[^qa-g1] over many epochs\n\n'
                + '[^qa-g1]: {"a":"grounded"}\n',
            );
        } finally {
            editor.destroy();
        }
    });

    it('disambiguates repeated phrases by surrounding context', () => {
        const editor = makeEditor('<p>alpha token beta and gamma token delta</p>');
        try {
            insertSidenoteRef(
                editor,
                { selectedText: 'token', contextBefore: 'gamma ', contextAfter: ' delta' },
                { refId: 't2', answer: 'second one' },
            );
            // Marker lands after the SECOND "token" (the gamma…delta context), not the first.
            expect(htmlToMarkdown(editor.getHTML())).toBe(
                'alpha token beta and gamma token[^qa-t2] delta\n\n[^qa-t2]: {"a":"second one"}\n',
            );
        } finally {
            editor.destroy();
        }
    });

    it('is a no-op for a null or destroyed editor', () => {
        expect(insertSidenoteRef(null, ANCHOR, { refId: 'n', answer: 'x' })).toBe(false);
        const editor = makeEditor(SENTENCE);
        editor.destroy();
        expect(insertSidenoteRef(editor, ANCHOR, { refId: 'n', answer: 'x' })).toBe(false);
    });
});

describe('deleteSidenoteRef (AC-04 chip delete)', () => {
    it('removes the marker so both the marker and its bottom definition vanish on save', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, { refId: 'del1', answer: 'to be deleted' });
            // Sanity: the marker + definition are present before deletion.
            expect(htmlToMarkdown(editor.getHTML())).toContain('[^qa-del1]');

            const removed = deleteSidenoteRef(editor, 'del1');
            expect(removed).toBe(true);

            // Marker gone from the doc, and since the definition block is rebuilt
            // from markers on save, the definition is gone too — back to plain md.
            expect(editor.getHTML()).not.toContain('qa-sidenote-ref');
            const md = htmlToMarkdown(editor.getHTML());
            expect(md).toContain('we optimize the loss with gradient descent over many epochs');
            expect(md).not.toContain('[^qa-');
            expect(md).not.toContain('to be deleted');
        } finally {
            editor.destroy();
        }
    });

    it('deletes only the marker with the matching id, leaving siblings intact', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, { refId: 'keep', answer: 'first' });
            insertSidenoteRef(
                editor,
                { selectedText: 'loss', contextBefore: 'the ', contextAfter: ' with' },
                { refId: 'drop', answer: 'second' },
            );

            expect(deleteSidenoteRef(editor, 'drop')).toBe(true);

            const md = htmlToMarkdown(editor.getHTML());
            expect(md).toContain('[^qa-keep]');
            expect(md).not.toContain('[^qa-drop]');
        } finally {
            editor.destroy();
        }
    });

    it('returns false when no marker with that id exists, and for a null/destroyed editor', () => {
        const editor = makeEditor(SENTENCE);
        try {
            expect(deleteSidenoteRef(editor, 'missing')).toBe(false);
            expect(deleteSidenoteRef(editor, '')).toBe(false);
        } finally {
            editor.destroy();
        }
        expect(deleteSidenoteRef(null, 'x')).toBe(false);
        const destroyed = makeEditor(SENTENCE);
        destroyed.destroy();
        expect(deleteSidenoteRef(destroyed, 'x')).toBe(false);
    });
});
