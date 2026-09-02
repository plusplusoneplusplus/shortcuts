/**
 * Comments live in one `comments.json` array, so every mutation rewrites the
 * whole file. Add / set-status / delete therefore go through a single
 * {@link mutate} entry point: read, transform, write, all inside one call the
 * store wraps in the per-canvas lock. Two callers can no longer read the same
 * array and each write back their own version of it, dropping the other's edit.
 *
 * A malformed entry is dropped rather than handed to a caller that expects a
 * comment — an anchor or status of the wrong type would otherwise surface as a
 * broken comment card with no way to tell where it came from.
 */

import * as fs from 'fs';
import { CanvasLayout, COMMENTS_FILE } from './canvas-layout';
import { StagedCommit } from './canvas-atomic-write';
import { reportCanvasCorruption } from './canvas-diagnostics';
import { isValidCanvasId, type CanvasComment } from './canvas-types';

const COMMENT_STATUSES = new Set(['open', 'sent', 'resolved']);

function isCanvasComment(value: unknown): value is CanvasComment {
    if (!value || typeof value !== 'object') return false;
    const comment = value as Partial<CanvasComment>;
    return typeof comment.id === 'string'
        && typeof comment.body === 'string'
        && typeof comment.anchorText === 'string'
        && typeof comment.status === 'string'
        && COMMENT_STATUSES.has(comment.status);
}

export class CanvasCommentRepository {
    constructor(private readonly layout: CanvasLayout) {}

    /** Every well-formed comment on a canvas, in stored order. */
    read(workspaceId: string, canvasId: string): CanvasComment[] {
        if (!isValidCanvasId(canvasId)) return [];
        let parsed: unknown;
        try {
            parsed = JSON.parse(fs.readFileSync(this.layout.commentsPath(workspaceId, canvasId), 'utf-8'));
        } catch (error) {
            reportCanvasCorruption({ workspaceId, canvasId, role: 'comments', file: COMMENTS_FILE, error });
            return [];
        }
        if (!Array.isArray(parsed)) {
            reportCanvasCorruption({
                workspaceId,
                canvasId,
                role: 'comments',
                file: COMMENTS_FILE,
                error: new TypeError('comments.json is not an array'),
            });
            return [];
        }
        const comments = parsed.filter(isCanvasComment);
        if (comments.length !== parsed.length) {
            reportCanvasCorruption({
                workspaceId,
                canvasId,
                role: 'comments',
                file: COMMENTS_FILE,
                error: new TypeError('comments.json contains malformed entries'),
            });
        }
        return comments;
    }

    /**
     * Read the comments, hand them to `apply`, and persist the array it returns.
     * Returning `null` for `comments` means "nothing changed" — no write, no
     * new mtime, no chance of clobbering a concurrent edit for a no-op.
     */
    mutate<T>(
        workspaceId: string,
        canvasId: string,
        apply: (comments: CanvasComment[]) => { comments: CanvasComment[] | null; result: T },
    ): T {
        if (!isValidCanvasId(canvasId)) {
            return apply([]).result;
        }
        const { comments, result } = apply(this.read(workspaceId, canvasId));
        if (comments) {
            const staged = new StagedCommit();
            staged.stage(this.layout.commentsPath(workspaceId, canvasId), JSON.stringify(comments, null, 2));
            try {
                staged.commit();
            } catch (error) {
                staged.rollback();
                throw error;
            }
        }
        return result;
    }
}
