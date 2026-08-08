// @vitest-environment jsdom
/**
 * revealCommentThread — clicking a comment card in the sidebar must scroll the
 * commented text into view and flash it, even though the editor is not focused
 * at click time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import {
    revealCommentThread,
    findCommentMarkRange,
    COMMENT_ACTIVE_HIGHLIGHT_MS,
} from '../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring';
import { CommentExtension } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/commentExtension';

const MARKED = '<p>Hello <span data-comment-id="t1">world</span> again</p>';

/** Mount the editor inside a scrollable ancestor, like NoteEditor does. */
function createEditor(content = MARKED) {
    const scroller = document.createElement('div');
    scroller.className = 'flex-1 overflow-y-auto relative';
    const element = document.createElement('div');
    scroller.appendChild(element);
    document.body.appendChild(scroller);

    const editor = new Editor({
        element,
        extensions: [StarterKit, CommentExtension.configure({ onCommentActivated: () => {} })],
        content,
    });
    return { editor, scroller };
}

function span(editor: Editor, id = 't1') {
    return editor.view.dom.querySelector<HTMLElement>(`span[data-comment-id="${id}"]`);
}

beforeEach(() => {
    // jsdom implements none of these; ProseMirror's scrollToSelection needs
    // getClientRects (it falls back to getBoundingClientRect when empty).
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    const noRects = function () { return [] as unknown as DOMRectList; };
    Element.prototype.getClientRects = noRects;
    (Text.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = noRects;
    (Range.prototype as unknown as { getClientRects: () => DOMRectList }).getClientRects = noRects;
    const zeroRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
    (Text.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = zeroRect;
    (Range.prototype as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = zeroRect;
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
});

describe('revealCommentThread', () => {
    it('selects the full range covered by the comment mark', () => {
        const { editor } = createEditor();
        const range = findCommentMarkRange(editor, 't1');
        expect(range).not.toBeNull();

        expect(revealCommentThread(editor, 't1')).toBe(true);

        expect(editor.state.selection.from).toBe(range!.from);
        expect(editor.state.selection.to).toBe(range!.to);
        expect(editor.state.doc.textBetween(range!.from, range!.to, '')).toBe('world');
        editor.destroy();
    });

    it('focuses the editor and scrolls before selecting — the sidebar click leaves it blurred', () => {
        const calls: string[] = [];
        const chain: any = new Proxy({}, {
            get: (_t, prop: string) => (...args: unknown[]) => {
                calls.push(prop);
                if (prop === 'setTextSelection') calls.push(JSON.stringify(args[0]));
                return prop === 'run' ? true : chain;
            },
        });
        const stub = {
            state: {
                doc: {
                    descendants: (fn: (node: any, pos: number) => void) => {
                        fn({
                            isText: true,
                            nodeSize: 5,
                            marks: [{ type: { name: 'comment' }, attrs: { commentId: 't1' } }],
                        }, 7);
                    },
                },
            },
            chain: () => chain,
        } as unknown as Editor;

        expect(revealCommentThread(stub, 't1')).toBe(true);
        expect(calls).toEqual([
            'focus',
            'setTextSelection',
            JSON.stringify({ from: 7, to: 12 }),
            'scrollIntoView',
            'run',
        ]);
    });

    it('centres the commented span in its scrollable ancestor', () => {
        const { editor, scroller } = createEditor();
        const target = span(editor)!;

        scroller.scrollTop = 100;
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 400 } as DOMRect);
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 620, height: 20 } as DOMRect);

        revealCommentThread(editor, 't1');

        // 100 + (620 - 0) - 400/2 + 20/2 = 530
        expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 530, behavior: 'smooth' });
        editor.destroy();
    });

    it('never scrolls to a negative offset', () => {
        const { editor, scroller } = createEditor();
        const target = span(editor)!;
        scroller.scrollTop = 0;
        vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 400 } as DOMRect);
        vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({ top: 10, height: 20 } as DOMRect);

        revealCommentThread(editor, 't1');

        expect(scroller.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
        editor.destroy();
    });

    it('flashes comment-active on the span and clears it afterwards', () => {
        vi.useFakeTimers();
        const { editor } = createEditor();

        revealCommentThread(editor, 't1');
        expect(span(editor)!.classList.contains('comment-active')).toBe(true);

        vi.advanceTimersByTime(COMMENT_ACTIVE_HIGHLIGHT_MS - 1);
        expect(span(editor)!.classList.contains('comment-active')).toBe(true);

        vi.advanceTimersByTime(1);
        expect(span(editor)!.classList.contains('comment-active')).toBe(false);
        editor.destroy();
    });

    it('moves the highlight when a different card is clicked', () => {
        vi.useFakeTimers();
        const { editor } = createEditor(
            '<p><span data-comment-id="t1">first</span> and <span data-comment-id="t2">second</span></p>',
        );

        revealCommentThread(editor, 't1');
        revealCommentThread(editor, 't2');

        expect(span(editor, 't1')!.classList.contains('comment-active')).toBe(false);
        expect(span(editor, 't2')!.classList.contains('comment-active')).toBe(true);
        editor.destroy();
    });

    it('falls back to the text anchor when the mark is gone (resolved thread)', () => {
        const { editor } = createEditor('<p>Hello world again</p>');

        const ok = revealCommentThread(editor, 'resolved-1', {
            anchor: { quotedText: 'world', prefix: 'Hello ', suffix: ' again' },
        });

        expect(ok).toBe(true);
        expect(editor.state.doc.textBetween(
            editor.state.selection.from,
            editor.state.selection.to,
            '',
        )).toBe('world');
        editor.destroy();
    });

    it('is a no-op when neither a mark nor a resolvable anchor exists', () => {
        const { editor } = createEditor('<p>Hello world again</p>');
        const chainSpy = vi.spyOn(editor, 'chain');

        expect(revealCommentThread(editor, 'missing')).toBe(false);
        expect(revealCommentThread(editor, 'missing', { anchor: { quotedText: 'nope', prefix: '', suffix: '' } })).toBe(false);
        expect(chainSpy).not.toHaveBeenCalled();
        editor.destroy();
    });
});
