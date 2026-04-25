// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    textOffsetToPos,
    posToTextOffset,
    createTextAnchorFromSelection,
    findAnchorInDoc,
    applyCommentMark,
    buildAnchorFromMark,
} from '../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring';
import { CommentExtension } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/commentExtension';

function createEditor(content = '<p>Hello world</p>') {
    return new Editor({
        element: document.createElement('div'),
        extensions: [
            StarterKit,
            CommentExtension.configure({ onCommentActivated: () => {} }),
        ],
        content,
    });
}

describe('commentAnchoring', () => {
    describe('textOffsetToPos', () => {
        it('converts offset 0 to ProseMirror position 1 in a single paragraph', () => {
            const editor = createEditor('<p>Hello world</p>');
            const pos = textOffsetToPos(editor.state.doc, 0);
            expect(pos).toBe(1);
            editor.destroy();
        });

        it('converts offset in the middle of text', () => {
            const editor = createEditor('<p>Hello world</p>');
            // offset 5 → "Hello" length, should point to position 6 (after "Hello")
            const pos = textOffsetToPos(editor.state.doc, 5);
            expect(pos).toBe(6);
            editor.destroy();
        });

        it('handles multi-block documents correctly', () => {
            const editor = createEditor('<p>First</p><p>Second</p>');
            // "First" = 5 chars (text offsets 0-4), "Second" starts at text offset 5
            // textOffsetToPos returns the first matching position in the doc.
            // Offset 5 = end of "First" text node → PM pos 6 (nodePos=1 + 5)
            const pos = textOffsetToPos(editor.state.doc, 5);
            expect(pos).toBe(6);

            // Offset 6 = 1 char into "Second" → PM pos 9 (nodePos=8 + 1)
            const pos2 = textOffsetToPos(editor.state.doc, 6);
            expect(pos2).toBe(9);
            editor.destroy();
        });

        it('returns doc.content.size for offset past all text', () => {
            const editor = createEditor('<p>Hi</p>');
            const pos = textOffsetToPos(editor.state.doc, 100);
            expect(pos).toBe(editor.state.doc.content.size);
            editor.destroy();
        });
    });

    describe('posToTextOffset', () => {
        it('converts ProseMirror position 1 to offset 0', () => {
            const editor = createEditor('<p>Hello world</p>');
            const offset = posToTextOffset(editor.state.doc, 1);
            expect(offset).toBe(0);
            editor.destroy();
        });

        it('converts position in middle of text', () => {
            const editor = createEditor('<p>Hello world</p>');
            const offset = posToTextOffset(editor.state.doc, 6);
            expect(offset).toBe(5);
            editor.destroy();
        });

        it('handles multi-block documents', () => {
            const editor = createEditor('<p>First</p><p>Second</p>');
            // ProseMirror pos 8 = start of "Second"
            const offset = posToTextOffset(editor.state.doc, 8);
            expect(offset).toBe(5);
            editor.destroy();
        });

        it('round-trips with textOffsetToPos for single-block offsets', () => {
            const editor = createEditor('<p>Hello world and more</p>');
            for (const testOffset of [0, 3, 5, 10, 15]) {
                const pos = textOffsetToPos(editor.state.doc, testOffset);
                const roundTripped = posToTextOffset(editor.state.doc, pos);
                expect(roundTripped).toBe(testOffset);
            }
            editor.destroy();
        });
    });

    describe('createTextAnchorFromSelection', () => {
        it('returns null when selection is collapsed', () => {
            const editor = createEditor('<p>Hello world</p>');
            editor.commands.setTextSelection(3);
            expect(createTextAnchorFromSelection(editor)).toBeNull();
            editor.destroy();
        });

        it('creates anchor from selection with correct quotedText', () => {
            const editor = createEditor('<p>Hello world</p>');
            editor.commands.setTextSelection({ from: 7, to: 12 });
            const anchor = createTextAnchorFromSelection(editor);
            expect(anchor).not.toBeNull();
            expect(anchor!.quotedText).toBe('world');
            editor.destroy();
        });

        it('includes prefix context', () => {
            const editor = createEditor('<p>Hello world</p>');
            editor.commands.setTextSelection({ from: 7, to: 12 });
            const anchor = createTextAnchorFromSelection(editor);
            expect(anchor!.prefix).toBe('Hello ');
            editor.destroy();
        });

        it('includes suffix context', () => {
            const editor = createEditor('<p>Hello world foo</p>');
            editor.commands.setTextSelection({ from: 7, to: 12 });
            const anchor = createTextAnchorFromSelection(editor);
            expect(anchor!.suffix).toBe(' foo');
            editor.destroy();
        });
    });

    describe('findAnchorInDoc', () => {
        it('finds quoted text in the document', () => {
            const editor = createEditor('<p>Hello world</p>');
            const result = findAnchorInDoc(editor.state.doc, {
                quotedText: 'world',
                prefix: 'Hello ',
                suffix: '',
            });
            expect(result).not.toBeNull();
            expect(result!.from).toBe(7);
            expect(result!.to).toBe(12);
            editor.destroy();
        });

        it('returns null when quoted text is not found', () => {
            const editor = createEditor('<p>Hello world</p>');
            const result = findAnchorInDoc(editor.state.doc, {
                quotedText: 'missing',
                prefix: '',
                suffix: '',
            });
            expect(result).toBeNull();
            editor.destroy();
        });

        it('uses context to disambiguate multiple occurrences', () => {
            const editor = createEditor('<p>foo bar foo baz</p>');
            // "foo" appears twice: at offset 0 and offset 8
            // With prefix "bar " we want the second occurrence
            const result = findAnchorInDoc(editor.state.doc, {
                quotedText: 'foo',
                prefix: 'bar ',
                suffix: ' baz',
            });
            expect(result).not.toBeNull();
            // The second "foo" starts at text offset 8 → PM position 9
            expect(result!.from).toBe(9);
            editor.destroy();
        });

        it('returns null for empty quotedText', () => {
            const editor = createEditor('<p>Hello</p>');
            const result = findAnchorInDoc(editor.state.doc, {
                quotedText: '',
                prefix: '',
                suffix: '',
            });
            expect(result).toBeNull();
            editor.destroy();
        });
    });

    describe('applyCommentMark', () => {
        it('applies a comment mark to the specified range', () => {
            const editor = createEditor('<p>Hello world</p>');
            applyCommentMark(editor, 'thread-1', 7, 12);

            let found = false;
            editor.state.doc.descendants((node) => {
                for (const mark of node.marks) {
                    if (mark.type.name === 'comment' && mark.attrs.commentId === 'thread-1') {
                        found = true;
                    }
                }
            });
            expect(found).toBe(true);
            editor.destroy();
        });

        it('preserves original selection after applying mark', () => {
            const editor = createEditor('<p>Hello world foo</p>');
            editor.commands.setTextSelection(3);
            applyCommentMark(editor, 'thread-1', 7, 12);

            expect(editor.state.selection.from).toBe(3);
            expect(editor.state.selection.to).toBe(3);
            editor.destroy();
        });
    });

    describe('buildAnchorFromMark', () => {
        it('builds anchor from an existing comment mark', () => {
            const editor = createEditor('<p>Hello world foo</p>');
            editor.commands.setTextSelection({ from: 7, to: 12 });
            editor.commands.setComment('thread-1');

            const anchor = buildAnchorFromMark(editor, 'thread-1');
            expect(anchor).not.toBeNull();
            expect(anchor!.quotedText).toBe('world');
            expect(anchor!.prefix).toBe('Hello ');
            expect(anchor!.suffix).toBe(' foo');
            editor.destroy();
        });

        it('returns null when mark does not exist', () => {
            const editor = createEditor('<p>Hello world</p>');
            const anchor = buildAnchorFromMark(editor, 'nonexistent');
            expect(anchor).toBeNull();
            editor.destroy();
        });
    });
});
