// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { CommentThread, NoteSidecar, Comment } from '../../../../src/server/spa/client/react/features/notes/notesApi';

// ── Mock typed SPA client ──────────────────────────────────────────────────
const mockSendCommentResolutionMessage = vi.fn<any[], Promise<any>>();
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        notes: {
            sendCommentResolutionMessage: (...args: any[]) => mockSendCommentResolutionMessage(...args),
        },
    }),
}));

// ── Mock notesApi ──────────────────────────────────────────────────────────

const mockGetComments = vi.fn<any[], Promise<NoteSidecar>>();
const mockCreateThread = vi.fn<any[], Promise<{ thread: CommentThread }>>();
const mockUpdateThread = vi.fn<any[], Promise<{ thread: CommentThread }>>();
const mockDeleteThread = vi.fn<any[], Promise<void>>();
const mockAddComment = vi.fn<any[], Promise<{ comment: Comment }>>();
const mockEditComment = vi.fn<any[], Promise<{ comment: Comment }>>();
const mockDeleteComment = vi.fn<any[], Promise<void>>();

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getComments: (...args: any[]) => mockGetComments(...args),
        createThread: (...args: any[]) => mockCreateThread(...args),
        updateThread: (...args: any[]) => mockUpdateThread(...args),
        deleteThread: (...args: any[]) => mockDeleteThread(...args),
        addComment: (...args: any[]) => mockAddComment(...args),
        editComment: (...args: any[]) => mockEditComment(...args),
        deleteComment: (...args: any[]) => mockDeleteComment(...args),
    },
}));

import { useComments, type CommentFilter } from '../../../../src/server/spa/client/react/features/notes/editor/useComments';

// ── Fixtures ───────────────────────────────────────────────────────────────

const THREAD_OPEN: CommentThread = {
    id: 'thread-1',
    anchor: { quotedText: 'highlighted text here', prefix: 'some context before ', suffix: ' some context after' },
    status: 'open',
    comments: [
        { id: 'c1', content: 'This needs review', createdAt: '2024-01-15T10:00:00Z' },
        { id: 'c2', content: 'I agree', createdAt: '2024-01-15T10:05:00Z' },
    ],
    createdAt: '2024-01-15T10:00:00Z',
};

const THREAD_RESOLVED: CommentThread = {
    id: 'thread-2',
    anchor: { quotedText: 'another passage', prefix: 'before text ', suffix: ' after text' },
    status: 'resolved',
    comments: [
        { id: 'c3', content: 'Fixed the typo', createdAt: '2024-01-14T08:00:00Z' },
    ],
    createdAt: '2024-01-14T08:00:00Z',
};

const THREAD_OPEN_OLDER: CommentThread = {
    id: 'thread-3',
    anchor: { quotedText: 'older open text', prefix: '', suffix: '' },
    status: 'open',
    comments: [
        { id: 'c4', content: 'Older comment', createdAt: '2024-01-10T08:00:00Z' },
    ],
    createdAt: '2024-01-10T08:00:00Z',
};

const SAMPLE_SIDECAR: NoteSidecar = {
    noteId: 'Notebook1/Page1',
    threads: {
        'thread-1': THREAD_OPEN,
        'thread-2': THREAD_RESOLVED,
    },
};

function makeSidecar(threads: CommentThread[]): NoteSidecar {
    const map: Record<string, CommentThread> = {};
    for (const t of threads) map[t.id] = t;
    return { noteId: 'Notebook1/Page1', threads: map };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useComments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSendCommentResolutionMessage.mockResolvedValue({});
        mockGetComments.mockResolvedValue(SAMPLE_SIDECAR);
        mockCreateThread.mockImplementation(async (_wsId, _path, thread) => ({
            thread: { ...thread, id: 'thread-new' },
        }));
        mockUpdateThread.mockResolvedValue({ thread: THREAD_OPEN });
        mockDeleteThread.mockResolvedValue(undefined);
        mockAddComment.mockImplementation(async (_wsId, _path, _threadId, content) => ({
            comment: { id: 'c-server', content, createdAt: new Date().toISOString() },
        }));
        mockEditComment.mockResolvedValue({ comment: { id: 'c1', content: 'edited', createdAt: THREAD_OPEN.comments[0].createdAt } });
        mockDeleteComment.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // ── Loading ────────────────────────────────────────────────────────────

    describe('loading', () => {
        it('sets loading=true while fetching, then false', async () => {
            let resolveApi!: (val: NoteSidecar) => void;
            mockGetComments.mockImplementation(() => new Promise(r => { resolveApi = r; }));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            expect(result.current.loading).toBe(true);

            await act(async () => { resolveApi(SAMPLE_SIDECAR); });

            expect(result.current.loading).toBe(false);
        });

        it('loads threads when notePath is provided', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.threads.length).toBe(2);
        });

        it('returns empty threads when notePath is null', () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: null }),
            );

            expect(result.current.threads).toEqual([]);
            expect(result.current.loading).toBe(false);
            expect(mockGetComments).not.toHaveBeenCalled();
        });

        it('reloads threads when notePath changes', async () => {
            const { result, rerender } = renderHook(
                ({ path }) => useComments({ workspaceId: 'ws1', notePath: path }),
                { initialProps: { path: 'Notebook1/Page1' as string | null } },
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(mockGetComments).toHaveBeenCalledTimes(1);

            rerender({ path: 'Notebook1/Page2' });

            await waitFor(() => expect(mockGetComments).toHaveBeenCalledTimes(2));
        });

        it('calls notesApi.getComments with correct workspaceId and notePath', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws-abc', notePath: 'MyNotebook/Note1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(mockGetComments).toHaveBeenCalledWith('ws-abc', 'MyNotebook/Note1', undefined);
        });
    });

    // ── Filtering ──────────────────────────────────────────────────────────

    describe('filtering', () => {
        it('defaults to filter="all" showing all threads', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.filter).toBe('all');
            expect(result.current.threads.length).toBe(2);
        });

        it('allThreads returns all threads regardless of active filter', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            // Default filter = 'all': threads and allThreads should be identical length
            expect(result.current.allThreads.length).toBe(2);

            // Switch to 'open' filter: threads is filtered, allThreads is not
            act(() => { result.current.setFilter('open'); });
            expect(result.current.threads.length).toBe(1);
            expect(result.current.allThreads.length).toBe(2);
        });

        it('filters to open threads only', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.setFilter('open'); });

            expect(result.current.threads.length).toBe(1);
            expect(result.current.threads[0].status).toBe('open');
        });

        it('filters to resolved threads only', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.setFilter('resolved'); });

            expect(result.current.threads.length).toBe(1);
            expect(result.current.threads[0].status).toBe('resolved');
        });

        it('computes correct totalCount/openCount/resolvedCount regardless of active filter', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.totalCount).toBe(2);
            expect(result.current.openCount).toBe(1);
            expect(result.current.resolvedCount).toBe(1);

            act(() => { result.current.setFilter('open'); });

            // Counts should remain the same even when filtered
            expect(result.current.totalCount).toBe(2);
            expect(result.current.openCount).toBe(1);
            expect(result.current.resolvedCount).toBe(1);
        });
    });

    // ── Sorting ────────────────────────────────────────────────────────────

    describe('sorting', () => {
        it('sorts open threads before resolved', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            expect(result.current.threads[0].status).toBe('open');
            expect(result.current.threads[1].status).toBe('resolved');
        });

        it('sorts by newest createdAt first within each group', async () => {
            mockGetComments.mockResolvedValue(makeSidecar([THREAD_OPEN, THREAD_OPEN_OLDER, THREAD_RESOLVED]));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            // Open threads: thread-1 (Jan 15) before thread-3 (Jan 10)
            expect(result.current.threads[0].id).toBe('thread-1');
            expect(result.current.threads[1].id).toBe('thread-3');
            // Resolved last
            expect(result.current.threads[2].id).toBe('thread-2');
        });
    });

    // ── selectThread ───────────────────────────────────────────────────────

    describe('selectThread', () => {
        it('updates selectedThreadId', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.selectThread('thread-1'); });
            expect(result.current.selectedThreadId).toBe('thread-1');
        });

        it('calls onThreadSelect callback when provided', async () => {
            const onThreadSelect = vi.fn();
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1', onThreadSelect }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.selectThread('thread-1'); });
            expect(onThreadSelect).toHaveBeenCalledWith('thread-1');
        });

        it('clears selection with null', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.selectThread('thread-1'); });
            expect(result.current.selectedThreadId).toBe('thread-1');

            act(() => { result.current.selectThread(null); });
            expect(result.current.selectedThreadId).toBe(null);
        });
    });

    // ── createThread ───────────────────────────────────────────────────────

    describe('createThread', () => {
        it('calls notesApi.createThread and adds to local state', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            const anchor = { quotedText: 'new text', prefix: 'before ', suffix: ' after' };
            await act(async () => {
                await result.current.createThread(anchor, 'My comment');
            });

            expect(mockCreateThread).toHaveBeenCalledTimes(1);
            expect(result.current.threads.length).toBe(3);
        });

        it('selects the newly created thread', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.createThread(
                    { quotedText: 'text', prefix: '', suffix: '' },
                    'comment',
                );
            });

            expect(result.current.selectedThreadId).toBe('thread-new');
        });
    });

    // ── resolveThread ──────────────────────────────────────────────────────

    describe('resolveThread', () => {
        it('optimistically sets thread status to resolved', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            // thread-1 is open
            act(() => { result.current.setFilter('all'); });
            const openBefore = result.current.threads.find(t => t.id === 'thread-1');
            expect(openBefore?.status).toBe('open');

            await act(async () => { await result.current.resolveThread('thread-1'); });

            const after = result.current.threads.find(t => t.id === 'thread-1');
            expect(after?.status).toBe('resolved');
        });

        it('calls notesApi.updateThread', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.resolveThread('thread-1'); });

            expect(mockUpdateThread).toHaveBeenCalledWith('ws1', 'Notebook1/Page1', 'thread-1', 'resolved', undefined);
        });

        it('reverts on API failure and sets error', async () => {
            mockUpdateThread.mockRejectedValueOnce(new Error('Network error'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.resolveThread('thread-1'); });

            // Should revert to open
            const thread = result.current.threads.find(t => t.id === 'thread-1');
            expect(thread?.status).toBe('open');
            expect(result.current.error).toBe('Network error');
        });
    });

    // ── reopenThread ───────────────────────────────────────────────────────

    describe('reopenThread', () => {
        it('optimistically sets thread status to open', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.reopenThread('thread-2'); });

            const thread = result.current.threads.find(t => t.id === 'thread-2');
            expect(thread?.status).toBe('open');
        });

        it('calls notesApi.updateThread', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.reopenThread('thread-2'); });

            expect(mockUpdateThread).toHaveBeenCalledWith('ws1', 'Notebook1/Page1', 'thread-2', 'open', undefined);
        });

        it('reverts on API failure and sets error', async () => {
            mockUpdateThread.mockRejectedValueOnce(new Error('Server down'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.reopenThread('thread-2'); });

            const thread = result.current.threads.find(t => t.id === 'thread-2');
            expect(thread?.status).toBe('resolved');
            expect(result.current.error).toBe('Server down');
        });
    });

    // ── deleteThread ───────────────────────────────────────────────────────

    describe('deleteThread', () => {
        it('optimistically removes thread from list', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.threads.length).toBe(2);

            await act(async () => { await result.current.deleteThread('thread-1'); });

            expect(result.current.threads.length).toBe(1);
            expect(result.current.threads.find(t => t.id === 'thread-1')).toBeUndefined();
        });

        it('calls notesApi.deleteThread', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.deleteThread('thread-1'); });

            expect(mockDeleteThread).toHaveBeenCalledWith('ws1', 'Notebook1/Page1', 'thread-1', undefined);
        });

        it('clears selectedThreadId if deleted thread was selected', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            act(() => { result.current.selectThread('thread-1'); });
            expect(result.current.selectedThreadId).toBe('thread-1');

            await act(async () => { await result.current.deleteThread('thread-1'); });

            expect(result.current.selectedThreadId).toBe(null);
        });

        it('reverts on API failure and sets error', async () => {
            mockDeleteThread.mockRejectedValueOnce(new Error('Delete failed'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.deleteThread('thread-1'); });

            expect(result.current.threads.find(t => t.id === 'thread-1')).toBeDefined();
            expect(result.current.error).toBe('Delete failed');
        });
    });

    // ── addComment ─────────────────────────────────────────────────────────

    describe('addComment', () => {
        it('optimistically appends comment to thread', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            const threadBefore = result.current.threads.find(t => t.id === 'thread-1')!;
            const commentCountBefore = threadBefore.comments.length;

            await act(async () => { await result.current.addComment('thread-1', 'New reply'); });

            const threadAfter = result.current.threads.find(t => t.id === 'thread-1')!;
            expect(threadAfter.comments.length).toBe(commentCountBefore + 1);
        });

        it('calls notesApi.addComment with threadId and content', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.addComment('thread-1', 'New reply'); });

            expect(mockAddComment).toHaveBeenCalledWith('ws1', 'Notebook1/Page1', 'thread-1', 'New reply', undefined);
        });

        it('reverts on API failure', async () => {
            mockAddComment.mockRejectedValueOnce(new Error('Add failed'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            const commentCountBefore = result.current.threads.find(t => t.id === 'thread-1')!.comments.length;

            await act(async () => { await result.current.addComment('thread-1', 'Will fail'); });

            const commentCountAfter = result.current.threads.find(t => t.id === 'thread-1')!.comments.length;
            expect(commentCountAfter).toBe(commentCountBefore);
            expect(result.current.error).toBe('Add failed');
        });
    });

    // ── editComment ────────────────────────────────────────────────────────

    describe('editComment', () => {
        it('optimistically updates comment content', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.editComment('thread-1', 'c1', 'Updated text'); });

            const thread = result.current.threads.find(t => t.id === 'thread-1')!;
            const comment = thread.comments.find(c => c.id === 'c1')!;
            expect(comment.content).toBe('Updated text');
        });

        it('calls notesApi.editComment', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.editComment('thread-1', 'c1', 'Updated'); });

            expect(mockEditComment).toHaveBeenCalledWith('ws1', 'Notebook1/Page1', 'thread-1', 'c1', 'Updated', undefined);
        });

        it('reverts on API failure', async () => {
            mockEditComment.mockRejectedValueOnce(new Error('Edit failed'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.editComment('thread-1', 'c1', 'Will fail'); });

            const thread = result.current.threads.find(t => t.id === 'thread-1')!;
            const comment = thread.comments.find(c => c.id === 'c1')!;
            expect(comment.content).toBe('This needs review'); // original
            expect(result.current.error).toBe('Edit failed');
        });
    });

    // ── deleteComment ──────────────────────────────────────────────────────

    describe('deleteComment', () => {
        it('optimistically removes comment from thread', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.deleteComment('thread-1', 'c1'); });

            const thread = result.current.threads.find(t => t.id === 'thread-1')!;
            expect(thread.comments.find(c => c.id === 'c1')).toBeUndefined();
        });

        it('calls notesApi.deleteComment', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => { await result.current.deleteComment('thread-1', 'c2'); });

            expect(mockDeleteComment).toHaveBeenCalledWith('ws1', 'Notebook1/Page1', 'thread-1', 'c2', undefined);
        });

        it('reverts on API failure', async () => {
            mockDeleteComment.mockRejectedValueOnce(new Error('Delete comment failed'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            const commentCountBefore = result.current.threads.find(t => t.id === 'thread-1')!.comments.length;

            await act(async () => { await result.current.deleteComment('thread-1', 'c1'); });

            expect(result.current.threads.find(t => t.id === 'thread-1')!.comments.length).toBe(commentCountBefore);
            expect(result.current.error).toBe('Delete comment failed');
        });
    });

    // ── reload ─────────────────────────────────────────────────────────────

    describe('reload', () => {
        it('re-fetches threads from API', async () => {
            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(mockGetComments).toHaveBeenCalledTimes(1);

            await act(async () => { await result.current.reload(); });

            expect(mockGetComments).toHaveBeenCalledTimes(2);
        });

        it('clears error state', async () => {
            mockGetComments
                .mockRejectedValueOnce(new Error('First load failed'))
                .mockResolvedValue(SAMPLE_SIDECAR);

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.error).toBe('First load failed'));

            await act(async () => { await result.current.reload(); });

            expect(result.current.error).toBe(null);
            expect(result.current.threads.length).toBe(2);
        });
    });

    // ── Error handling ─────────────────────────────────────────────────────

    describe('error handling', () => {
        it('sets error when initial load fails', async () => {
            mockGetComments.mockRejectedValueOnce(new Error('Load error'));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));
            expect(result.current.error).toBe('Load error');
            expect(result.current.threads).toEqual([]);
        });

        it('clears error on successful reload', async () => {
            mockGetComments
                .mockRejectedValueOnce(new Error('Temp error'))
                .mockResolvedValue(SAMPLE_SIDECAR);

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1' }),
            );

            await waitFor(() => expect(result.current.error).toBe('Temp error'));

            await act(async () => { await result.current.reload(); });

            expect(result.current.error).toBe(null);
        });
    });

    // ── resolveWithAI (follow-up path) ─────────────────────────────────────

    describe('resolveWithAI follow-up path', () => {
        it('sends content (not message) key when posting to /processes/:id/message', async () => {
            mockGetComments.mockResolvedValue(makeSidecar([THREAD_OPEN]));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1', parentProcessId: 'proc-42' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.resolveWithAI('document body');
            });

            expect(mockSendCommentResolutionMessage).toHaveBeenCalledOnce();
            const [processId, body] = mockSendCommentResolutionMessage.mock.calls[0];
            expect(processId).toBe('proc-42');
            expect(body).toHaveProperty('content');
            expect(body).not.toHaveProperty('message');
            expect(typeof body.content).toBe('string');
            expect(body.content.length).toBeGreaterThan(0);
        });

        it('includes open thread quote and comment in the content', async () => {
            mockGetComments.mockResolvedValue(makeSidecar([THREAD_OPEN]));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1', parentProcessId: 'proc-42' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.resolveWithAI('document body');
            });

            const body = mockSendCommentResolutionMessage.mock.calls[0][1];
            expect(body.content).toContain('highlighted text here');
            expect(body.content).toContain('This needs review');
        });

        it('passes selectedMode in POST body when provided', async () => {
            mockGetComments.mockResolvedValue(makeSidecar([THREAD_OPEN]));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1', parentProcessId: 'proc-42', selectedMode: 'ask' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.resolveWithAI('document body');
            });

            const body = mockSendCommentResolutionMessage.mock.calls[0][1];
            expect(body.mode).toBe('ask');
        });

        it('omits mode from POST body when selectedMode is not provided', async () => {
            mockGetComments.mockResolvedValue(makeSidecar([THREAD_OPEN]));

            const { result } = renderHook(() =>
                useComments({ workspaceId: 'ws1', notePath: 'Notebook1/Page1', parentProcessId: 'proc-42' }),
            );

            await waitFor(() => expect(result.current.loading).toBe(false));

            await act(async () => {
                await result.current.resolveWithAI('document body');
            });

            const body = mockSendCommentResolutionMessage.mock.calls[0][1];
            expect(body).not.toHaveProperty('mode');
        });
    });
});
