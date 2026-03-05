/**
 * Diff Comments Handler Tests
 *
 * Comprehensive tests for the diff comments REST API:
 * - DiffCommentsManager unit tests (CRUD, hashing, storage, ephemeral)
 * - REST API integration tests (GET, POST, PATCH, DELETE)
 * - Error handling and validation
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { DiffCommentsManager } from '../../src/server/diff-comments-handler';
import type { DiffCommentContext } from '@plusplusoneplusplus/pipeline-core';
import type { DiffComment } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// HTTP Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function getJSON(url: string) {
    return request(url);
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteRequest(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Test Fixtures
// ============================================================================

function makeContext(overrides: Partial<DiffCommentContext> = {}): DiffCommentContext {
    return {
        repositoryId: 'repo/test',
        oldRef: 'main',
        newRef: 'feature-branch',
        filePath: 'src/index.ts',
        ...overrides,
    };
}

function makeCommentData(
    ctx?: DiffCommentContext,
    overrides: Partial<Omit<DiffComment, 'id' | 'createdAt' | 'updatedAt' | 'ephemeral'>> = {}
): Omit<DiffComment, 'id' | 'createdAt' | 'updatedAt' | 'ephemeral'> {
    const context = ctx || makeContext();
    return {
        context,
        selection: {
            diffLineStart: 0,
            diffLineEnd: 2,
            side: 'added',
            startColumn: 0,
            endColumn: 10,
        },
        selectedText: 'export default',
        comment: 'This needs review',
        status: 'open',
        ...overrides,
    };
}

// ============================================================================
// Unit Tests — DiffCommentsManager
// ============================================================================

describe('DiffCommentsManager', () => {
    let tmpDir: string;
    let manager: DiffCommentsManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-diff-comments-unit-'));
        manager = new DiffCommentsManager(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // -- hashContext --

    describe('hashContext', () => {
        it('generates consistent hashes for the same context', () => {
            const ctx = makeContext();
            expect(manager.hashContext(ctx)).toBe(manager.hashContext(ctx));
        });

        it('generates different hashes for different newRef values', () => {
            const ctx1 = makeContext({ newRef: 'HEAD' });
            const ctx2 = makeContext({ newRef: 'feature-branch' });
            expect(manager.hashContext(ctx1)).not.toBe(manager.hashContext(ctx2));
        });

        it('uses different formula for working-tree newRef', () => {
            const normalCtx = makeContext({ newRef: 'HEAD' });
            const workingTreeCtx = makeContext({ newRef: 'working-tree' });
            // Both have the same repositoryId, oldRef, and filePath but different newRef
            expect(manager.hashContext(normalCtx)).not.toBe(manager.hashContext(workingTreeCtx));
        });

        it('produces a 64-character hex string', () => {
            const ctx = makeContext();
            expect(manager.hashContext(ctx)).toMatch(/^[0-9a-f]{64}$/);
        });

        it('working-tree hash is stable', () => {
            const ctx = makeContext({ newRef: 'working-tree' });
            expect(manager.hashContext(ctx)).toBe(manager.hashContext(ctx));
        });

        it('differs by filePath', () => {
            const ctx1 = makeContext({ filePath: 'src/a.ts' });
            const ctx2 = makeContext({ filePath: 'src/b.ts' });
            expect(manager.hashContext(ctx1)).not.toBe(manager.hashContext(ctx2));
        });

        it('differs by repositoryId', () => {
            const ctx1 = makeContext({ repositoryId: 'repo/A' });
            const ctx2 = makeContext({ repositoryId: 'repo/B' });
            expect(manager.hashContext(ctx1)).not.toBe(manager.hashContext(ctx2));
        });
    });

    // -- addComment --

    describe('addComment', () => {
        it('stores a comment with generated id and timestamps', async () => {
            const ctx = makeContext();
            const comment = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            expect(comment.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}/);
            expect(comment.createdAt).toBeTruthy();
            expect(comment.updatedAt).toBeTruthy();
            expect(comment.comment).toBe('This needs review');
        });

        it('does NOT set ephemeral for normal refs', async () => {
            const ctx = makeContext({ newRef: 'HEAD' });
            const comment = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            expect(comment.ephemeral).toBeUndefined();
        });

        it('sets ephemeral: true when newRef === working-tree', async () => {
            const ctx = makeContext({ newRef: 'working-tree' });
            const comment = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            expect(comment.ephemeral).toBe(true);
        });

        it('persists the comment to disk', async () => {
            const ctx = makeContext();
            await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const manager2 = new DiffCommentsManager(tmpDir);
            const storageKey = manager.hashContext(ctx);
            const comments = await manager2.getComments('ws1', storageKey);
            expect(comments).toHaveLength(1);
        });
    });

    // -- updateComment --

    describe('updateComment', () => {
        it('updates fields and bumps updatedAt', async () => {
            const ctx = makeContext();
            const created = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await new Promise(r => setTimeout(r, 10));
            const key = manager.hashContext(ctx);
            const updated = await manager.updateComment('ws1', key, created.id, {
                comment: 'Updated text',
                status: 'resolved',
            });
            expect(updated).not.toBeNull();
            expect(updated!.comment).toBe('Updated text');
            expect(updated!.status).toBe('resolved');
            expect(updated!.updatedAt).not.toBe(created.updatedAt);
        });

        it('preserves id and createdAt', async () => {
            const ctx = makeContext();
            const created = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const key = manager.hashContext(ctx);
            const updated = await manager.updateComment('ws1', key, created.id, {
                comment: 'Changed',
            });
            expect(updated!.id).toBe(created.id);
            expect(updated!.createdAt).toBe(created.createdAt);
        });

        it('returns null for unknown ID', async () => {
            const ctx = makeContext();
            const key = manager.hashContext(ctx);
            const result = await manager.updateComment('ws1', key, 'nonexistent-id', {
                comment: 'x',
            });
            expect(result).toBeNull();
        });
    });

    // -- deleteComment --

    describe('deleteComment', () => {
        it('removes a comment and returns true', async () => {
            const ctx = makeContext();
            const comment = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const key = manager.hashContext(ctx);
            const deleted = await manager.deleteComment('ws1', key, comment.id);
            expect(deleted).toBe(true);
            const remaining = await manager.getComments('ws1', key);
            expect(remaining).toHaveLength(0);
        });

        it('returns false for unknown ID', async () => {
            const ctx = makeContext();
            const key = manager.hashContext(ctx);
            const deleted = await manager.deleteComment('ws1', key, 'no-such-id');
            expect(deleted).toBe(false);
        });
    });

    // -- getComment --

    describe('getComment', () => {
        it('returns the correct comment', async () => {
            const ctx = makeContext();
            const c1 = await manager.addComment('ws1', ctx, makeCommentData(ctx, { comment: 'First' }));
            await manager.addComment('ws1', ctx, makeCommentData(ctx, { comment: 'Second' }));
            const key = manager.hashContext(ctx);
            const found = await manager.getComment('ws1', key, c1.id);
            expect(found).not.toBeNull();
            expect(found!.comment).toBe('First');
        });

        it('returns null for unknown ID', async () => {
            const ctx = makeContext();
            const key = manager.hashContext(ctx);
            const result = await manager.getComment('ws1', key, 'no-such-id');
            expect(result).toBeNull();
        });
    });

    // -- addReply --

    describe('addReply', () => {
        it('appends a reply to the correct comment', async () => {
            const ctx = makeContext();
            const comment = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const key = manager.hashContext(ctx);
            const reply = await manager.addReply('ws1', key, comment.id, {
                author: 'Alice',
                text: 'LGTM',
            });
            expect(reply).not.toBeNull();
            expect(reply!.author).toBe('Alice');
            expect(reply!.text).toBe('LGTM');
            expect(reply!.id).toMatch(/^[0-9a-f]{8}-/);
            const updated = await manager.getComment('ws1', key, comment.id);
            expect(updated!.replies).toHaveLength(1);
        });

        it('returns null for unknown comment ID', async () => {
            const ctx = makeContext();
            const key = manager.hashContext(ctx);
            const reply = await manager.addReply('ws1', key, 'no-such-id', {
                author: 'Bob',
                text: 'Test',
            });
            expect(reply).toBeNull();
        });

        it('marks AI replies', async () => {
            const ctx = makeContext();
            const comment = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const key = manager.hashContext(ctx);
            const reply = await manager.addReply('ws1', key, comment.id, {
                author: 'AI',
                text: 'Suggestion',
                isAI: true,
            });
            expect(reply!.isAI).toBe(true);
        });
    });

    // -- getCommentCounts --

    describe('getCommentCounts', () => {
        it('returns correct counts across multiple storage files', async () => {
            const ctx1 = makeContext({ filePath: 'src/a.ts' });
            const ctx2 = makeContext({ filePath: 'src/b.ts' });
            const key1 = manager.hashContext(ctx1);
            const key2 = manager.hashContext(ctx2);
            await manager.addComment('ws1', ctx1, makeCommentData(ctx1));
            await manager.addComment('ws1', ctx1, makeCommentData(ctx1));
            await manager.addComment('ws1', ctx2, makeCommentData(ctx2));
            const counts = await manager.getCommentCounts('ws1');
            expect(counts[key1]).toBe(2);
            expect(counts[key2]).toBe(1);
        });

        it('returns empty object for workspace with no files', async () => {
            const counts = await manager.getCommentCounts('ws-empty');
            expect(counts).toEqual({});
        });

        it('isolates workspaces', async () => {
            const ctx = makeContext();
            const key = manager.hashContext(ctx);
            await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.addComment('ws2', ctx, makeCommentData(ctx));
            await manager.addComment('ws2', ctx, makeCommentData(ctx));
            const counts1 = await manager.getCommentCounts('ws1');
            const counts2 = await manager.getCommentCounts('ws2');
            expect(counts1[key]).toBe(1);
            expect(counts2[key]).toBe(2);
        });
    });

    // -- listAllComments --

    describe('listAllComments', () => {
        it('flattens comments from multiple storage files', async () => {
            const ctx1 = makeContext({ filePath: 'src/a.ts' });
            const ctx2 = makeContext({ filePath: 'src/b.ts' });
            await manager.addComment('ws1', ctx1, makeCommentData(ctx1, { comment: 'A1' }));
            await manager.addComment('ws1', ctx1, makeCommentData(ctx1, { comment: 'A2' }));
            await manager.addComment('ws1', ctx2, makeCommentData(ctx2, { comment: 'B1' }));
            const all = await manager.listAllComments('ws1');
            expect(all).toHaveLength(3);
            const texts = all.map(c => c.comment).sort();
            expect(texts).toEqual(['A1', 'A2', 'B1']);
        });

        it('returns empty array for workspace with no comments', async () => {
            const all = await manager.listAllComments('ws-empty');
            expect(all).toEqual([]);
        });
    });

    // -- Atomic write --

    describe('Atomic write', () => {
        it('cleans up .tmp file when rename fails', async () => {
            const ctx = makeContext();
            // Ensure the workspace dir exists first so the write reaches the rename
            await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const key = manager.hashContext(ctx);
            const wsDir = path.join(tmpDir, 'diff-comments', 'ws1');
            const storageFile = path.join(wsDir, `${key}.json`);
            const tempFile = `${storageFile}.tmp`;

            // Mock fs.promises.rename to throw
            const original = fs.promises.rename;
            vi.spyOn(fs.promises, 'rename').mockRejectedValueOnce(new Error('rename failed'));

            await expect(
                manager.writeComments('ws1', key, [])
            ).rejects.toThrow('rename failed');

            // .tmp file should have been cleaned up
            expect(fs.existsSync(tempFile)).toBe(false);

            // Restore
            vi.restoreAllMocks();
        });
    });
});

// ============================================================================
// Integration Tests — REST API
// ============================================================================

describe('Diff Comments REST API', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-diff-comments-api-'));
        server = await createExecutionServer({ port: 0, dataDir: tmpDir });
        baseUrl = server.url;
    });

    afterEach(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const WS_ID = 'test-workspace';

    // We need a valid 64-character hex storage key for routes that need one.
    // Use a real manager to generate it in tests that need it.

    function collectionUrl() {
        return `${baseUrl}/api/diff-comments/${WS_ID}`;
    }

    function storageKeyUrl(key: string) {
        return `${baseUrl}/api/diff-comments/${WS_ID}/${key}`;
    }

    function itemUrl(key: string, id: string) {
        return `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id}`;
    }

    function replyUrl(key: string, id: string) {
        return `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id}/replies`;
    }

    function countsUrl() {
        return `${baseUrl}/api/diff-comment-counts/${WS_ID}`;
    }

    function makePostBody(ctxOverrides: Partial<DiffCommentContext> = {}) {
        const context = makeContext(ctxOverrides);
        return {
            context,
            selection: {
                diffLineStart: 0,
                diffLineEnd: 2,
                side: 'added',
                startColumn: 0,
                endColumn: 10,
            },
            selectedText: 'export default',
            comment: 'Needs review',
            status: 'open',
        };
    }

    // -- GET /api/diff-comment-counts/:wsId --

    describe('GET /api/diff-comment-counts/:wsId', () => {
        it('returns { counts } map', async () => {
            const res = await getJSON(countsUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.counts).toBeDefined();
            expect(typeof body.counts).toBe('object');
        });

        it('reflects created comments in counts', async () => {
            await postJSON(collectionUrl(), makePostBody({ filePath: 'src/a.ts' }));
            await postJSON(collectionUrl(), makePostBody({ filePath: 'src/a.ts' }));
            const res = await getJSON(countsUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const values = Object.values(body.counts as Record<string, number>);
            expect(values.some(v => v === 2)).toBe(true);
        });
    });

    // -- POST /api/diff-comments/:wsId — create comment --

    describe('POST /api/diff-comments/:wsId', () => {
        it('returns 201 and the created comment on valid body', async () => {
            const res = await postJSON(collectionUrl(), makePostBody());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.comment).toBeDefined();
            expect(body.comment.id).toMatch(/^[0-9a-f]{8}-/);
            expect(body.comment.comment).toBe('Needs review');
        });

        it('returns 400 when context is missing', async () => {
            const { context: _ctx, ...noCtx } = makePostBody();
            const res = await postJSON(collectionUrl(), noCtx);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('context');
        });

        it('returns 400 when context is invalid (missing filePath)', async () => {
            const data = makePostBody();
            delete (data.context as any).filePath;
            const res = await postJSON(collectionUrl(), data);
            expect(res.status).toBe(400);
        });

        it('returns 400 when selection is missing', async () => {
            const data = makePostBody();
            delete (data as any).selection;
            const res = await postJSON(collectionUrl(), data);
            expect(res.status).toBe(400);
        });

        it('returns 400 when selectedText is missing', async () => {
            const data = makePostBody();
            delete (data as any).selectedText;
            const res = await postJSON(collectionUrl(), data);
            expect(res.status).toBe(400);
        });

        it('returns 400 when comment is missing', async () => {
            const data = makePostBody();
            delete (data as any).comment;
            const res = await postJSON(collectionUrl(), data);
            expect(res.status).toBe(400);
        });

        it('returns 400 for invalid JSON', async () => {
            const res = await request(collectionUrl(), {
                method: 'POST',
                body: '{{bad',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('sets ephemeral: true for working-tree comments', async () => {
            const res = await postJSON(
                collectionUrl(),
                makePostBody({ newRef: 'working-tree' })
            );
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.comment.ephemeral).toBe(true);
        });
    });

    // -- GET /api/diff-comments/:wsId/:key — list by storage key --

    describe('GET /api/diff-comments/:wsId/:key', () => {
        it('returns { comments } for valid storage key', async () => {
            const manager = new DiffCommentsManager(tmpDir);
            const ctx = makeContext();
            const key = manager.hashContext(ctx);
            await postJSON(collectionUrl(), makePostBody());
            const res = await getJSON(storageKeyUrl(key));
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body.comments)).toBe(true);
            expect(body.comments).toHaveLength(1);
        });

        it('returns empty array for unknown key', async () => {
            const key = '0'.repeat(64);
            const res = await getJSON(storageKeyUrl(key));
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comments).toEqual([]);
        });
    });

    // -- PATCH /api/diff-comments/:wsId/:key/:id — update comment --

    describe('PATCH /api/diff-comments/:wsId/:key/:id', () => {
        it('returns 200 and updated comment on success', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await patchJSON(itemUrl(key, comment.id), {
                comment: 'Revised text',
                status: 'resolved',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comment.comment).toBe('Revised text');
            expect(body.comment.status).toBe('resolved');
        });

        it('returns 404 for unknown ID', async () => {
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const fakeId = '00000000-0000-0000-0000-000000000000';
            const res = await patchJSON(itemUrl(key, fakeId), { comment: 'x' });
            expect(res.status).toBe(404);
        });
    });

    // -- DELETE /api/diff-comments/:wsId/:key/:id — delete comment --

    describe('DELETE /api/diff-comments/:wsId/:key/:id', () => {
        it('returns 204 on successful deletion', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await deleteRequest(itemUrl(key, comment.id));
            expect(res.status).toBe(204);
        });

        it('returns 404 for unknown ID', async () => {
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const fakeId = '00000000-0000-0000-0000-000000000000';
            const res = await deleteRequest(itemUrl(key, fakeId));
            expect(res.status).toBe(404);
        });

        it('removes comment from storage after delete', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            await deleteRequest(itemUrl(key, comment.id));
            const listRes = await getJSON(storageKeyUrl(key));
            const body = JSON.parse(listRes.body);
            expect(body.comments).toHaveLength(0);
        });
    });

    // -- POST /api/diff-comments/:wsId/:key/:id/replies — add reply --

    describe('POST /api/diff-comments/:wsId/:key/:id/replies', () => {
        it('returns 201 and the reply on success', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await postJSON(replyUrl(key, comment.id), {
                author: 'Bob',
                text: 'Thanks!',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.reply.text).toBe('Thanks!');
            expect(body.reply.author).toBe('Bob');
        });

        it('returns 404 for unknown comment ID', async () => {
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const fakeId = '00000000-0000-0000-0000-000000000000';
            const res = await postJSON(replyUrl(key, fakeId), {
                author: 'Bob',
                text: 'Test',
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when text is missing', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await postJSON(replyUrl(key, comment.id), { author: 'Bob' });
            expect(res.status).toBe(400);
        });
    });

    // -- POST /api/diff-comments/:wsId/:key/:id/ask-ai — stub --

    describe('POST /api/diff-comments/:wsId/:key/:id/ask-ai', () => {
        it('returns 501 Not Implemented', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await postJSON(
                `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${comment.id}/ask-ai`,
                {}
            );
            expect(res.status).toBe(501);
        });
    });
});
