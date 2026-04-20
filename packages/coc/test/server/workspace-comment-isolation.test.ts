/**
 * Workspace Comment Isolation Tests — Section 2
 *
 * Verifies that task comments and diff comments in workspace A are
 * completely isolated from workspace B and vice versa.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// HTTP Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; body: string }> {
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
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
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
// Fixture helpers
// ============================================================================

function makeCommentData(overrides: Record<string, unknown> = {}) {
    return {
        filePath: 'feature/task1.md',
        selection: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
        selectedText: '# Task',
        comment: 'Test comment',
        status: 'open',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace Comment Isolation', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    const wsIdA = 'ws-comment-a';
    const wsIdB = 'ws-comment-b';
    const filePath = 'path/to/file.md';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-comment-iso-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        server = await createExecutionServer({ port: 0, host: 'localhost', dataDir , skipNonEssentialInit: true });
        return server;
    }

    function commentsUrl(wsId: string, fp = filePath) {
        return `${server!.url}/api/comments/${wsId}/${fp}`;
    }

    function commentUrl(wsId: string, commentId: string, fp = filePath) {
        return `${server!.url}/api/comments/${wsId}/${fp}/${commentId}`;
    }

    // ========================================================================
    // GET isolation
    // ========================================================================

    it('GET /api/comments/A/path → returns only A\'s comments', async () => {
        await startServer();

        await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'Comment in A' }));
        await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'Another in A' }));

        const res = await request(commentsUrl(wsIdA));
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.comments).toHaveLength(2);
        expect(body.comments.every((c: any) => c.comment.includes('A'))).toBe(true);
    });

    it('GET /api/comments/B/path → returns only B\'s comments (not A\'s)', async () => {
        await startServer();

        await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'Only in A' }));

        const res = await request(commentsUrl(wsIdB));
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.comments).toEqual([]);
    });

    it('Same file path in both workspaces → comments are completely independent', async () => {
        await startServer();

        await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'WS-A comment' }));
        await postJSON(commentsUrl(wsIdB), makeCommentData({ comment: 'WS-B comment' }));
        await postJSON(commentsUrl(wsIdB), makeCommentData({ comment: 'WS-B comment 2' }));

        const resA = await request(commentsUrl(wsIdA));
        const resB = await request(commentsUrl(wsIdB));
        const bodyA = JSON.parse(resA.body);
        const bodyB = JSON.parse(resB.body);

        expect(bodyA.comments).toHaveLength(1);
        expect(bodyA.comments[0].comment).toBe('WS-A comment');
        expect(bodyB.comments).toHaveLength(2);
    });

    // ========================================================================
    // POST isolation
    // ========================================================================

    it('POST /api/comments/A → not returned by GET /api/comments/B', async () => {
        await startServer();

        const postRes = await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'Exclusive to A' }));
        expect(postRes.status).toBe(201);

        const resB = await request(commentsUrl(wsIdB));
        const bodyB = JSON.parse(resB.body);
        expect(bodyB.comments).toEqual([]);
    });

    // ========================================================================
    // PATCH isolation
    // ========================================================================

    it('PATCH comment in A → B comment with same ID unaffected', async () => {
        await startServer();

        // Create comment in both workspaces
        const resA = await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'Original A' }));
        const resB = await postJSON(commentsUrl(wsIdB), makeCommentData({ comment: 'Original B' }));
        const commentA = JSON.parse(resA.body).comment;
        const commentB = JSON.parse(resB.body).comment;

        // Patch A's comment
        await patchJSON(commentUrl(wsIdA, commentA.id), { comment: 'Updated A' });

        // B's comment should remain unchanged
        const bComments = JSON.parse((await request(commentsUrl(wsIdB))).body).comments;
        const bComment = bComments.find((c: any) => c.id === commentB.id);
        expect(bComment).toBeDefined();
        expect(bComment.comment).toBe('Original B');
    });

    // ========================================================================
    // DELETE isolation
    // ========================================================================

    it('DELETE comment in A → B comments unaffected', async () => {
        await startServer();

        const resA = await postJSON(commentsUrl(wsIdA), makeCommentData({ comment: 'To delete in A' }));
        await postJSON(commentsUrl(wsIdB), makeCommentData({ comment: 'Keep in B' }));
        const commentAId = JSON.parse(resA.body).comment.id;

        const delRes = await deleteRequest(commentUrl(wsIdA, commentAId));
        expect(delRes.status).toBeLessThan(300); // 200 or 204

        const bComments = JSON.parse((await request(commentsUrl(wsIdB))).body).comments;
        expect(bComments).toHaveLength(1);
        expect(bComments[0].comment).toBe('Keep in B');
    });

    // ========================================================================
    // Diff comments isolation
    // ========================================================================

    it('Diff comments: /api/diff-comments/A/:path → isolated from /api/diff-comments/B/:path', async () => {
        await startServer();

        const diffContext = {
            newRef: 'main',
            filePath: 'src/app.ts',
            fileIndex: 0,
            totalFiles: 1,
        };

        const diffCommentData = {
            context: diffContext,
            selection: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 10 },
            selectedText: 'code snippet',
            comment: 'Review note',
            status: 'open',
        };

        await postJSON(`${server!.url}/api/diff-comments/${wsIdA}`, diffCommentData);

        // B's diff comments should be empty
        const resB = await request(`${server!.url}/api/diff-comments/${wsIdB}`);
        expect(resB.status).toBe(200);
        const bodyB = JSON.parse(resB.body);
        // Either empty array or no comments from A
        const bComments: any[] = bodyB.comments ?? [];
        expect(bComments.filter((c: any) => c.comment === 'Review note')).toHaveLength(0);
    });
});
