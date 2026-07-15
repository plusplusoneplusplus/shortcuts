/**
 * Tests for TasksCommentBackend — adapts the tasks comment API to the
 * NoteEditorCommentBackend contract.
 */
/* @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    tasks: {
        listComments: vi.fn(),
        updateComment: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ tasks: mocks.tasks }),
    translateSpaCocClientError: (err: unknown) => { throw err; },
}));

import {
    createTasksCommentBackend,
    taskCommentToThread,
} from '../../../../src/server/spa/client/react/tasks/TasksCommentBackend';
import type { TaskComment } from '@plusplusoneplusplus/coc-client';

beforeEach(() => {
    vi.clearAllMocks();
});

const baseComment: TaskComment = {
    id: 'c1',
    taskId: 't1',
    selection: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 5 },
    selectedText: 'Hello',
    comment: 'looks good',
    status: 'open',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('taskCommentToThread', () => {
    it('maps minimal TaskComment fields into a CommentThread', () => {
        const thread = taskCommentToThread(baseComment);
        expect(thread).toEqual({
            id: 'c1',
            anchor: { quotedText: 'Hello', prefix: '', suffix: '' },
            status: 'open',
            comments: [
                { id: 'c1', content: 'looks good', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
            ],
            createdAt: '2026-01-01T00:00:00.000Z',
        });
    });

    it('uses anchor prefix/suffix/selectedText when present', () => {
        const tc: TaskComment = {
            ...baseComment,
            anchor: { selectedText: 'Hi', prefix: 'before ', suffix: ' after' },
        };
        const thread = taskCommentToThread(tc);
        expect(thread.anchor).toEqual({ quotedText: 'Hi', prefix: 'before ', suffix: ' after' });
    });

    it('flattens replies into the comments array', () => {
        const tc: TaskComment = {
            ...baseComment,
            replies: [
                { id: 'r1', author: 'alice', text: 'reply one', createdAt: '2026-01-03T00:00:00.000Z' },
                { id: 'r2', author: 'ai', text: 'reply two', createdAt: '2026-01-04T00:00:00.000Z', isAI: true },
            ],
        };
        const thread = taskCommentToThread(tc);
        expect(thread.comments).toHaveLength(3);
        expect(thread.comments[1]).toEqual({ id: 'r1', content: 'reply one', createdAt: '2026-01-03T00:00:00.000Z' });
        expect(thread.comments[2]).toEqual({ id: 'r2', content: 'reply two', createdAt: '2026-01-04T00:00:00.000Z' });
    });

    it('marks resolved threads with resolvedAt = updatedAt', () => {
        const tc: TaskComment = { ...baseComment, status: 'resolved' };
        const thread = taskCommentToThread(tc);
        expect(thread.status).toBe('resolved');
        expect(thread.resolvedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('omits resolvedAt for open threads', () => {
        const thread = taskCommentToThread(baseComment);
        expect(thread.resolvedAt).toBeUndefined();
    });
});

describe('createTasksCommentBackend', () => {
    it('loadThreads delegates to tasks.listComments and maps results', async () => {
        mocks.tasks.listComments.mockResolvedValueOnce([baseComment]);
        const backend = createTasksCommentBackend();

        const threads = await backend.loadThreads('ws1', 'docs/foo.md');

        expect(mocks.tasks.listComments).toHaveBeenCalledWith('ws1', 'docs/foo.md');
        expect(threads).toHaveLength(1);
        expect(threads[0].id).toBe('c1');
        expect(threads[0].anchor.quotedText).toBe('Hello');
    });

    it('loadThreads returns [] without calling the API when notePath is empty', async () => {
        const backend = createTasksCommentBackend();
        const threads = await backend.loadThreads('ws1', '');
        expect(threads).toEqual([]);
        expect(mocks.tasks.listComments).not.toHaveBeenCalled();
    });

    it('loadThreads returns [] when the API returns null/undefined', async () => {
        mocks.tasks.listComments.mockResolvedValueOnce(undefined as unknown as TaskComment[]);
        const backend = createTasksCommentBackend();
        const threads = await backend.loadThreads('ws1', 'docs/foo.md');
        expect(threads).toEqual([]);
    });

    it('updateThreadAnchor delegates to tasks.updateComment with status payload', async () => {
        mocks.tasks.updateComment.mockResolvedValueOnce({ ...baseComment, status: 'resolved' });
        const backend = createTasksCommentBackend();

        await backend.updateThreadAnchor('ws1', 'docs/foo.md', 'c1', 'resolved');

        expect(mocks.tasks.updateComment)
            .toHaveBeenCalledWith('ws1', 'docs/foo.md', 'c1', { status: 'resolved' });
    });

    it('accepts a notes root parameter without changing task comment routing', async () => {
        mocks.tasks.listComments.mockResolvedValueOnce([baseComment]);
        mocks.tasks.updateComment.mockResolvedValueOnce({ ...baseComment, status: 'resolved' });
        const backend = createTasksCommentBackend();

        const threads = await backend.loadThreads('ws1', 'docs/foo.md', 'task:primary');
        await backend.updateThreadAnchor('ws1', 'docs/foo.md', 'c1', 'resolved', 'task:primary');

        expect(threads).toHaveLength(1);
        expect(mocks.tasks.listComments).toHaveBeenCalledWith('ws1', 'docs/foo.md');
        expect(mocks.tasks.updateComment)
            .toHaveBeenCalledWith('ws1', 'docs/foo.md', 'c1', { status: 'resolved' });
    });

    it('updateThreadAnchor is a no-op when notePath is empty', async () => {
        const backend = createTasksCommentBackend();
        await backend.updateThreadAnchor('ws1', '', 'c1', 'open');
        expect(mocks.tasks.updateComment).not.toHaveBeenCalled();
    });
});
