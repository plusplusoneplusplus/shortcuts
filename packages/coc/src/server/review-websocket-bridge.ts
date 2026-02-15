/**
 * Review WebSocket Bridge
 *
 * Connects CommentsManager change events to WebSocket broadcasts
 * so that browser tabs editing files receive real-time updates.
 *
 * Pure Node.js — no VS Code dependencies.
 */

import type { ReviewCommentsManager, CommentChangeEvent } from './review-handler';
import type { ProcessWebSocketServer } from './websocket';
import { toCommentSummary } from './websocket';

/**
 * Bridge CommentsManager change events to WebSocket file-scoped broadcasts.
 *
 * Each mutation in the CommentsManager emits a change event, which is
 * forwarded to all WebSocket clients subscribed to the affected file path.
 */
export function bridgeReviewToWebSocket(
    commentsManager: ReviewCommentsManager,
    wsServer: ProcessWebSocketServer,
): void {
    commentsManager.onDidChangeComments((event: CommentChangeEvent) => {
        switch (event.type) {
            case 'added':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-added',
                    filePath: event.filePath,
                    comment: toCommentSummary(event.comment),
                });
                break;
            case 'updated':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-updated',
                    filePath: event.filePath,
                    comment: toCommentSummary(event.comment),
                });
                break;
            case 'deleted':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-deleted',
                    filePath: event.filePath,
                    commentId: event.commentId,
                });
                break;
            case 'resolved':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comment-resolved',
                    filePath: event.filePath,
                    commentId: event.commentId,
                });
                break;
            case 'cleared':
                wsServer.broadcastFileEvent(event.filePath, {
                    type: 'comments-cleared',
                    filePath: event.filePath,
                    count: event.count,
                });
                break;
        }
    });
}
