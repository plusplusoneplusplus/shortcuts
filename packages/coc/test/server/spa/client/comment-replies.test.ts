/**
 * Tests for comment reply threading functionality
 *
 * Tests reply rendering, collapse/expand, AI reply badges,
 * reply input UI, and reply API client functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    renderCommentCardHTML,
    renderRepliesHTML,
} from '../../../../src/server/spa/client/task-comments-ui';
import {
    createReply,
    removeAllCommentListeners,
    CommentApiError,
    type CreateReplyRequest,
} from '../../../../src/server/spa/client/task-comments-client';
import type { TaskComment, TaskCommentReply } from '../../../../src/server/spa/client/task-comments-types';

// ============================================================================
// Test Helpers
// ============================================================================

function makeComment(overrides: Partial<TaskComment> = {}): TaskComment {
    return {
        id: 'c1',
        taskId: 'task-1',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello world',
        comment: 'Test comment',
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: 'Alice',
        ...overrides,
    };
}

function makeReply(overrides: Partial<TaskCommentReply> = {}): TaskCommentReply {
    return {
        id: 'r1',
        author: 'Bob',
        text: 'I agree with this',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

function mockFetchResponse(status: number, body: any): void {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : status === 201 ? 'Created' : 'Error',
        json: () => Promise.resolve(body),
    });
}

function mockFetchNetworkError(): void {
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
}

// Mock config
vi.mock('../../../../src/server/spa/client/config', () => ({
    getApiBase: () => '/api',
}));

// Mock pipeline-core
vi.mock('@plusplusoneplusplus/pipeline-core', () => ({
    createAnchorData: vi.fn(() => ({
        selectedText: 'test',
        contextBefore: 'before',
        contextAfter: 'after',
        originalLine: 1,
        textHash: 'abc123',
    })),
}));
vi.mock('@plusplusoneplusplus/pipeline-core/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

// ============================================================================
// Reply Rendering
// ============================================================================

describe('renderRepliesHTML', () => {
    it('returns empty string for empty replies', () => {
        expect(renderRepliesHTML([], 'c1')).toBe('');
    });

    it('renders single reply', () => {
        const replies = [makeReply()];
        const html = renderRepliesHTML(replies, 'c1');
        expect(html).toContain('comment-card__replies');
        expect(html).toContain('I agree with this');
        expect(html).toContain('Bob');
    });

    it('renders multiple replies in order', () => {
        const replies = [
            makeReply({ id: 'r1', text: 'First reply', author: 'Bob' }),
            makeReply({ id: 'r2', text: 'Second reply', author: 'Carol' }),
        ];
        const html = renderRepliesHTML(replies, 'c1');
        const firstIdx = html.indexOf('First reply');
        const secondIdx = html.indexOf('Second reply');
        expect(firstIdx).toBeLessThan(secondIdx);
    });

    it('shows collapse toggle when more than 2 replies', () => {
        const replies = [
            makeReply({ id: 'r1', text: 'Reply 1' }),
            makeReply({ id: 'r2', text: 'Reply 2' }),
            makeReply({ id: 'r3', text: 'Reply 3' }),
        ];
        const html = renderRepliesHTML(replies, 'c1');
        expect(html).toContain('comment-card__reply-toggle');
        expect(html).toContain('3 replies');
    });

    it('does not show toggle for 2 or fewer replies', () => {
        const replies = [
            makeReply({ id: 'r1' }),
            makeReply({ id: 'r2' }),
        ];
        const html = renderRepliesHTML(replies, 'c1');
        expect(html).not.toContain('comment-card__reply-toggle');
    });

    it('marks earlier replies as collapsed when > 2 replies', () => {
        const replies = [
            makeReply({ id: 'r1', text: 'Old reply' }),
            makeReply({ id: 'r2', text: 'Older reply' }),
            makeReply({ id: 'r3', text: 'Latest reply' }),
        ];
        const html = renderRepliesHTML(replies, 'c1');
        // First reply (r1) should have collapsed class
        expect(html).toContain('comment-card__reply--collapsed');
    });

    it('renders AI reply with special badge', () => {
        const replies = [
            makeReply({ id: 'r-ai', author: 'AI', text: 'AI suggestion', isAI: true }),
        ];
        const html = renderRepliesHTML(replies, 'c1');
        expect(html).toContain('comment-card__reply--ai');
        expect(html).toContain('\uD83E\uDD16 AI');
    });

    it('escapes HTML in reply text', () => {
        const replies = [
            makeReply({ text: '<script>alert("xss")</script>' }),
        ];
        const html = renderRepliesHTML(replies, 'c1');
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('includes reply ID as data attribute', () => {
        const replies = [makeReply({ id: 'reply-uuid-123' })];
        const html = renderRepliesHTML(replies, 'c1');
        expect(html).toContain('data-reply-id="reply-uuid-123"');
    });

    it('includes comment ID on replies container', () => {
        const replies = [makeReply()];
        const html = renderRepliesHTML(replies, 'my-comment-id');
        expect(html).toContain('data-comment-id="my-comment-id"');
    });
});

// ============================================================================
// Comment Card with Replies
// ============================================================================

describe('Comment card with replies', () => {
    it('renders replies section when comment has replies', () => {
        const comment = makeComment({
            replies: [makeReply({ text: 'A reply' })],
        });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-card__replies');
        expect(html).toContain('A reply');
    });

    it('renders reply input (hidden by default)', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-reply-input');
        expect(html).toContain('style="display:none"');
        expect(html).toContain('comment-reply-textarea');
    });

    it('reply button is present in footer', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('data-action="reply"');
    });

    it('does not render replies section when comment has no replies', () => {
        const comment = makeComment({ replies: [] });
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('comment-card__replies');
    });

    it('does not render replies when replies is undefined', () => {
        const comment = makeComment();
        delete (comment as any).replies;
        const html = renderCommentCardHTML({ comment });
        expect(html).not.toContain('comment-card__replies');
    });
});

// ============================================================================
// Reply API Client
// ============================================================================

describe('createReply', () => {
    beforeEach(() => {
        removeAllCommentListeners();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        removeAllCommentListeners();
    });

    it('sends POST request to replies endpoint', async () => {
        const reply = makeReply();
        mockFetchResponse(201, { reply });

        await createReply('ws1', 'task.md', 'c1', { text: 'My reply' });

        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            expect.stringContaining('/replies'),
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            })
        );
    });

    it('returns reply object on success', async () => {
        const expectedReply = makeReply({ id: 'new-reply', text: 'Reply text' });
        mockFetchResponse(201, { reply: expectedReply });

        const result = await createReply('ws1', 'task.md', 'c1', { text: 'Reply text' });
        expect(result.id).toBe('new-reply');
        expect(result.text).toBe('Reply text');
    });

    it('throws CommentApiError on 404', async () => {
        mockFetchResponse(404, { error: 'Comment not found' });

        await expect(
            createReply('ws1', 'task.md', 'c1', { text: 'Reply' })
        ).rejects.toThrow(CommentApiError);
    });

    it('throws on network error', async () => {
        mockFetchNetworkError();

        await expect(
            createReply('ws1', 'task.md', 'c1', { text: 'Reply' })
        ).rejects.toThrow('Network error');
    });

    it('includes author in request body', async () => {
        const reply = makeReply();
        mockFetchResponse(201, { reply });

        await createReply('ws1', 'task.md', 'c1', { text: 'Reply', author: 'Bob' });

        const fetchCall = (globalThis as any).fetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.author).toBe('Bob');
        expect(body.text).toBe('Reply');
    });
});
