/**
 * Task Comments REST API Handler
 *
 * HTTP API routes for CRUD operations on task file comments.
 * Stores comments in JSON files under the CoC data directory,
 * compatible with the extension's comment storage format.
 *
 * Storage layout:
 *   {dataDir}/tasks-comments/{workspaceId}/{sha256(filePath)}.json
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { sendJSON, sendError, parseBody } from './api-handler';
import type { Route } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Comment on a task file, compatible with extension format.
 */
export interface TaskComment {
    /** Unique identifier (UUID). */
    id: string;
    /** Relative path to task file. */
    filePath: string;
    /** Selection range in the file. */
    selection: {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
    };
    /** The actual selected text. */
    selectedText: string;
    /** User's comment content. */
    comment: string;
    /** Current status. */
    status: 'open' | 'resolved' | 'pending';
    /** ISO timestamp when created. */
    createdAt: string;
    /** ISO timestamp when last updated. */
    updatedAt: string;
    /** Optional author name. */
    author?: string;
    /** Optional tags. */
    tags?: string[];
    /** Optional comment category. */
    category?: string;
    /** Optional anchor for robust location tracking. */
    anchor?: CommentAnchor;
}

/**
 * Anchor context for robust comment location tracking.
 */
export interface CommentAnchor {
    selectedText: string;
    contextBefore: string;
    contextAfter: string;
    originalLine: number;
    textHash: string;
}

/**
 * Storage format (matches extension's format).
 */
export interface CommentsStorage {
    comments: TaskComment[];
    settings: {
        showResolved: boolean;
        highlightColor: string;
    };
}

// ============================================================================
// Constants
// ============================================================================

/** Sub-directory name for task comments storage. */
const COMMENTS_DIR_NAME = 'tasks-comments';

/** Default settings for new comment storage files. */
const DEFAULT_SETTINGS: CommentsStorage['settings'] = {
    showResolved: true,
    highlightColor: '#ffeb3b',
};

// ============================================================================
// TaskCommentsManager
// ============================================================================

/**
 * Manages task comments storage and operations.
 * Mirrors extension's CommentsManager but for server-side use.
 */
export class TaskCommentsManager {
    private readonly commentsRoot: string;

    /**
     * @param dataDir - Root data directory (e.g. ~/.coc)
     */
    constructor(dataDir: string) {
        this.commentsRoot = path.join(dataDir, COMMENTS_DIR_NAME);
    }

    /** Get comments directory for a workspace. */
    private getWorkspaceDir(workspaceId: string): string {
        return path.join(this.commentsRoot, workspaceId);
    }

    /**
     * Hash file path to create storage filename.
     * Uses SHA-256 for consistent, collision-resistant hashes.
     */
    hashFilePath(filePath: string): string {
        return crypto.createHash('sha256').update(filePath).digest('hex');
    }

    /** Get storage file path for a task file. */
    private getStorageFile(workspaceId: string, taskPath: string): string {
        const hash = this.hashFilePath(taskPath);
        return path.join(this.getWorkspaceDir(workspaceId), `${hash}.json`);
    }

    /** Ensure workspace directory exists. */
    private ensureWorkspaceDir(workspaceId: string): void {
        const dir = this.getWorkspaceDir(workspaceId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    /** Read all comments for a task file. */
    async getComments(workspaceId: string, taskPath: string): Promise<TaskComment[]> {
        const file = this.getStorageFile(workspaceId, taskPath);
        if (!fs.existsSync(file)) {
            return [];
        }
        try {
            const content = await fs.promises.readFile(file, 'utf8');
            const storage: CommentsStorage = JSON.parse(content);
            return storage.comments || [];
        } catch {
            return [];
        }
    }

    /** Write comments to storage atomically (write to temp file then rename). */
    private async writeComments(
        workspaceId: string,
        taskPath: string,
        comments: TaskComment[]
    ): Promise<void> {
        this.ensureWorkspaceDir(workspaceId);
        const file = this.getStorageFile(workspaceId, taskPath);
        const storage: CommentsStorage = {
            comments,
            settings: DEFAULT_SETTINGS,
        };
        const tempFile = `${file}.tmp`;
        try {
            await fs.promises.writeFile(tempFile, JSON.stringify(storage, null, 2), 'utf8');
            await fs.promises.rename(tempFile, file);
        } catch (error) {
            // Clean up temp file on error
            try { await fs.promises.unlink(tempFile); } catch { /* ignore */ }
            throw error;
        }
    }

    /** Add a new comment. */
    async addComment(
        workspaceId: string,
        taskPath: string,
        commentData: Omit<TaskComment, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<TaskComment> {
        const comments = await this.getComments(workspaceId, taskPath);
        const now = new Date().toISOString();
        const newComment: TaskComment = {
            ...commentData,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
        };
        comments.push(newComment);
        await this.writeComments(workspaceId, taskPath, comments);
        return newComment;
    }

    /** Update an existing comment. Returns null if not found. */
    async updateComment(
        workspaceId: string,
        taskPath: string,
        commentId: string,
        updates: Partial<Omit<TaskComment, 'id' | 'createdAt'>>
    ): Promise<TaskComment | null> {
        const comments = await this.getComments(workspaceId, taskPath);
        const index = comments.findIndex(c => c.id === commentId);
        if (index === -1) {
            return null;
        }
        comments[index] = {
            ...comments[index],
            ...updates,
            id: comments[index].id,
            createdAt: comments[index].createdAt,
            updatedAt: new Date().toISOString(),
        };
        await this.writeComments(workspaceId, taskPath, comments);
        return comments[index];
    }

    /** Delete a comment. Returns false if not found. */
    async deleteComment(
        workspaceId: string,
        taskPath: string,
        commentId: string
    ): Promise<boolean> {
        const comments = await this.getComments(workspaceId, taskPath);
        const filtered = comments.filter(c => c.id !== commentId);
        if (filtered.length === comments.length) {
            return false;
        }
        await this.writeComments(workspaceId, taskPath, filtered);
        return true;
    }

    /** Get a single comment by ID. Returns null if not found. */
    async getComment(
        workspaceId: string,
        taskPath: string,
        commentId: string
    ): Promise<TaskComment | null> {
        const comments = await this.getComments(workspaceId, taskPath);
        return comments.find(c => c.id === commentId) || null;
    }

    /** Delete all comments for a task file. */
    async deleteAllComments(workspaceId: string, taskPath: string): Promise<void> {
        const file = this.getStorageFile(workspaceId, taskPath);
        if (fs.existsSync(file)) {
            await fs.promises.unlink(file);
        }
    }

    /**
     * Get comment counts for all task files in a workspace.
     * Returns a map of filePath → comment count.
     */
    async getCommentCounts(workspaceId: string): Promise<Record<string, number>> {
        const wsDir = this.getWorkspaceDir(workspaceId);
        if (!fs.existsSync(wsDir)) {
            return {};
        }
        const counts: Record<string, number> = {};
        let entries: string[];
        try {
            entries = await fs.promises.readdir(wsDir);
        } catch {
            return {};
        }
        for (const entry of entries) {
            if (!entry.endsWith('.json')) continue;
            try {
                const content = await fs.promises.readFile(path.join(wsDir, entry), 'utf8');
                const storage: CommentsStorage = JSON.parse(content);
                const comments = storage.comments || [];
                if (comments.length > 0 && comments[0].filePath) {
                    counts[comments[0].filePath] = comments.length;
                }
            } catch {
                // Skip corrupted files
            }
        }
        return counts;
    }
}

// ============================================================================
// Validation Helpers
// ============================================================================

/** Required fields for creating a comment. */
const REQUIRED_FIELDS = ['filePath', 'selection', 'selectedText', 'comment', 'status'] as const;

/** Validate that the comment body has all required fields. Returns the missing field name or null. */
function findMissingField(body: any): string | null {
    for (const field of REQUIRED_FIELDS) {
        if (body[field] === undefined || body[field] === null) {
            return field;
        }
    }
    return null;
}

/** Validate workspace ID to prevent path traversal. */
function isValidWorkspaceId(wsId: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(wsId) && !wsId.includes('..');
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register task comments API routes on the given route table.
 * Mutates the `routes` array in-place.
 *
 * Endpoints:
 *   GET    /api/comment-counts/:wsId                   — comment counts per file
 *   GET    /api/comments/:wsId/:taskPath(*)           — list comments
 *   POST   /api/comments/:wsId/:taskPath(*)           — create comment
 *   GET    /api/comments/:wsId/:taskPath(*)/:id       — get single comment
 *   PATCH  /api/comments/:wsId/:taskPath(*)/:id       — update comment
 *   DELETE /api/comments/:wsId/:taskPath(*)/:id       — delete comment
 *
 * @param routes - Shared route table
 * @param dataDir - Directory for comment storage (e.g. ~/.coc)
 */
export function registerTaskCommentsRoutes(routes: Route[], dataDir: string): void {
    const manager = new TaskCommentsManager(dataDir);

    // Pattern for comment counts endpoint: /api/comment-counts/{wsId}
    const countsPattern = /^\/api\/comment-counts\/([a-zA-Z0-9_-]+)$/;

    // Pattern for collection endpoints: /api/comments/{wsId}/{taskPath...}
    // taskPath is everything after the wsId segment, captured greedily.
    const collectionPattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)$/;

    // Pattern for item endpoints: /api/comments/{wsId}/{taskPath...}/{uuid}
    // UUID is a standard v4 UUID at the end of the path.
    const itemPattern = /^\/api\/comments\/([a-zA-Z0-9_-]+)\/(.+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

    // ------------------------------------------------------------------
    // GET /api/comment-counts/:wsId — comment counts per file
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: countsPattern,
        handler: async (_req, res, match) => {
            const [, wsId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const counts = await manager.getCommentCounts(wsId);
                sendJSON(res, 200, { counts });
            } catch {
                sendError(res, 500, 'Failed to retrieve comment counts');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/comments/:wsId/:taskPath(*)/:id — single comment
    // (Must be before the collection GET to avoid greedy match)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: itemPattern,
        handler: async (_req, res, match) => {
            const [, wsId, taskPath, commentId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const comment = await manager.getComment(wsId, taskPath, commentId);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }
                sendJSON(res, 200, { comment });
            } catch {
                sendError(res, 500, 'Failed to retrieve comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/comments/:wsId/:taskPath(*) — list all comments
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: collectionPattern,
        handler: async (_req, res, match) => {
            const [, wsId, taskPath] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const comments = await manager.getComments(wsId, taskPath);
                sendJSON(res, 200, { comments });
            } catch {
                sendError(res, 500, 'Failed to retrieve comments');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/comments/:wsId/:taskPath(*) — create comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: collectionPattern,
        handler: async (req, res, match) => {
            const [, wsId, taskPath] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            const missing = findMissingField(body);
            if (missing) {
                return sendError(res, 400, `Missing required field: ${missing}`);
            }
            try {
                const comment = await manager.addComment(wsId, taskPath, body);
                sendJSON(res, 201, { comment });
            } catch {
                sendError(res, 500, 'Failed to create comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/comments/:wsId/:taskPath(*)/:id — update comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: itemPattern,
        handler: async (req, res, match) => {
            const [, wsId, taskPath, commentId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }
            try {
                const comment = await manager.updateComment(wsId, taskPath, commentId, body);
                if (!comment) {
                    return sendError(res, 404, 'Comment not found');
                }
                sendJSON(res, 200, { comment });
            } catch {
                sendError(res, 500, 'Failed to update comment');
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/comments/:wsId/:taskPath(*)/:id — delete comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: itemPattern,
        handler: async (_req, res, match) => {
            const [, wsId, taskPath, commentId] = match!;
            if (!isValidWorkspaceId(wsId)) {
                return sendError(res, 400, 'Invalid workspace ID');
            }
            try {
                const deleted = await manager.deleteComment(wsId, taskPath, commentId);
                if (!deleted) {
                    return sendError(res, 404, 'Comment not found');
                }
                res.writeHead(204);
                res.end();
            } catch {
                sendError(res, 500, 'Failed to delete comment');
            }
        },
    });
}
