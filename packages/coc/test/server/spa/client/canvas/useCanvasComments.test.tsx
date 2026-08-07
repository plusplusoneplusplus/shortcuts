/**
 * @vitest-environment jsdom
 *
 * useCanvasComments — selection anchoring, comment CRUD, and the batch
 * "send open comments to the AI" flow.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useRef } from 'react';

import { useCanvasComments } from '../../../../../src/server/spa/client/react/features/canvas/hooks/useCanvasComments';

function makeCanvas(overrides: Record<string, unknown> = {}) {
    return {
        id: 'doc-abc123', workspaceId: 'ws-1', title: 'My Plan', type: 'markdown', revision: 3,
        createdAt: '2026-06-12T00:00:00.000Z', updatedAt: '2026-06-12T00:00:00.000Z',
        lastEditor: 'ai', content: '# Plan body', ...overrides,
    } as any;
}

function comment(id: string, overrides: Record<string, unknown> = {}) {
    return { id, anchorText: `anchor-${id}`, body: `body-${id}`, status: 'open', ...overrides } as any;
}

describe('useCanvasComments', () => {
    let listComments: ReturnType<typeof vi.fn>;
    let addComment: ReturnType<typeof vi.fn>;
    let deleteComment: ReturnType<typeof vi.fn>;
    let setCommentStatus: ReturnType<typeof vi.fn>;
    let onAskAi: ReturnType<typeof vi.fn>;
    let onSendToAi: ReturnType<typeof vi.fn>;
    let client: any;

    beforeEach(() => {
        listComments = vi.fn().mockResolvedValue([]);
        addComment = vi.fn().mockImplementation((_ws, _id, body) => Promise.resolve({ id: 'c-new', status: 'open', ...body }));
        deleteComment = vi.fn().mockResolvedValue(undefined);
        setCommentStatus = vi.fn().mockImplementation((_ws, _id, commentId) => Promise.resolve(comment(commentId, { status: 'sent' })));
        onAskAi = vi.fn();
        onSendToAi = vi.fn().mockResolvedValue(undefined);
        client = { canvases: { listComments, addComment, deleteComment, setCommentStatus } };
    });

    function mount(props: Record<string, unknown> = {}) {
        return renderHook(
            ({ canvas, loadNonce, canvasId }: any) => {
                const canvasRef = useRef(canvas);
                canvasRef.current = canvas;
                return useCanvasComments({
                    client, workspaceId: 'ws-1', canvasId, canvas, canvasRef, loadNonce, onAskAi, onSendToAi,
                });
            },
            { initialProps: { canvas: makeCanvas(), loadNonce: 1, canvasId: 'doc-abc123', ...props } as any },
        );
    }

    it('does not fetch comments before the first successful load', () => {
        mount({ canvas: null, loadNonce: 0 });
        expect(listComments).not.toHaveBeenCalled();
    });

    it('loads comments and splits out the still-open ones', async () => {
        listComments.mockResolvedValue([comment('c1'), comment('c2', { status: 'sent' }), comment('c3', { status: 'resolved' })]);
        const { result } = mount();

        await waitFor(() => expect(result.current.comments).toHaveLength(3));
        expect(result.current.openComments.map(c => c.id)).toEqual(['c1']);
    });

    it('tolerates a failed comment fetch', async () => {
        listComments.mockRejectedValue(new Error('nope'));
        const { result } = mount();

        await waitFor(() => expect(listComments).toHaveBeenCalled());
        expect(result.current.comments).toEqual([]);
    });

    it('builds an Ask AI prompt from the selection and clears it', () => {
        const { result } = mount();
        act(() => result.current.setSelection('the risks section'));

        act(() => result.current.askAi());

        expect(onAskAi).toHaveBeenCalledWith(expect.stringContaining('the risks section'));
        expect(onAskAi.mock.calls[0][0]).toContain('revision 3');
        expect(result.current.selection).toBeNull();
    });

    it('ignores Ask AI with no selection', () => {
        const { result } = mount();
        act(() => result.current.askAi());
        expect(onAskAi).not.toHaveBeenCalled();
    });

    it('anchors a new comment to the selection, then clears the selection', () => {
        const { result } = mount();
        act(() => result.current.setSelection('the risks section'));

        act(() => result.current.startComment());

        expect(result.current.commentAnchor).toBe('the risks section');
        expect(result.current.commentDraft).toBe('');
        expect(result.current.selection).toBeNull();
    });

    it('submits a trimmed comment and appends it to the list', async () => {
        const { result } = mount();
        act(() => result.current.setSelection('anchor here'));
        act(() => result.current.startComment());
        act(() => result.current.setCommentDraft('  please tighten this  '));

        await act(async () => { await result.current.submitComment(); });

        expect(addComment).toHaveBeenCalledWith('ws-1', 'doc-abc123', { anchorText: 'anchor here', body: 'please tighten this' });
        expect(result.current.comments).toHaveLength(1);
        expect(result.current.commentAnchor).toBeNull();
    });

    it('ignores a blank comment and keeps the compose box open on a failed write', async () => {
        const { result } = mount();
        act(() => result.current.setSelection('anchor here'));
        act(() => result.current.startComment());
        act(() => result.current.setCommentDraft('   '));
        await act(async () => { await result.current.submitComment(); });
        expect(addComment).not.toHaveBeenCalled();

        addComment.mockRejectedValue(new Error('offline'));
        act(() => result.current.setCommentDraft('real text'));
        await act(async () => { await result.current.submitComment(); });

        expect(result.current.commentAnchor).toBe('anchor here');
        expect(result.current.commentDraft).toBe('real text');
        expect(result.current.comments).toHaveLength(0);
    });

    it('cancelComment drops the anchor and the draft', () => {
        const { result } = mount();
        act(() => result.current.setSelection('anchor here'));
        act(() => result.current.startComment());
        act(() => result.current.setCommentDraft('half-written'));

        act(() => result.current.cancelComment());

        expect(result.current.commentAnchor).toBeNull();
        expect(result.current.commentDraft).toBe('');
    });

    it('deletes a comment, and keeps it on a failed delete', async () => {
        listComments.mockResolvedValue([comment('c1'), comment('c2')]);
        const { result } = mount();
        await waitFor(() => expect(result.current.comments).toHaveLength(2));

        await act(async () => { await result.current.deleteComment('c1'); });
        expect(deleteComment).toHaveBeenCalledWith('ws-1', 'doc-abc123', 'c1');
        expect(result.current.comments.map(c => c.id)).toEqual(['c2']);

        deleteComment.mockRejectedValue(new Error('offline'));
        await act(async () => { await result.current.deleteComment('c2'); });
        expect(result.current.comments.map(c => c.id)).toEqual(['c2']);
    });

    it('sends the open comments in one message and marks only those sent', async () => {
        listComments.mockResolvedValue([comment('c1'), comment('c2'), comment('c3', { status: 'resolved' })]);
        const { result } = mount();
        await waitFor(() => expect(result.current.comments).toHaveLength(3));

        await act(async () => { await result.current.sendComments(); });

        const message = onSendToAi.mock.calls[0][0];
        expect(message).toContain('1. On "anchor-c1": body-c1');
        expect(message).toContain('2. On "anchor-c2": body-c2');
        expect(message).not.toContain('c3');
        expect(setCommentStatus).toHaveBeenCalledTimes(2);
        expect(result.current.comments.map(c => c.status)).toEqual(['sent', 'sent', 'resolved']);
        expect(result.current.sendingComments).toBe(false);
    });

    it('leaves the comments open when the send itself fails', async () => {
        listComments.mockResolvedValue([comment('c1')]);
        onSendToAi.mockRejectedValue(new Error('busy'));
        const { result } = mount();
        await waitFor(() => expect(result.current.comments).toHaveLength(1));

        await act(async () => { await result.current.sendComments(); });

        expect(setCommentStatus).not.toHaveBeenCalled();
        expect(result.current.comments[0].status).toBe('open');
        expect(result.current.sendingComments).toBe(false);
    });

    it('keeps a comment untouched when only its status write fails', async () => {
        listComments.mockResolvedValue([comment('c1'), comment('c2')]);
        setCommentStatus.mockImplementation((_ws, _id, commentId) => commentId === 'c1'
            ? Promise.resolve(comment('c1', { status: 'sent' }))
            : Promise.reject(new Error('flaky')));
        const { result } = mount();
        await waitFor(() => expect(result.current.comments).toHaveLength(2));

        await act(async () => { await result.current.sendComments(); });

        expect(result.current.comments.map(c => c.status)).toEqual(['sent', 'open']);
    });

    it('does nothing with no open comments, no canvas, or no send path', async () => {
        const { result } = mount();
        await waitFor(() => expect(listComments).toHaveBeenCalled());

        await act(async () => { await result.current.sendComments(); });
        expect(onSendToAi).not.toHaveBeenCalled();
    });

    it('clears the selection, draft, and comments when the canvas changes', async () => {
        listComments.mockResolvedValue([comment('c1')]);
        const { result, rerender } = mount();
        await waitFor(() => expect(result.current.comments).toHaveLength(1));
        act(() => result.current.setSelection('sel'));
        act(() => result.current.startComment());

        listComments.mockResolvedValue([]);
        rerender({ canvas: makeCanvas({ id: 'doc-def456' }), loadNonce: 1, canvasId: 'doc-def456' } as any);

        expect(result.current.comments).toEqual([]);
        expect(result.current.selection).toBeNull();
        expect(result.current.commentAnchor).toBeNull();
        expect(result.current.commentDraft).toBe('');
    });
});
