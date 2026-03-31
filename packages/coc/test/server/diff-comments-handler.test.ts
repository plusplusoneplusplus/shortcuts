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
import type { DiffCommentContext } from '@plusplusoneplusplus/forge';
import type { DiffComment } from '@plusplusoneplusplus/forge';

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

        it('filters by status: only open comments are counted', async () => {
            const ctx = makeContext({ filePath: 'src/status-test.ts' });
            const key = manager.hashContext(ctx);
            const c1 = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.addComment('ws1', ctx, makeCommentData(ctx)); // second stays open
            await manager.updateComment('ws1', key, c1.id, { status: 'resolved' });

            const allCounts = await manager.getCommentCounts('ws1');
            expect(allCounts[key]).toBe(2); // unfiltered: both

            const openCounts = await manager.getCommentCounts('ws1', { statuses: ['open'] });
            expect(openCounts[key]).toBe(1); // only the open one
        });

        it('filters by newRef: excludes comments with different newRef', async () => {
            const ctxFeature = makeContext({ newRef: 'feature', filePath: 'src/refs.ts' });
            const ctxOther  = makeContext({ newRef: 'other',   filePath: 'src/refs.ts' });
            await manager.addComment('ws1', ctxFeature, makeCommentData(ctxFeature));
            await manager.addComment('ws1', ctxOther,   makeCommentData(ctxOther));

            const counts = await manager.getCommentCounts('ws1', { newRef: 'feature' });
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            expect(total).toBe(1);
        });

        it('excludes storage files with zero matching comments from result', async () => {
            const ctx = makeContext({ filePath: 'src/empty-match.ts' });
            const key = manager.hashContext(ctx);
            const c = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.updateComment('ws1', key, c.id, { status: 'resolved' });

            const counts = await manager.getCommentCounts('ws1', { statuses: ['open'] });
            expect(counts[key]).toBeUndefined(); // 0 matches → not included
        });
    });

    // -- getCommentTotals --

    describe('getCommentTotals', () => {
        it('returns totals grouped by newRef (commitHash)', async () => {
            const ctx1 = makeContext({ newRef: 'abc123', filePath: 'src/a.ts' });
            const ctx2 = makeContext({ newRef: 'abc123', filePath: 'src/b.ts' });
            const ctx3 = makeContext({ newRef: 'def456', filePath: 'src/c.ts' });
            await manager.addComment('ws1', ctx1, makeCommentData(ctx1));
            await manager.addComment('ws1', ctx2, makeCommentData(ctx2));
            await manager.addComment('ws1', ctx3, makeCommentData(ctx3));

            const totals = await manager.getCommentTotals('ws1', ['abc123', 'def456']);
            expect(totals['abc123']).toBe(2);
            expect(totals['def456']).toBe(1);
        });

        it('only returns hashes that are in the requested list', async () => {
            const ctx = makeContext({ newRef: 'abc123', filePath: 'src/a.ts' });
            await manager.addComment('ws1', ctx, makeCommentData(ctx));

            const totals = await manager.getCommentTotals('ws1', ['other-hash']);
            expect(totals['abc123']).toBeUndefined();
            expect(Object.keys(totals)).toHaveLength(0);
        });

        it('returns empty object for empty commitHashes array', async () => {
            const ctx = makeContext({ newRef: 'abc123' });
            await manager.addComment('ws1', ctx, makeCommentData(ctx));
            const totals = await manager.getCommentTotals('ws1', []);
            expect(totals).toEqual({});
        });

        it('returns empty object for workspace with no files', async () => {
            const totals = await manager.getCommentTotals('ws-empty', ['abc123']);
            expect(totals).toEqual({});
        });

        it('filters by status: only open comments counted', async () => {
            const ctx = makeContext({ newRef: 'abc123', filePath: 'src/status.ts' });
            const key = manager.hashContext(ctx);
            const c1 = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.updateComment('ws1', key, c1.id, { status: 'resolved' });

            const allTotals = await manager.getCommentTotals('ws1', ['abc123']);
            expect(allTotals['abc123']).toBe(2);

            const openTotals = await manager.getCommentTotals('ws1', ['abc123'], { statuses: ['open'] });
            expect(openTotals['abc123']).toBe(1);
        });

        it('omits hashes with zero matching comments', async () => {
            const ctx = makeContext({ newRef: 'abc123', filePath: 'src/all-resolved.ts' });
            const key = manager.hashContext(ctx);
            const c = await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.updateComment('ws1', key, c.id, { status: 'resolved' });

            const totals = await manager.getCommentTotals('ws1', ['abc123'], { statuses: ['open'] });
            expect(totals['abc123']).toBeUndefined();
        });

        it('isolates workspaces', async () => {
            const ctx = makeContext({ newRef: 'abc123' });
            await manager.addComment('ws1', ctx, makeCommentData(ctx));
            await manager.addComment('ws2', ctx, makeCommentData(ctx));
            await manager.addComment('ws2', ctx, makeCommentData(ctx));

            const totals1 = await manager.getCommentTotals('ws1', ['abc123']);
            const totals2 = await manager.getCommentTotals('ws2', ['abc123']);
            expect(totals1['abc123']).toBe(1);
            expect(totals2['abc123']).toBe(2);
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

    function totalsUrl() {
        return `${baseUrl}/api/diff-comment-totals/${WS_ID}`;
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

        it('filters by status=open, excluding resolved comments', async () => {
            // Create one open and one resolved comment for the same file
            const postRes = await postJSON(collectionUrl(), makePostBody({ filePath: 'src/filter.ts' }));
            const createdId = JSON.parse(postRes.body).comment.id as string;
            const manager = new DiffCommentsManager(tmpDir);
            const ctx = makeContext({ filePath: 'src/filter.ts' });
            const key = manager.hashContext(ctx);
            await patchJSON(`${baseUrl}/api/diff-comments/${WS_ID}/${key}/${createdId}`, { status: 'resolved' });
            await postJSON(collectionUrl(), makePostBody({ filePath: 'src/filter.ts' })); // second comment stays open

            const res = await getJSON(`${countsUrl()}?status=open`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const values = Object.values(body.counts as Record<string, number>);
            // Only the open comment should be counted → 1
            expect(values.some(v => v === 1)).toBe(true);
            // Total should not include the resolved comment
            const total = values.reduce((a, b) => a + b, 0);
            expect(total).toBe(1);
        });

        it('filters by oldRef and newRef, excluding unrelated refs', async () => {
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'main', newRef: 'feature', filePath: 'src/a.ts' }));
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'other', newRef: 'branch', filePath: 'src/b.ts' }));

            const res = await getJSON(`${countsUrl()}?oldRef=main&newRef=feature`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const total = Object.values(body.counts as Record<string, number>).reduce((a, b) => a + b, 0);
            // Only the main→feature comment should be counted
            expect(total).toBe(1);
        });

        it('combines status and ref filters', async () => {
            // Open comment for main→feature
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'main', newRef: 'feature', filePath: 'src/a.ts' }));
            // Resolved comment for main→feature
            const postRes2 = await postJSON(collectionUrl(), makePostBody({ oldRef: 'main', newRef: 'feature', filePath: 'src/a.ts' }));
            const id2 = JSON.parse(postRes2.body).comment.id as string;
            const manager = new DiffCommentsManager(tmpDir);
            const ctx = makeContext({ oldRef: 'main', newRef: 'feature', filePath: 'src/a.ts' });
            const key = manager.hashContext(ctx);
            await patchJSON(`${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id2}`, { status: 'resolved' });

            const res = await getJSON(`${countsUrl()}?oldRef=main&newRef=feature&status=open`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const total = Object.values(body.counts as Record<string, number>).reduce((a, b) => a + b, 0);
            expect(total).toBe(1); // only the open comment
        });
    });

    // -- GET /api/diff-comment-totals/:wsId --

    describe('GET /api/diff-comment-totals/:wsId', () => {
        it('returns { totals } object', async () => {
            const res = await getJSON(`${totalsUrl()}?commits=abc123`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totals).toBeDefined();
            expect(typeof body.totals).toBe('object');
        });

        it('returns empty totals when no commits param', async () => {
            const res = await getJSON(totalsUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totals).toEqual({});
        });

        it('reflects created comments grouped by newRef (commitHash)', async () => {
            await postJSON(collectionUrl(), makePostBody({ newRef: 'commit-aaa', filePath: 'src/a.ts' }));
            await postJSON(collectionUrl(), makePostBody({ newRef: 'commit-aaa', filePath: 'src/b.ts' }));
            await postJSON(collectionUrl(), makePostBody({ newRef: 'commit-bbb', filePath: 'src/c.ts' }));

            const res = await getJSON(`${totalsUrl()}?commits=commit-aaa,commit-bbb`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totals['commit-aaa']).toBe(2);
            expect(body.totals['commit-bbb']).toBe(1);
        });

        it('omits commits not in the requested list', async () => {
            await postJSON(collectionUrl(), makePostBody({ newRef: 'commit-xxx', filePath: 'src/x.ts' }));

            const res = await getJSON(`${totalsUrl()}?commits=commit-other`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totals['commit-xxx']).toBeUndefined();
        });

        it('filters resolved comments with status=open', async () => {
            await postJSON(collectionUrl(), makePostBody({ newRef: 'commit-open', filePath: 'src/open.ts' }));
            const postRes = await postJSON(collectionUrl(), makePostBody({ newRef: 'commit-open', filePath: 'src/open.ts' }));
            const createdId = JSON.parse(postRes.body).comment.id as string;
            const manager = new DiffCommentsManager(tmpDir);
            const ctx = makeContext({ newRef: 'commit-open', filePath: 'src/open.ts' });
            const key = manager.hashContext(ctx);
            await patchJSON(`${baseUrl}/api/diff-comments/${WS_ID}/${key}/${createdId}`, { status: 'resolved' });

            const res = await getJSON(`${totalsUrl()}?commits=commit-open&status=open`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totals['commit-open']).toBe(1); // only the open one
        });

        it('returns empty totals when commits param lists unknown hashes', async () => {
            // No comments seeded — all requested hashes should have zero counts
            const res = await getJSON(`${totalsUrl()}?commits=unknown-hash-1,unknown-hash-2&status=open`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totals).toEqual({});
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

    // -- GET /api/diff-comments/:wsId — list all with filters --

    describe('GET /api/diff-comments/:wsId', () => {
        it('returns all comments when no filters provided', async () => {
            await postJSON(collectionUrl(), makePostBody({ newRef: 'working-tree', filePath: 'src/a.ts' }));
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'abc^', newRef: 'abc', filePath: 'src/b.ts' }));
            const res = await getJSON(collectionUrl());
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comments).toHaveLength(2);
        });

        it('filters by newRef only (working-tree)', async () => {
            await postJSON(collectionUrl(), makePostBody({ newRef: 'working-tree', filePath: 'src/a.ts' }));
            await postJSON(collectionUrl(), makePostBody({ newRef: 'working-tree', filePath: 'src/b.ts' }));
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'abc^', newRef: 'abc', filePath: 'src/c.ts' }));

            const res = await getJSON(`${collectionUrl()}?newRef=working-tree`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body.comments)).toBe(true);
            // Should include only the two working-tree comments, not the commit comment
            expect(body.comments).toHaveLength(2);
            expect(body.comments.every((c: any) => c.context.newRef === 'working-tree')).toBe(true);
        });

        it('filters by both oldRef and newRef', async () => {
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'main^', newRef: 'main', filePath: 'src/a.ts' }));
            await postJSON(collectionUrl(), makePostBody({ oldRef: 'other^', newRef: 'other', filePath: 'src/b.ts' }));
            await postJSON(collectionUrl(), makePostBody({ newRef: 'working-tree', filePath: 'src/c.ts' }));

            const res = await getJSON(`${collectionUrl()}?oldRef=main^&newRef=main`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.comments).toHaveLength(1);
            expect(body.comments[0].context.newRef).toBe('main');
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

    // -- POST /api/diff-comments/:wsId/:key/:id/ask-ai — AI integration --

    describe('POST /api/diff-comments/:wsId/:key/:id/ask-ai', () => {
        function askAiUrl(key: string, id: string) {
            return `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id}/ask-ai`;
        }

        it('returns 200 with aiResponse and reply on success', async () => {
            // Create a comment first
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());

            // Mock the AI invoker module
            const mockInvoker = vi.fn().mockResolvedValue({
                success: true,
                response: 'AI suggestion text',
            });
            vi.doMock('../../src/ai-invoker', () => ({
                createCLIAIInvoker: () => mockInvoker,
            }));

            const res = await postJSON(askAiUrl(key, comment.id), {
                question: 'What does this code do?',
            });
            // The real AI invoker may fail in tests (no AI available), so accept 200 or 503
            if (res.status === 200) {
                const body = JSON.parse(res.body);
                expect(body.aiResponse).toBeDefined();
                expect(body.reply).toBeDefined();
                expect(body.reply.isAI).toBe(true);
                expect(body.reply.author).toBe('AI');
            } else {
                // AI service unavailable is acceptable in test environment
                expect([502, 503]).toContain(res.status);
            }

            vi.doUnmock('../../src/ai-invoker');
        });

        it('returns 404 when comment does not exist', async () => {
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const fakeId = '00000000-0000-0000-0000-000000000000';
            const res = await postJSON(askAiUrl(key, fakeId), {
                question: 'What is this?',
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 on malformed JSON body', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await request(askAiUrl(key, comment.id), {
                method: 'POST',
                body: '{{bad-json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('persists aiResponse on the comment after successful AI call', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());

            const res = await postJSON(askAiUrl(key, comment.id), {
                question: 'Explain this',
            });

            if (res.status === 200) {
                const body = JSON.parse(res.body);
                // Verify the comment has aiResponse persisted
                const getRes = await getJSON(itemUrl(key, comment.id));
                const getBody = JSON.parse(getRes.body);
                expect(getBody.comment.aiResponse).toBe(body.aiResponse);
                // Verify reply was added
                expect(getBody.comment.replies).toBeDefined();
                expect(getBody.comment.replies.length).toBeGreaterThanOrEqual(1);
                const aiReply = getBody.comment.replies.find((r: any) => r.isAI);
                expect(aiReply).toBeDefined();
                expect(aiReply.author).toBe('AI');
            }
            // If AI unavailable in test env, just verify it didn't 501
            expect(res.status).not.toBe(501);
        });

        it('no longer returns 501', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());
            const res = await postJSON(askAiUrl(key, comment.id), {});
            expect(res.status).not.toBe(501);
        });
    });
});

// ============================================================================
// WebSocket Broadcast Tests
// ============================================================================

describe('Diff Comments WebSocket Broadcasts', () => {
    let tmpDir: string;
    let httpServer: http.Server;
    let baseUrl: string;
    let broadcastSpy: ReturnType<typeof vi.fn>;
    let routes: import('@plusplusoneplusplus/coc-server').Route[];

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-diff-ws-'));
        routes = [];
        broadcastSpy = vi.fn();

        const mockWsServer = {
            broadcastProcessEvent: broadcastSpy,
        } as any;

        const { registerDiffCommentsRoutes } = await import('../../src/server/diff-comments-handler');
        registerDiffCommentsRoutes(routes, tmpDir, {} as any, undefined, () => mockWsServer);

        httpServer = http.createServer(async (req, res) => {
            const url = req.url || '';
            const method = req.method || 'GET';
            for (const route of routes) {
                if (route.method && route.method !== method) continue;
                const match = url.match(route.pattern);
                if (match) {
                    await route.handler(req, res, match);
                    return;
                }
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise<void>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = httpServer.address() as import('net').AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const WS_ID = 'ws-broadcast';

    function collectionUrl() {
        return `${baseUrl}/api/diff-comments/${WS_ID}`;
    }

    function itemUrl(key: string, id: string) {
        return `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id}`;
    }

    function replyUrl(key: string, id: string) {
        return `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id}/replies`;
    }

    function makePostBody(ctxOverrides: Partial<DiffCommentContext> = {}) {
        const context = makeContext(ctxOverrides);
        return {
            context,
            selection: { diffLineStart: 0, diffLineEnd: 2, side: 'added', startColumn: 0, endColumn: 10 },
            selectedText: 'export default',
            comment: 'Needs review',
            status: 'open',
        };
    }

    it('broadcasts diff-comment-updated with action "added" on create', async () => {
        const res = await postJSON(collectionUrl(), makePostBody());
        expect(res.status).toBe(201);
        const { comment } = JSON.parse(res.body);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const msg = broadcastSpy.mock.calls[0][0];
        expect(msg.type).toBe('diff-comment-updated');
        expect(msg.action).toBe('added');
        expect(msg.workspaceId).toBe(WS_ID);
        expect(msg.comment.id).toBe(comment.id);
        expect(msg.storageKey).toMatch(/^[0-9a-f]{64}$/);
    });

    it('broadcasts diff-comment-updated with action "updated" on PATCH', async () => {
        const createRes = await postJSON(collectionUrl(), makePostBody());
        const { comment } = JSON.parse(createRes.body);
        const manager = new DiffCommentsManager(tmpDir);
        const key = manager.hashContext(makeContext());
        broadcastSpy.mockClear();

        const res = await patchJSON(itemUrl(key, comment.id), { comment: 'Updated text' });
        expect(res.status).toBe(200);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const msg = broadcastSpy.mock.calls[0][0];
        expect(msg.type).toBe('diff-comment-updated');
        expect(msg.action).toBe('updated');
        expect(msg.workspaceId).toBe(WS_ID);
        expect(msg.storageKey).toBe(key);
        expect(msg.comment.comment).toBe('Updated text');
    });

    it('broadcasts diff-comment-updated with action "deleted" on DELETE', async () => {
        const createRes = await postJSON(collectionUrl(), makePostBody());
        const { comment } = JSON.parse(createRes.body);
        const manager = new DiffCommentsManager(tmpDir);
        const key = manager.hashContext(makeContext());
        broadcastSpy.mockClear();

        const res = await deleteRequest(itemUrl(key, comment.id));
        expect(res.status).toBe(204);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const msg = broadcastSpy.mock.calls[0][0];
        expect(msg.type).toBe('diff-comment-updated');
        expect(msg.action).toBe('deleted');
        expect(msg.workspaceId).toBe(WS_ID);
        expect(msg.storageKey).toBe(key);
        expect(msg.commentId).toBe(comment.id);
    });

    it('broadcasts diff-comment-updated with action "updated" on reply', async () => {
        const createRes = await postJSON(collectionUrl(), makePostBody());
        const { comment } = JSON.parse(createRes.body);
        const manager = new DiffCommentsManager(tmpDir);
        const key = manager.hashContext(makeContext());
        broadcastSpy.mockClear();

        const res = await postJSON(replyUrl(key, comment.id), { text: 'A reply', author: 'User' });
        expect(res.status).toBe(201);

        expect(broadcastSpy).toHaveBeenCalledTimes(1);
        const msg = broadcastSpy.mock.calls[0][0];
        expect(msg.type).toBe('diff-comment-updated');
        expect(msg.action).toBe('updated');
        expect(msg.workspaceId).toBe(WS_ID);
        expect(msg.storageKey).toBe(key);
        expect(msg.comment).toBeDefined();
        expect(msg.comment.replies).toHaveLength(1);
    });

    it('does not throw when getWsServer returns undefined', async () => {
        // Re-register routes with getWsServer returning undefined
        const localRoutes: import('@plusplusoneplusplus/coc-server').Route[] = [];
        const { registerDiffCommentsRoutes } = await import('../../src/server/diff-comments-handler');
        registerDiffCommentsRoutes(localRoutes, tmpDir, {} as any, undefined, () => undefined);

        const localServer = http.createServer(async (req, res) => {
            const url = req.url || '';
            const method = req.method || 'GET';
            for (const route of localRoutes) {
                if (route.method && route.method !== method) continue;
                const match = url.match(route.pattern);
                if (match) {
                    await route.handler(req, res, match);
                    return;
                }
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise<void>((resolve) => {
            localServer.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = localServer.address() as import('net').AddressInfo;
        const localBaseUrl = `http://127.0.0.1:${addr.port}`;

        const res = await postJSON(`${localBaseUrl}/api/diff-comments/${WS_ID}`, makePostBody());
        expect(res.status).toBe(201);

        await new Promise<void>((resolve) => localServer.close(() => resolve()));
    });

    it('does not broadcast when getWsServer is not provided', async () => {
        const localRoutes: import('@plusplusoneplusplus/coc-server').Route[] = [];
        const { registerDiffCommentsRoutes } = await import('../../src/server/diff-comments-handler');
        registerDiffCommentsRoutes(localRoutes, tmpDir, {} as any);

        const localServer = http.createServer(async (req, res) => {
            const url = req.url || '';
            const method = req.method || 'GET';
            for (const route of localRoutes) {
                if (route.method && route.method !== method) continue;
                const match = url.match(route.pattern);
                if (match) {
                    await route.handler(req, res, match);
                    return;
                }
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise<void>((resolve) => {
            localServer.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = localServer.address() as import('net').AddressInfo;
        const localBaseUrl = `http://127.0.0.1:${addr.port}`;

        const res = await postJSON(`${localBaseUrl}/api/diff-comments/${WS_ID}`, makePostBody());
        expect(res.status).toBe(201);
        // No error = success. broadcastSpy should not be called since we didn't pass it.
        expect(broadcastSpy).not.toHaveBeenCalled();

        await new Promise<void>((resolve) => localServer.close(() => resolve()));
    });
});

// ============================================================================
// Resolve AI Tests (single + batch)
// ============================================================================

describe('Diff Comments Resolve AI Routes', () => {
    let tmpDir: string;
    let httpServer: http.Server;
    let baseUrl: string;
    let mockEnqueue: ReturnType<typeof vi.fn>;
    let routes: import('@plusplusoneplusplus/coc-server').Route[];

    const WS_ID = 'ws-resolve';

    beforeEach(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-diff-resolve-'));
        routes = [];
        mockEnqueue = vi.fn().mockResolvedValue('task-123');

        const mockBridge = {
            getOrCreateBridge: vi.fn(),
            registry: {
                getQueueForRepo: vi.fn().mockReturnValue({
                    enqueue: mockEnqueue,
                }),
            },
        } as any;

        const { registerDiffCommentsRoutes } = await import('../../src/server/diff-comments-handler');
        registerDiffCommentsRoutes(routes, tmpDir, mockBridge, undefined, () => undefined);

        httpServer = http.createServer(async (req, res) => {
            const url = req.url || '';
            const method = req.method || 'GET';
            for (const route of routes) {
                if (route.method && route.method !== method) continue;
                const match = url.match(route.pattern);
                if (match) {
                    await route.handler(req, res, match);
                    return;
                }
            }
            res.writeHead(404);
            res.end();
        });

        await new Promise<void>((resolve) => {
            httpServer.listen(0, '127.0.0.1', () => resolve());
        });
        const addr = httpServer.address() as import('net').AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function collectionUrl() {
        return `${baseUrl}/api/diff-comments/${WS_ID}`;
    }

    function askAiUrl(key: string, id: string) {
        return `${baseUrl}/api/diff-comments/${WS_ID}/${key}/${id}/ask-ai`;
    }

    function resolveWithAiUrl() {
        return `${baseUrl}/api/diff-comments/${WS_ID}/resolve-with-ai`;
    }

    function makePostBody(ctxOverrides: Partial<DiffCommentContext> = {}) {
        const context = makeContext(ctxOverrides);
        return {
            context,
            selection: { diffLineStart: 0, diffLineEnd: 2, side: 'added', startColumn: 0, endColumn: 10 },
            selectedText: 'const x = 1;',
            comment: 'Should be let',
            status: 'open',
        };
    }

    describe('POST /ask-ai with commandId=resolve', () => {
        it('returns 410 Gone', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);
            const manager = new DiffCommentsManager(tmpDir);
            const key = manager.hashContext(makeContext());

            const res = await postJSON(askAiUrl(key, comment.id), {
                commandId: 'resolve',
                diffContent: '--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-old\n+new',
            });

            expect(res.status).toBe(410);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('resolve-with-ai');
        });
    });

    describe('POST /resolve-with-ai', () => {
        it('returns 202 with taskId and totalCount for commit-level mode', async () => {
            // Create two open comments
            await postJSON(collectionUrl(), makePostBody());
            await postJSON(collectionUrl(), {
                ...makePostBody(),
                comment: 'Another comment',
            });

            const res = await postJSON(resolveWithAiUrl(), {
                oldRef: 'main',
                newRef: 'feature-branch',
            });

            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBe('task-123');
            expect(body.totalCount).toBe(2);
        });

        it('returns 202 for single-file mode', async () => {
            await postJSON(collectionUrl(), makePostBody());

            const res = await postJSON(resolveWithAiUrl(), {
                oldRef: 'main',
                newRef: 'feature-branch',
                filePath: 'src/index.ts',
            });

            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBe('task-123');
            expect(body.totalCount).toBe(1);
        });

        it('returns 202 for single-comment mode', async () => {
            const createRes = await postJSON(collectionUrl(), makePostBody());
            const { comment } = JSON.parse(createRes.body);

            const res = await postJSON(resolveWithAiUrl(), {
                oldRef: 'main',
                newRef: 'feature-branch',
                commentId: comment.id,
            });

            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBe('task-123');
            expect(body.totalCount).toBe(1);
        });

        it('returns 400 when oldRef is missing', async () => {
            const res = await postJSON(resolveWithAiUrl(), {
                newRef: 'feature-branch',
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('oldRef');
        });

        it('returns 400 when newRef is missing', async () => {
            const res = await postJSON(resolveWithAiUrl(), {
                oldRef: 'main',
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('newRef');
        });

        it('returns 400 when no open comments found', async () => {
            const res = await postJSON(resolveWithAiUrl(), {
                oldRef: 'main',
                newRef: 'feature-branch',
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('No open comments');
        });

        it('enqueues correct payload shape with resolveDiffCommentsMulti', async () => {
            await postJSON(collectionUrl(), makePostBody());

            await postJSON(resolveWithAiUrl(), {
                oldRef: 'main',
                newRef: 'feature-branch',
            });

            expect(mockEnqueue).toHaveBeenCalledTimes(1);
            const input = mockEnqueue.mock.calls[0][0];
            expect(input.type).toBe('chat');
            expect(input.payload.kind).toBe('chat');
            expect(input.payload.mode).toBe('autopilot');
            expect(input.payload.tools).toContain('resolve-comments');
            expect(input.payload.context.resolveDiffCommentsMulti).toBeDefined();
            expect(input.payload.context.resolveDiffCommentsMulti.files).toHaveLength(1);
            expect(input.payload.context.resolveDiffCommentsMulti.files[0].filePath).toBe('src/index.ts');
            expect(input.payload.context.resolveDiffCommentsMulti.wsId).toBe(WS_ID);
            expect(input.payload.context.resolveDiffCommentsMulti.oldRef).toBe('main');
            expect(input.payload.context.resolveDiffCommentsMulti.newRef).toBe('feature-branch');
        });
    });
});
