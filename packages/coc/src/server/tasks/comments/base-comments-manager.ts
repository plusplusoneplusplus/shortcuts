/**
 * BaseCommentsManager — shared CRUD layer for comment managers.
 *
 * Eliminates the ~70% duplication between TaskCommentsManager and
 * DiffCommentsManager by providing generic, storage-key-agnostic
 * implementations of getComments, writeComments, updateComment,
 * deleteComment, getComment, addReply, and a protected addCommentCore
 * helper.
 *
 * Sub-classes must implement:
 *   - getWorkspaceDir(wsId)  — workspace-specific storage directory
 *   - buildStorage(comments) — wraps comments in the concrete storage envelope
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJSON } from '../../shared/fs-utils';

// ============================================================================
// Minimal base-type constraints
// ============================================================================

/** Minimal fields every comment must expose for base-class CRUD operations. */
export interface BaseComment {
    id: string;
    createdAt: string;
    updatedAt: string;
    replies?: BaseReply[];
}

/** Minimal fields every reply must expose. */
export interface BaseReply {
    id: string;
    author: string;
    text: string;
    createdAt: string;
    isAI?: boolean;
}

// ============================================================================
// Shared validation
// ============================================================================

/**
 * Validate a workspace ID to prevent path-traversal attacks.
 * Permits only alphanumerics, hyphens, and underscores.
 *
 * Single source of truth — both TaskCommentsManager and
 * DiffCommentsManager import this instead of defining their own copy.
 */
export function isValidWorkspaceId(wsId: string): boolean {
    return /^[a-zA-Z0-9_-]+$/.test(wsId) && !wsId.includes('..');
}

// ============================================================================
// BaseCommentsManager
// ============================================================================

/**
 * Abstract base class that provides storage-key-agnostic CRUD operations
 * for comment managers.
 *
 * @typeParam TComment - Concrete comment type (must extend BaseComment).
 * @typeParam TReply   - Concrete reply type (must extend BaseReply).
 */
export abstract class BaseCommentsManager<
    TComment extends BaseComment,
    TReply extends BaseReply = BaseReply,
> {
    /**
     * Return the directory that holds comment JSON files for `wsId`.
     * Called by getStorageFile, ensureWorkspaceDir, and getCommentCounts.
     */
    protected abstract getWorkspaceDir(wsId: string): string;

    /**
     * Wrap the comments array in the concrete storage envelope
     * (e.g. `{ comments, settings: DEFAULT_SETTINGS }`).
     * The result is serialised to JSON by writeComments.
     */
    protected abstract buildStorage(comments: TComment[]): unknown;

    // ------------------------------------------------------------------
    // File-system helpers
    // ------------------------------------------------------------------

    /** Get the storage file path for an opaque `key`. */
    protected getStorageFile(wsId: string, key: string): string {
        return path.join(this.getWorkspaceDir(wsId), `${key}.json`);
    }

    /** Ensure the workspace directory exists (synchronous). */
    protected ensureWorkspaceDir(wsId: string): void {
        const dir = this.getWorkspaceDir(wsId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    // ------------------------------------------------------------------
    // CRUD — read
    // ------------------------------------------------------------------

    /**
     * Read all comments for a given `key`.
     * Sub-classes may override (e.g. to add a legacy-path fallback).
     */
    async getComments(wsId: string, key: string): Promise<TComment[]> {
        const file = this.getStorageFile(wsId, key);
        if (!fs.existsSync(file)) return [];
        try {
            const content = await fs.promises.readFile(file, 'utf8');
            const storage = JSON.parse(content);
            return storage.comments || [];
        } catch {
            return [];
        }
    }

    /** Get a single comment by ID. Returns null if not found. */
    async getComment(wsId: string, key: string, id: string): Promise<TComment | null> {
        const comments = await this.getComments(wsId, key);
        return comments.find(c => c.id === id) ?? null;
    }

    // ------------------------------------------------------------------
    // CRUD — write
    // ------------------------------------------------------------------

    /**
     * Atomically write comments to the storage file for `key`.
     * Uses the shared atomicWriteJSON helper (tmp → rename).
     * atomicWriteJSON creates the parent directory automatically.
     */
    async writeComments(wsId: string, key: string, comments: TComment[]): Promise<void> {
        const file = this.getStorageFile(wsId, key);
        await atomicWriteJSON(file, this.buildStorage(comments));
    }

    /**
     * Shared core logic for adding a new comment.
     * Generates a UUID and ISO timestamps, then writes atomically.
     *
     * Sub-classes call this from their own `addComment` method, which
     * may compute the storage key from a type-specific argument (e.g.
     * DiffCommentContext) and/or inject extra fields (e.g. `ephemeral`).
     */
    protected async addCommentCore(
        wsId: string,
        key: string,
        commentData: Omit<TComment, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<TComment> {
        const comments = await this.getComments(wsId, key);
        const now = new Date().toISOString();
        const newComment = {
            ...commentData,
            id: crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
        } as TComment;
        comments.push(newComment);
        await this.writeComments(wsId, key, comments);
        return newComment;
    }

    /** Update an existing comment. Returns null if not found. */
    async updateComment(
        wsId: string,
        key: string,
        id: string,
        updates: Partial<Omit<TComment, 'id' | 'createdAt'>>
    ): Promise<TComment | null> {
        const comments = await this.getComments(wsId, key);
        const index = comments.findIndex(c => c.id === id);
        if (index === -1) return null;
        comments[index] = {
            ...comments[index],
            ...updates,
            id: comments[index].id,
            createdAt: comments[index].createdAt,
            updatedAt: new Date().toISOString(),
        };
        await this.writeComments(wsId, key, comments);
        return comments[index];
    }

    /** Delete a comment. Returns false if not found. */
    async deleteComment(wsId: string, key: string, id: string): Promise<boolean> {
        const comments = await this.getComments(wsId, key);
        const filtered = comments.filter(c => c.id !== id);
        if (filtered.length === comments.length) return false;
        await this.writeComments(wsId, key, filtered);
        return true;
    }

    /** Add a reply to a comment. Returns null if the comment is not found. */
    async addReply(
        wsId: string,
        key: string,
        id: string,
        replyData: { author: string; text: string; isAI?: boolean }
    ): Promise<TReply | null> {
        const comments = await this.getComments(wsId, key);
        const index = comments.findIndex(c => c.id === id);
        if (index === -1) return null;

        const reply = {
            id: crypto.randomUUID(),
            author: replyData.author,
            text: replyData.text,
            createdAt: new Date().toISOString(),
            isAI: replyData.isAI,
        } as TReply;

        if (!comments[index].replies) {
            comments[index].replies = [];
        }
        (comments[index].replies as TReply[]).push(reply);
        comments[index].updatedAt = new Date().toISOString();
        await this.writeComments(wsId, key, comments);
        return reply;
    }
}
