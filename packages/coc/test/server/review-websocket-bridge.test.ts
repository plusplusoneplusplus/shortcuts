/**
 * Review WebSocket Bridge Tests
 *
 * Tests for bridgeReviewToWebSocket: verifies that CommentsManager
 * change events produce the correct broadcastFileEvent calls with
 * correct message types and file paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bridgeReviewToWebSocket } from '../../src/server/review-websocket-bridge';
import type { CommentChangeEvent } from '../../src/server/review-handler';
import type { MarkdownComment } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

function createMockComment(overrides: Partial<MarkdownComment> = {}): MarkdownComment {
    return {
        id: 'comment_1',
        filePath: 'docs/readme.md',
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment: 'test comment',
        status: 'open',
        type: 'user',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        ...overrides,
    };
}

interface MockCommentsManager {
    onDidChangeComments: (listener: (event: CommentChangeEvent) => void) => () => void;
    _emit: (event: CommentChangeEvent) => void;
}

function createMockCommentsManager(): MockCommentsManager {
    const listeners: Array<(event: CommentChangeEvent) => void> = [];
    return {
        onDidChangeComments: (listener) => {
            listeners.push(listener);
            return () => {
                const idx = listeners.indexOf(listener);
                if (idx >= 0) listeners.splice(idx, 1);
            };
        },
        _emit: (event) => {
            for (const l of listeners) l(event);
        },
    };
}

interface MockWsServer {
    broadcastFileEvent: ReturnType<typeof vi.fn>;
}

function createMockWsServer(): MockWsServer {
    return {
        broadcastFileEvent: vi.fn(),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('bridgeReviewToWebSocket', () => {
    let mgr: MockCommentsManager;
    let ws: MockWsServer;

    beforeEach(() => {
        mgr = createMockCommentsManager();
        ws = createMockWsServer();
        bridgeReviewToWebSocket(mgr as any, ws as any);
    });

    it('should broadcast comment-added on "added" event', () => {
        const comment = createMockComment();
        mgr._emit({ type: 'added', filePath: 'docs/readme.md', comment });

        expect(ws.broadcastFileEvent).toHaveBeenCalledOnce();
        expect(ws.broadcastFileEvent).toHaveBeenCalledWith('docs/readme.md', {
            type: 'comment-added',
            filePath: 'docs/readme.md',
            comment: expect.objectContaining({
                id: 'comment_1',
                filePath: 'docs/readme.md',
                comment: 'test comment',
            }),
        });
    });

    it('should broadcast comment-updated on "updated" event', () => {
        const comment = createMockComment({ comment: 'edited' });
        mgr._emit({ type: 'updated', filePath: 'docs/readme.md', comment });

        expect(ws.broadcastFileEvent).toHaveBeenCalledOnce();
        expect(ws.broadcastFileEvent).toHaveBeenCalledWith('docs/readme.md', {
            type: 'comment-updated',
            filePath: 'docs/readme.md',
            comment: expect.objectContaining({
                id: 'comment_1',
                comment: 'edited',
            }),
        });
    });

    it('should broadcast comment-deleted on "deleted" event', () => {
        mgr._emit({ type: 'deleted', filePath: 'docs/readme.md', commentId: 'comment_1' });

        expect(ws.broadcastFileEvent).toHaveBeenCalledOnce();
        expect(ws.broadcastFileEvent).toHaveBeenCalledWith('docs/readme.md', {
            type: 'comment-deleted',
            filePath: 'docs/readme.md',
            commentId: 'comment_1',
        });
    });

    it('should broadcast comment-resolved on "resolved" event', () => {
        mgr._emit({ type: 'resolved', filePath: 'src/index.ts', commentId: 'comment_2' });

        expect(ws.broadcastFileEvent).toHaveBeenCalledOnce();
        expect(ws.broadcastFileEvent).toHaveBeenCalledWith('src/index.ts', {
            type: 'comment-resolved',
            filePath: 'src/index.ts',
            commentId: 'comment_2',
        });
    });

    it('should broadcast comments-cleared on "cleared" event', () => {
        mgr._emit({ type: 'cleared', filePath: 'docs/guide.md', count: 5 });

        expect(ws.broadcastFileEvent).toHaveBeenCalledOnce();
        expect(ws.broadcastFileEvent).toHaveBeenCalledWith('docs/guide.md', {
            type: 'comments-cleared',
            filePath: 'docs/guide.md',
            count: 5,
        });
    });

    it('should use the filePath from the event for scoping', () => {
        const comment = createMockComment({ filePath: 'src/app.ts' });
        mgr._emit({ type: 'added', filePath: 'src/app.ts', comment });

        expect(ws.broadcastFileEvent.mock.calls[0][0]).toBe('src/app.ts');
    });

    it('should handle multiple events sequentially', () => {
        const comment = createMockComment();
        mgr._emit({ type: 'added', filePath: 'docs/readme.md', comment });
        mgr._emit({ type: 'deleted', filePath: 'docs/readme.md', commentId: 'comment_1' });

        expect(ws.broadcastFileEvent).toHaveBeenCalledTimes(2);
        expect(ws.broadcastFileEvent.mock.calls[0][1].type).toBe('comment-added');
        expect(ws.broadcastFileEvent.mock.calls[1][1].type).toBe('comment-deleted');
    });

    it('should strip non-summary fields from comment in added event', () => {
        const comment = createMockComment({
            anchor: { selectedText: 'x', contextBefore: '', contextAfter: '', originalLine: 1, textHash: 'abc' },
            mermaidContext: { diagramId: 'd1' },
        });
        mgr._emit({ type: 'added', filePath: 'docs/readme.md', comment });

        const sentComment = ws.broadcastFileEvent.mock.calls[0][1].comment;
        expect(sentComment).not.toHaveProperty('anchor');
        expect(sentComment).not.toHaveProperty('mermaidContext');
        expect(sentComment).toHaveProperty('id');
        expect(sentComment).toHaveProperty('selection');
    });
});
