/**
 * Tests for comment AI ask functionality
 *
 * Tests AI ask UI rendering, API client, loading states,
 * error handling, and AI response display.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    renderCommentCardHTML,
    renderAILoadingHTML,
} from '../../../../src/server/spa/client/task-comments-ui';
import {
    askAI,
    removeAllCommentListeners,
    CommentApiError,
    type AskAIRequest,
    type AskAIResponse,
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
        author: 'AI',
        text: 'AI generated response',
        createdAt: new Date().toISOString(),
        isAI: true,
        ...overrides,
    };
}

function mockFetchResponse(status: number, body: any): void {
    (globalThis as any).fetch = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
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
// AI Ask Button on Comment Card
// ============================================================================

describe('Comment card Ask AI button', () => {
    it('renders Ask AI button on non-readonly card', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('data-action="ask-ai"');
        expect(html).toContain('Ask AI');
    });

    it('does not render Ask AI button on readonly card', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment, readonly: true });
        expect(html).not.toContain('data-action="ask-ai"');
    });

    it('Ask AI button has accessible aria-label', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('aria-label="Ask AI"');
    });

    it('Ask AI button has robot emoji', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('\uD83E\uDD16');
    });
});

// ============================================================================
// AI Input Panel
// ============================================================================

describe('AI input panel in comment card', () => {
    it('renders AI input panel (hidden by default)', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-ai-input');
        expect(html).toContain('comment-ai-textarea');
    });

    it('AI input has appropriate placeholder', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('Ask AI a question');
    });

    it('AI input has send button', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-ai-send-btn');
        expect(html).toContain('Ask');
    });

    it('AI input has cancel button', () => {
        const comment = makeComment();
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-ai-cancel-btn');
    });
});

// ============================================================================
// AI Loading State
// ============================================================================

describe('renderAILoadingHTML', () => {
    it('renders loading spinner', () => {
        const html = renderAILoadingHTML();
        expect(html).toContain('comment-ai-loading');
        expect(html).toContain('comment-ai-spinner');
    });

    it('shows thinking message', () => {
        const html = renderAILoadingHTML();
        expect(html).toContain('AI is thinking');
    });
});

// ============================================================================
// AI Ask API Client
// ============================================================================

describe('askAI', () => {
    beforeEach(() => {
        removeAllCommentListeners();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        removeAllCommentListeners();
    });

    it('sends POST request to ask-ai endpoint', async () => {
        const response: AskAIResponse = {
            aiResponse: 'AI says hello',
            reply: makeReply(),
        };
        mockFetchResponse(200, response);

        await askAI('ws1', 'task.md', 'c1', { question: 'What does this do?' });

        expect((globalThis as any).fetch).toHaveBeenCalledWith(
            expect.stringContaining('/ask-ai'),
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            })
        );
    });

    it('returns AI response and reply on success', async () => {
        const response: AskAIResponse = {
            aiResponse: 'This code does X',
            reply: makeReply({ text: 'This code does X' }),
        };
        mockFetchResponse(200, response);

        const result = await askAI('ws1', 'task.md', 'c1');
        expect(result.aiResponse).toBe('This code does X');
        expect(result.reply).toBeDefined();
        expect(result.reply.isAI).toBe(true);
    });

    it('includes question in request body', async () => {
        mockFetchResponse(200, { aiResponse: 'response', reply: makeReply() });

        await askAI('ws1', 'task.md', 'c1', { question: 'Explain this code' });

        const fetchCall = (globalThis as any).fetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body.question).toBe('Explain this code');
    });

    it('works without question (uses default)', async () => {
        mockFetchResponse(200, { aiResponse: 'response', reply: makeReply() });

        await askAI('ws1', 'task.md', 'c1');

        const fetchCall = (globalThis as any).fetch.mock.calls[0];
        const body = JSON.parse(fetchCall[1].body);
        expect(body).toEqual({});
    });

    it('throws CommentApiError on 404 (comment not found)', async () => {
        mockFetchResponse(404, { error: 'Comment not found' });

        await expect(
            askAI('ws1', 'task.md', 'c1')
        ).rejects.toThrow(CommentApiError);
    });

    it('throws CommentApiError on 502 (AI failed)', async () => {
        mockFetchResponse(502, { error: 'AI request failed' });

        await expect(
            askAI('ws1', 'task.md', 'c1')
        ).rejects.toThrow(CommentApiError);
    });

    it('throws CommentApiError on 503 (AI unavailable)', async () => {
        mockFetchResponse(503, { error: 'AI service unavailable' });

        await expect(
            askAI('ws1', 'task.md', 'c1')
        ).rejects.toThrow(CommentApiError);
    });

    it('throws on network error', async () => {
        mockFetchNetworkError();

        await expect(
            askAI('ws1', 'task.md', 'c1')
        ).rejects.toThrow('Network error');
    });
});

// ============================================================================
// AI Response Rendering
// ============================================================================

describe('AI response in comment card', () => {
    it('AI reply renders with AI badge class', () => {
        const comment = makeComment({
            aiResponse: 'AI explanation',
            replies: [makeReply({ isAI: true, text: 'AI explanation' })],
        });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('comment-card__reply--ai');
    });

    it('AI reply shows robot emoji author', () => {
        const comment = makeComment({
            replies: [makeReply({ isAI: true, author: 'AI' })],
        });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('\uD83E\uDD16 AI');
    });

    it('mixed human and AI replies render correctly', () => {
        const comment = makeComment({
            replies: [
                { id: 'r1', author: 'Bob', text: 'Human reply', createdAt: new Date().toISOString() },
                { id: 'r2', author: 'AI', text: 'AI reply', createdAt: new Date().toISOString(), isAI: true },
            ],
        });
        const html = renderCommentCardHTML({ comment });
        expect(html).toContain('Human reply');
        expect(html).toContain('AI reply');
        expect(html).toContain('comment-card__reply--ai');
    });
});
