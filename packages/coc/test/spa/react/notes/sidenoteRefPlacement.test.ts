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
import {
    QA_SIDENOTE_ANCHOR_CLASS,
    SidenoteRefExtension,
    sidenoteAnchorPluginKey,
}
    from '../../../../src/server/spa/client/react/features/notes/editor/extensions/sidenoteRefExtension';
import {
    deleteSidenoteRef,
    insertSidenoteRef,
    resolveSidenoteInsertPos,
    updateSidenoteRefTurns,
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
            expect(html).toContain('data-qa-selected-text="gradient descent"');
            expect(html).toContain('data-qa-context-before="we optimize the loss with "');
            expect(html).toContain('data-qa-context-after=" over many epochs"');

            // The persisted markdown carries the trailing marker at the phrase and
            // the answer in a definition block at the file bottom.
            expect(htmlToMarkdown(html)).toBe(
                'we optimize the loss with gradient descent[^qa-note1] over many epochs\n\n'
                + '[^qa-note1]: {"turns":[{"q":"what is this?","a":"Iterative first-order optimization."}],'
                + '"s":"gradient descent","p":"we optimize the loss with ","x":" over many epochs"}\n',
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
                + '[^qa-d1]: {"turns":[{"a":"A."}],"s":"gradient descent",'
                + '"p":"we optimize the loss with ","x":" over many epochs"}\n',
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
                + '[^qa-g1]: {"turns":[{"a":"grounded"}],"s":"gradient descent",'
                + '"p":"we optimize the loss with ","x":" over many epochs"}\n',
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
                'alpha token beta and gamma token[^qa-t2] delta\n\n'
                + '[^qa-t2]: {"turns":[{"a":"second one"}],"s":"token","p":"gamma ","x":" delta"}\n',
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

describe('insertSidenoteRef — multi-turn payload (AC-03)', () => {
    it('persists the whole thread into the definition when turns are supplied', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, {
                refId: 'm1',
                question: 'what is this?',
                answer: 'Iterative first-order optimization.',
                turns: [
                    { question: 'what is this?', answer: 'Iterative first-order optimization.' },
                    { question: 'give an example', answer: 'For example, SGD.' },
                ],
            });
            const html = editor.getHTML();
            expect(html).toContain('data-qa-turns=');
            expect(htmlToMarkdown(html)).toBe(
                'we optimize the loss with gradient descent[^qa-m1] over many epochs\n\n'
                + '[^qa-m1]: {"turns":['
                + '{"q":"what is this?","a":"Iterative first-order optimization."},'
                + '{"q":"give an example","a":"For example, SGD."}],'
                + '"s":"gradient descent","p":"we optimize the loss with ","x":" over many epochs"}\n',
            );
        } finally {
            editor.destroy();
        }
    });
});

describe('updateSidenoteRefTurns — follow-up persistence (AC-03)', () => {
    it('re-writes the marker with the accumulated thread so a follow-up survives save', () => {
        const editor = makeEditor(SENTENCE);
        try {
            // Turn 0 inserts the marker (one-turn persistence).
            insertSidenoteRef(editor, ANCHOR, {
                refId: 'f1',
                question: 'what is this?',
                answer: 'Iterative first-order optimization.',
                turns: [{ question: 'what is this?', answer: 'Iterative first-order optimization.' }],
            });

            // A follow-up answer folds the accumulated ready turns back onto it.
            const updated = updateSidenoteRefTurns(editor, 'f1', [
                { question: 'what is this?', answer: 'Iterative first-order optimization.' },
                { question: 'give an example', answer: 'For example, SGD.' },
            ]);
            expect(updated).toBe(true);

            // The saved md now carries BOTH turns in the definition.
            expect(htmlToMarkdown(editor.getHTML())).toBe(
                'we optimize the loss with gradient descent[^qa-f1] over many epochs\n\n'
                + '[^qa-f1]: {"turns":['
                + '{"q":"what is this?","a":"Iterative first-order optimization."},'
                + '{"q":"give an example","a":"For example, SGD."}],'
                + '"s":"gradient descent","p":"we optimize the loss with ","x":" over many epochs"}\n',
            );
        } finally {
            editor.destroy();
        }
    });

    it('returns false for empty turns, an unknown id, and a null/destroyed editor', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, { refId: 'u1', answer: 'A.' });
            expect(updateSidenoteRefTurns(editor, 'u1', [])).toBe(false);
            expect(updateSidenoteRefTurns(editor, 'missing', [{ answer: 'x' }])).toBe(false);
        } finally {
            editor.destroy();
        }
        expect(updateSidenoteRefTurns(null, 'u1', [{ answer: 'x' }])).toBe(false);
        const destroyed = makeEditor(SENTENCE);
        destroyed.destroy();
        expect(updateSidenoteRefTurns(destroyed, 'u1', [{ answer: 'x' }])).toBe(false);
    });
});

describe('SidenoteRefExtension anchor decorations', () => {
    function decorations(editor: Editor) {
        return sidenoteAnchorPluginKey.getState(editor.state)?.find() ?? [];
    }

    it('underlines the exact selected range without changing editor text', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, { refId: 'anchor1', answer: 'A' });
            const found = decorations(editor);
            expect(found).toHaveLength(1);
            expect(found[0].type.attrs.class).toBe(QA_SIDENOTE_ANCHOR_CLASS);
            expect(editor.state.doc.textBetween(found[0].from, found[0].to, ''))
                .toBe('gradient descent');
            expect(
                editor.view.dom.querySelector(`.${QA_SIDENOTE_ANCHOR_CLASS}`)?.textContent,
            ).toBe('gradient descent');
            expect(editor.state.doc.textContent).toBe(
                'we optimize the loss with gradient descent over many epochs',
            );
        } finally {
            editor.destroy();
        }
    });

    it('keeps one range across inline formatting boundaries', () => {
        const editor = makeEditor(
            '<p>we optimize with <em>gradient</em> <strong>descent</strong> today</p>',
        );
        try {
            insertSidenoteRef(
                editor,
                {
                    selectedText: 'gradient descent',
                    contextBefore: 'we optimize with ',
                    contextAfter: ' today',
                },
                { refId: 'formatted', answer: 'A' },
            );
            const found = decorations(editor);
            expect(found).toHaveLength(1);
            expect(editor.state.doc.textBetween(found[0].from, found[0].to, ''))
                .toBe('gradient descent');
            expect(htmlToMarkdown(editor.getHTML())).toContain('_gradient_ **descent**');
            expect(htmlToMarkdown(editor.getHTML())).not.toContain(QA_SIDENOTE_ANCHOR_CLASS);
        } finally {
            editor.destroy();
        }
    });

    it('uses context and chip placement for the intended repeated phrase', () => {
        const editor = makeEditor('<p>alpha target one; beta target two</p>');
        try {
            insertSidenoteRef(
                editor,
                { selectedText: 'target', contextBefore: 'one; beta ', contextAfter: ' two' },
                { refId: 'repeat', answer: 'A' },
            );
            const found = decorations(editor);
            expect(found).toHaveLength(1);
            expect(editor.state.doc.textBetween(found[0].to, found[0].to + 4, '')).toBe(' tw');
        } finally {
            editor.destroy();
        }
    });

    it('deduplicates identical ranges but preserves overlapping ranges', () => {
        const editor = makeEditor('<p>alpha beta gamma</p>');
        try {
            const betaAnchor = {
                selectedText: 'beta',
                contextBefore: 'alpha ',
                contextAfter: ' gamma',
            };
            insertSidenoteRef(editor, betaAnchor, { refId: 'same1', answer: 'A' });
            insertSidenoteRef(editor, betaAnchor, { refId: 'same2', answer: 'B' });
            expect(decorations(editor)).toHaveLength(1);

            insertSidenoteRef(
                editor,
                { selectedText: 'beta gamma', contextBefore: 'alpha ', contextAfter: '' },
                { refId: 'overlap', answer: 'C' },
            );
            expect(decorations(editor)).toHaveLength(2);
        } finally {
            editor.destroy();
        }
    });

    it('drops an unresolved underline while keeping the chip and answer', () => {
        const editor = makeEditor(SENTENCE);
        try {
            insertSidenoteRef(editor, ANCHOR, { refId: 'edited', answer: 'still here' });
            expect(decorations(editor)).toHaveLength(1);
            editor.commands.setContent(
                '<p>a different method' +
                '<span class="qa-sidenote-ref" data-qa-id="edited" data-qa-answer="still here" ' +
                'data-qa-selected-text="gradient descent" ' +
                'data-qa-context-before="we optimize the loss with " ' +
                'data-qa-context-after=" over many epochs">✨</span></p>',
            );
            expect(decorations(editor)).toHaveLength(0);
            expect(editor.getHTML()).toContain('data-qa-id="edited"');
            expect(editor.getHTML()).toContain('data-qa-answer="still here"');
        } finally {
            editor.destroy();
        }
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
