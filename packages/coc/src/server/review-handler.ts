/**
 * Review Editor REST API Handler
 *
 * HTTP routes for listing markdown files, reading/writing comments,
 * and serving embedded images — all without VS Code.
 *
 * Uses a lightweight self-contained CommentsManager that reads/writes
 * the same `.vscode/md-comments.json` format as the extension.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

import type {
    MarkdownComment,
    CommentSelection,
    CommentStatus,
    CommentsConfig,
} from '@plusplusoneplusplus/pipeline-core';
import { DEFAULT_COMMENTS_CONFIG } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';
import { sendJSON, sendError, parseBody } from './api-handler';

// ============================================================================
// Lightweight CommentsManager (pure Node.js, no VS Code)
// ============================================================================

const CONFIG_FILE = 'md-comments.json';

/** Event emitted when comments change. */
export type CommentChangeEvent =
    | { type: 'added'; filePath: string; comment: MarkdownComment }
    | { type: 'updated'; filePath: string; comment: MarkdownComment }
    | { type: 'deleted'; filePath: string; commentId: string }
    | { type: 'resolved'; filePath: string; commentId: string }
    | { type: 'cleared'; filePath: string; count: number };

/**
 * Minimal file-backed CommentsManager for the standalone server.
 * Reads/writes the same `.vscode/md-comments.json` format as the VS Code extension.
 */
export class ReviewCommentsManager {
    private config: CommentsConfig;
    private readonly configPath: string;
    private readonly emitter = new EventEmitter();

    constructor(private readonly projectDir: string) {
        this.configPath = path.join(projectDir, '.vscode', CONFIG_FILE);
        this.config = { ...DEFAULT_COMMENTS_CONFIG, comments: [] };
    }

    /** Register a listener for comment change events. */
    onDidChangeComments(listener: (event: CommentChangeEvent) => void): () => void {
        this.emitter.on('change', listener);
        return () => { this.emitter.removeListener('change', listener); };
    }

    /** Load or reload comments from the JSON file on disk. */
    loadComments(): void {
        try {
            if (fs.existsSync(this.configPath)) {
                const raw = fs.readFileSync(this.configPath, 'utf-8');
                const parsed = JSON.parse(raw) as CommentsConfig;
                this.config = {
                    version: typeof parsed.version === 'number' ? parsed.version : 1,
                    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
                    settings: parsed.settings,
                };
            } else {
                this.config = { ...DEFAULT_COMMENTS_CONFIG, comments: [] };
            }
        } catch {
            this.config = { ...DEFAULT_COMMENTS_CONFIG, comments: [] };
        }
    }

    /** Persist the in-memory config to disk. */
    private saveComments(): void {
        const dir = path.dirname(this.configPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    }

    private generateId(): string {
        return `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private getRelativePath(filePath: string): string {
        return path.isAbsolute(filePath) ? path.relative(this.projectDir, filePath) : filePath;
    }

    addComment(
        filePath: string,
        selection: CommentSelection,
        selectedText: string,
        comment: string,
        author?: string,
        tags?: string[],
        mermaidContext?: unknown,
        type?: string,
    ): MarkdownComment {
        const now = new Date().toISOString();
        const newComment: MarkdownComment = {
            id: this.generateId(),
            filePath: this.getRelativePath(filePath),
            selection,
            selectedText,
            comment,
            status: 'open' as CommentStatus,
            type: (type || 'user') as any,
            createdAt: now,
            updatedAt: now,
            author,
            tags,
            mermaidContext: mermaidContext as any,
        };
        this.config.comments.push(newComment);
        this.saveComments();
        this.emitter.emit('change', { type: 'added', filePath: newComment.filePath, comment: newComment } as CommentChangeEvent);
        return newComment;
    }

    updateComment(commentId: string, updates: Partial<Pick<MarkdownComment, 'comment' | 'status' | 'tags'>>): MarkdownComment | undefined {
        const c = this.config.comments.find(x => x.id === commentId);
        if (!c) { return undefined; }
        const isResolve = updates.status === 'resolved' && c.status !== 'resolved';
        if (updates.comment !== undefined) { c.comment = updates.comment; }
        if (updates.status !== undefined) { c.status = updates.status; }
        if (updates.tags !== undefined) { c.tags = updates.tags; }
        c.updatedAt = new Date().toISOString();
        this.saveComments();
        if (isResolve) {
            this.emitter.emit('change', { type: 'resolved', filePath: c.filePath, commentId: c.id } as CommentChangeEvent);
        } else {
            this.emitter.emit('change', { type: 'updated', filePath: c.filePath, comment: c } as CommentChangeEvent);
        }
        return c;
    }

    deleteComment(commentId: string): boolean {
        const idx = this.config.comments.findIndex(x => x.id === commentId);
        if (idx === -1) { return false; }
        const removed = this.config.comments[idx];
        this.config.comments.splice(idx, 1);
        this.saveComments();
        this.emitter.emit('change', { type: 'deleted', filePath: removed.filePath, commentId: removed.id } as CommentChangeEvent);
        return true;
    }

    resolveComment(commentId: string): MarkdownComment | undefined {
        return this.updateComment(commentId, { status: 'resolved' as CommentStatus });
    }

    getCommentsForFile(filePath: string): MarkdownComment[] {
        const rel = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === rel);
    }

    getFilesWithComments(): string[] {
        const files = new Set<string>();
        for (const c of this.config.comments) { files.add(c.filePath); }
        return Array.from(files).sort();
    }

    getCommentCountForFile(filePath: string): number {
        const rel = this.getRelativePath(filePath);
        return this.config.comments.filter(c => c.filePath === rel).length;
    }
}

// ============================================================================
// Helpers
// ============================================================================

/** MIME types for images served by the image route. */
const IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
};

/**
 * Resolve a relative path safely within a base directory.
 * Returns `null` if the resolved path escapes the base (traversal attempt).
 */
export function safePath(projectDir: string, relativePath: string): string | null {
    const resolved = path.resolve(projectDir, relativePath);
    const base = path.resolve(projectDir);
    if (!resolved.startsWith(base + path.sep) && resolved !== base) {
        return null;
    }
    return resolved;
}

/** Directories to skip when walking for markdown files. */
const SKIP_DIRS = new Set(['node_modules', '.git']);

/**
 * Recursively collect `*.md` file paths under `dir`, relative to `rootDir`.
 * Skips `node_modules`, `.git`, and hidden directories.
 */
export function walkMarkdownFiles(rootDir: string, dir?: string): string[] {
    const target = dir ?? rootDir;
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(target, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
            continue;
        }
        const full = path.join(target, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkMarkdownFiles(rootDir, full));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            results.push(path.relative(rootDir, full));
        }
    }
    return results;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register review editor REST API routes.
 * Mutates the `routes` array in-place.
 *
 * @param routes - Route table to push routes into
 * @param projectDir - Root directory for the review file tree
 */
export function registerReviewRoutes(routes: Route[], projectDir: string): { commentsManager: ReviewCommentsManager } {
    const mgr = new ReviewCommentsManager(projectDir);
    mgr.loadComments();

    /** Refresh state from disk before handling a request. */
    function ensureReady(): void {
        mgr.loadComments();
    }

    // ------------------------------------------------------------------
    // GET /api/review/files — list markdown files with comment counts
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: '/api/review/files',
        handler: async (_req, res) => {
            ensureReady();
            const mdFiles = walkMarkdownFiles(projectDir);
            const filesWithComments = new Set(mgr.getFilesWithComments());
            const files = mdFiles.map(f => ({
                path: f,
                name: path.basename(f),
                commentCount: filesWithComments.has(f) ? mgr.getCommentCountForFile(f) : 0,
            }));
            sendJSON(res, 200, { files });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/review/files/:path/content — update file content
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/review\/files\/(.+)\/content$/,
        handler: async (req, res, match) => {
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (typeof body.content !== 'string') {
                return sendError(res, 400, 'Missing content field');
            }

            try {
                fs.writeFileSync(resolved, body.content, 'utf-8');
                sendJSON(res, 200, { ok: true });
            } catch {
                return sendError(res, 500, 'Failed to write file');
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/review/files/:path/comments/resolve-all
    // (must appear before the single-comment PATCH/DELETE regex)
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/review\/files\/(.+)\/comments\/resolve-all$/,
        handler: async (_req, res, match) => {
            ensureReady();
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            const comments = mgr.getCommentsForFile(filePath);
            let count = 0;
            for (const c of comments) {
                if (c.status === 'open') {
                    mgr.resolveComment(c.id);
                    count++;
                }
            }
            sendJSON(res, 200, { resolved: count });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/review/files/:path/comments — add comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/review\/files\/(.+)\/comments$/,
        handler: async (req, res, match) => {
            ensureReady();
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!body.selection || !body.selectedText || !body.comment) {
                return sendError(res, 400, 'Missing required fields: selection, selectedText, comment');
            }

            const comment = mgr.addComment(
                filePath,
                body.selection,
                body.selectedText,
                body.comment,
                body.author,
                body.tags,
                body.mermaidContext,
                body.type,
            );
            sendJSON(res, 201, comment);
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/review/files/:path/comments — delete all comments for file
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/review\/files\/(.+)\/comments$/,
        handler: async (_req, res, match) => {
            ensureReady();
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            const comments = mgr.getCommentsForFile(filePath);
            for (const c of comments) {
                mgr.deleteComment(c.id);
            }
            sendJSON(res, 200, { deleted: comments.length });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/review/files/:path/comments/:id — update comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/review\/files\/(.+)\/comments\/([^/]+)$/,
        handler: async (req, res, match) => {
            ensureReady();
            const filePath = decodeURIComponent(match![1]);
            const commentId = decodeURIComponent(match![2]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const updates: Record<string, any> = {};
            if (body.comment !== undefined) { updates.comment = body.comment; }
            if (body.status !== undefined) { updates.status = body.status; }
            if (body.tags !== undefined) { updates.tags = body.tags; }

            const updated = mgr.updateComment(commentId, updates);
            if (!updated) {
                return sendError(res, 404, `Comment not found: ${commentId}`);
            }
            sendJSON(res, 200, updated);
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/review/files/:path/comments/:id — delete comment
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/review\/files\/(.+)\/comments\/([^/]+)$/,
        handler: async (_req, res, match) => {
            ensureReady();
            const filePath = decodeURIComponent(match![1]);
            const commentId = decodeURIComponent(match![2]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            const deleted = mgr.deleteComment(commentId);
            if (!deleted) {
                return sendError(res, 404, `Comment not found: ${commentId}`);
            }
            res.writeHead(204);
            res.end();
        },
    });

    // ------------------------------------------------------------------
    // GET /api/review/files/:path — file content + comments
    // (must appear after more-specific POST/DELETE/PATCH regex routes)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/review\/files\/(.+)$/,
        handler: async (_req, res, match) => {
            ensureReady();
            const filePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, filePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let content: string;
            try {
                content = fs.readFileSync(resolved, 'utf-8');
            } catch {
                return sendError(res, 404, `File not found: ${filePath}`);
            }

            const comments = mgr.getCommentsForFile(filePath);
            sendJSON(res, 200, { path: filePath, content, comments });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/review/images/:path — serve image files
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/review\/images\/(.+)$/,
        handler: async (_req, res, match) => {
            const relativePath = decodeURIComponent(match![1]);
            const resolved = safePath(projectDir, relativePath);
            if (!resolved) {
                return sendError(res, 400, 'Invalid path');
            }

            let stat: fs.Stats;
            try {
                stat = fs.statSync(resolved);
            } catch {
                return sendError(res, 404, `Image not found: ${relativePath}`);
            }

            if (!stat.isFile()) {
                return sendError(res, 404, `Image not found: ${relativePath}`);
            }

            const ext = path.extname(resolved).toLowerCase();
            const mime = IMAGE_MIME[ext] || 'application/octet-stream';

            res.writeHead(200, {
                'Content-Type': mime,
                'Cache-Control': 'public, max-age=3600',
            });
            fs.createReadStream(resolved).pipe(res);
        },
    });

    return { commentsManager: mgr };
}
