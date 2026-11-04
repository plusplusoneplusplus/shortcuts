import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffComment, DiffCommentSelection } from '../../../../src/server/spa/client/comments/diff-comment-types';
import type { TaskComment } from '../../../../src/server/spa/client/comments/task-comments-types';
import type { UnifiedDiffViewerHandle } from '../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer';
import { useDiffPanelComments, useRevealDiffComment } from '../../../../src/server/spa/client/react/features/git/diff/useDiffPanelComments';
import { useInitialDiffHunk } from '../../../../src/server/spa/client/react/features/git/diff/useInitialDiffHunk';

const selection: DiffCommentSelection = {
    diffLineStart: 2, diffLineEnd: 2, side: 'added',
    oldLineStart: 0, oldLineEnd: 0, newLineStart: 1, newLineEnd: 1,
};
const context = { repositoryId: 'workspace', filePath: 'file.ts', oldRef: 'base', newRef: 'head' };
const comment = { id: 'comment', context, selection } as DiffComment;
const position = { top: 20, left: 30 };

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('shared diff comment interaction', () => {
    it('retains failed drafts and clears only the submitted draft after successful save', async () => {
        const add = vi.fn().mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce(undefined);
        const { result } = renderHook(() => useDiffPanelComments('owner:comparison:file', add));
        act(() => result.current.handleAddComment(selection, 'selected', position));
        await act(async () => { await expect(result.current.handlePopupSubmit('note', 'bug')).rejects.toThrow('save failed'); });
        expect(result.current.popupState?.selectedText).toBe('selected');
        await act(async () => { await result.current.handlePopupSubmit('note', 'bug'); });
        expect(add).toHaveBeenLastCalledWith(selection, 'selected', 'note', 'bug');
        expect(result.current.popupState).toBeNull();
    });

    it('old owner saves cannot dismiss a new owner draft; comparison changes reset popovers', async () => {
        let finish!: () => void;
        const add = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const { result, rerender } = renderHook(({ identity }) => useDiffPanelComments(identity, add), {
            initialProps: { identity: 'clone-a:workspace:commit:file' },
        });
        act(() => result.current.handleAddComment(selection, 'old', position));
        let saving!: Promise<void>;
        act(() => { saving = result.current.handlePopupSubmit('note', 'bug'); });
        rerender({ identity: 'clone-b:workspace:commit:file' });
        expect(result.current.popupState).toBeNull();
        act(() => result.current.handleAddComment(selection, 'new', position));
        await act(async () => { finish(); await saving; });
        expect(result.current.popupState?.selectedText).toBe('new');
        const anchor = document.createElement('button');
        vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ bottom: 40, left: -10 } as DOMRect);
        act(() => result.current.handleCommentClick(comment, { currentTarget: anchor } as unknown as React.MouseEvent));
        expect(result.current.popoverPos).toEqual({ top: 48, left: 8 });
        rerender({ identity: 'clone-b:workspace:another-commit:file' });
        expect(result.current.activePopoverComment).toBeNull();
        expect(result.current.popoverPos).toBeNull();
    });

    it('preserves a replacement draft when an earlier submission finishes in the same file', async () => {
        let finish!: () => void;
        const add = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const { result } = renderHook(() => useDiffPanelComments('owner:file', add));
        act(() => result.current.handleAddComment(selection, 'first', position));
        let saving!: Promise<void>;
        act(() => { saving = result.current.handlePopupSubmit('note', 'bug'); });
        act(() => result.current.handleAddComment(selection, 'replacement', position));
        await act(async () => { finish(); await saving; });
        expect(result.current.popupState?.selectedText).toBe('replacement');
    });
});

describe('shared diff reveal', () => {
    it('does not send task comments from shared sidebar types to a diff editor', () => {
        const editorRef = { current: { revealComment: vi.fn() } };
        const { result } = renderHook(() => useRevealDiffComment('owner', { current: null }, editorRef, true));
        act(() => result.current({ id: 'task-comment', taskId: 'task' } as TaskComment));
        expect(editorRef.current.revealComment).not.toHaveBeenCalled();
    });

    it('reveals whole-file cards before editor threads and cleans their highlight timers', () => {
        vi.useFakeTimers();
        const container = document.createElement('div');
        const card = document.createElement('div');
        card.dataset.fileCommentId = 'file-comment';
        card.scrollIntoView = vi.fn();
        container.append(card);
        const editorRef = { current: { revealComment: vi.fn() } };
        const { result, unmount } = renderHook(() => useRevealDiffComment('owner', { current: container }, editorRef, true));
        act(() => result.current({ id: 'file-comment', context, scope: 'file' } as DiffComment));
        expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
        expect(editorRef.current.revealComment).not.toHaveBeenCalled();
        expect(card.classList.contains('ring-2')).toBe(true);
        unmount();
        expect(card.classList.contains('ring-2')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reveals editor threads or classic lines and cleans classic highlights on owner change/unmount', () => {
        vi.useFakeTimers();
        const container = document.createElement('div');
        const line = document.createElement('div');
        line.dataset.diffLineIndex = '2';
        line.scrollIntoView = vi.fn();
        container.append(line);
        const containerRef = { current: container };
        const editorRef = { current: { revealComment: vi.fn() } };
        const { result, rerender, unmount } = renderHook(
            ({ identity, editor }) => useRevealDiffComment(identity, containerRef, editorRef, editor),
            { initialProps: { identity: 'owner-a', editor: false } },
        );
        act(() => result.current(comment));
        expect(line.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
        expect(line.classList.contains('ring-2')).toBe(true);
        rerender({ identity: 'owner-b', editor: true });
        expect(line.classList.contains('ring-2')).toBe(false);
        act(() => result.current(comment));
        expect(editorRef.current.revealComment).toHaveBeenCalledWith('comment');
        rerender({ identity: 'owner-b', editor: false });
        act(() => result.current(comment));
        unmount();
        expect(line.classList.contains('ring-2')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('waits for Classic readiness, scrolls once per owner/file, and cancels pending reveals', () => {
        vi.useFakeTimers();
        const viewer = { getHunkCount: vi.fn(() => 3), scrollToHunk: vi.fn() };
        const ref = { current: viewer as unknown as UnifiedDiffViewerHandle };
        const { rerender, unmount } = renderHook(
            ({ identity, ready, target }) => useInitialDiffHunk(ref, identity, target, ready),
            { initialProps: { identity: 'a:file', ready: false, target: 'last' as 'first' | 'last' } },
        );
        act(() => vi.advanceTimersByTime(50));
        expect(viewer.scrollToHunk).not.toHaveBeenCalled();
        rerender({ identity: 'a:file', ready: true, target: 'last' });
        act(() => vi.advanceTimersByTime(50));
        expect(viewer.scrollToHunk).toHaveBeenLastCalledWith(2);
        rerender({ identity: 'a:file', ready: false, target: 'last' });
        rerender({ identity: 'a:file', ready: true, target: 'last' });
        act(() => vi.advanceTimersByTime(50));
        expect(viewer.scrollToHunk).toHaveBeenCalledOnce();
        rerender({ identity: 'b:file', ready: true, target: 'first' });
        act(() => vi.advanceTimersByTime(50));
        expect(viewer.scrollToHunk).toHaveBeenLastCalledWith(0);
        rerender({ identity: 'b:next-file', ready: true, target: 'last' });
        unmount();
        act(() => vi.advanceTimersByTime(50));
        expect(viewer.scrollToHunk).toHaveBeenCalledTimes(2);
    });
});
