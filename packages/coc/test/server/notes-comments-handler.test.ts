/**
 * Notes Comments Handler Tests
 *
 * Comprehensive tests for the Notes Comments REST API endpoints:
 * sidecar CRUD for threads and comments.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Request Helpers
// ============================================================================

function request(
    reqUrl: string,
    options: http.RequestOptions = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(reqUrl, options, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () =>
                resolve({ status: res.statusCode!, headers: res.headers, body }),
            );
        });
        req.on('error', reject);
        if ((options as any).body) {
            req.write((options as any).body);
        }
        req.end();
    });
}

function postJSON(
    reqUrl: string,
    data: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    const body = JSON.stringify(data);
    return request(reqUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body,
    } as any);
}

function putJSON(
    reqUrl: string,
    data: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    const body = JSON.stringify(data);
    return request(reqUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body,
    } as any);
}

function patchJSON(
    reqUrl: string,
    data: unknown,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    const body = JSON.stringify(data);
    return request(reqUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body,
    } as any);
}

function deleteRequest(
    reqUrl: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return request(reqUrl, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Comments Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-comments-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-comments-ws-'));
        wsId = 'test-ws-' + Date.now();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    function commentsUrl(srv: ExecutionServer, subpath: string = '', query: string = ''): string {
        const base = `${srv.url}/api/workspaces/${wsId}/notes/comments`;
        const full = subpath ? `${base}/${subpath}` : base;
        return query ? `${full}?${query}` : full;
    }

    async function createThread(
        srv: ExecutionServer,
        notePath: string = 'page.md',
        content: string = 'First comment',
        anchor = { quotedText: 'hello', prefix: '', suffix: '' },
    ) {
        const res = await postJSON(commentsUrl(srv, 'thread'), {
            path: notePath,
            thread: { anchor, comments: [{ content }] },
        });
        expect(res.status).toBe(201);
        return JSON.parse(res.body).thread;
    }

    // ========================================================================
    // 1. GET returns empty threads for note with no comments
    // ========================================================================
    it('GET returns empty threads for note with no comments', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const res = await request(commentsUrl(srv, '', 'path=page.md'));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data).toEqual({ version: 1, threads: {} });
    });

    // ========================================================================
    // 2. POST creates a thread, GET returns it
    // ========================================================================
    it('POST creates a thread, GET returns it', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);
        expect(thread.id).toBeDefined();
        expect(thread.status).toBe('open');
        expect(thread.comments).toHaveLength(1);
        expect(thread.comments[0].id).toBeDefined();
        expect(thread.comments[0].content).toBe('First comment');
        expect(thread.createdAt).toBeDefined();
        expect(thread.anchor.quotedText).toBe('hello');

        const getRes = await request(commentsUrl(srv, '', 'path=page.md'));
        expect(getRes.status).toBe(200);
        const sidecar = JSON.parse(getRes.body);
        expect(sidecar.threads[thread.id]).toBeDefined();
        expect(sidecar.threads[thread.id].comments).toHaveLength(1);
    });

    // ========================================================================
    // 3. POST adds a comment to a thread
    // ========================================================================
    it('POST adds a comment to a thread', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);
        const addRes = await postJSON(commentsUrl(srv, `thread/${thread.id}/comment`), {
            path: 'page.md',
            content: 'Reply',
        });
        expect(addRes.status).toBe(201);
        const { comment } = JSON.parse(addRes.body);
        expect(comment.id).toBeDefined();
        expect(comment.content).toBe('Reply');

        const getRes = await request(commentsUrl(srv, '', 'path=page.md'));
        const sidecar = JSON.parse(getRes.body);
        expect(sidecar.threads[thread.id].comments).toHaveLength(2);
    });

    // ========================================================================
    // 4. PATCH resolves a thread, PATCH reopens it
    // ========================================================================
    it('PATCH resolves a thread, PATCH reopens it', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);

        // Resolve
        const resolveRes = await patchJSON(commentsUrl(srv, `thread/${thread.id}`), {
            path: 'page.md',
            status: 'resolved',
        });
        expect(resolveRes.status).toBe(200);
        const resolved = JSON.parse(resolveRes.body).thread;
        expect(resolved.status).toBe('resolved');
        expect(resolved.resolvedAt).toBeDefined();

        // Reopen
        const reopenRes = await patchJSON(commentsUrl(srv, `thread/${thread.id}`), {
            path: 'page.md',
            status: 'open',
        });
        expect(reopenRes.status).toBe(200);
        const reopened = JSON.parse(reopenRes.body).thread;
        expect(reopened.status).toBe('open');
        expect(reopened.resolvedAt).toBeUndefined();
    });

    // ========================================================================
    // 5. PATCH edits a comment
    // ========================================================================
    it('PATCH edits a comment', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);
        const commentId = thread.comments[0].id;

        const editRes = await patchJSON(commentsUrl(srv, `thread/${thread.id}/comment/${commentId}`), {
            path: 'page.md',
            content: 'Edited',
        });
        expect(editRes.status).toBe(200);
        const edited = JSON.parse(editRes.body).comment;
        expect(edited.content).toBe('Edited');
        expect(edited.updatedAt).toBeDefined();
    });

    // ========================================================================
    // 6. DELETE removes a comment
    // ========================================================================
    it('DELETE removes a comment', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);
        // Add a second comment
        const addRes = await postJSON(commentsUrl(srv, `thread/${thread.id}/comment`), {
            path: 'page.md',
            content: 'Second',
        });
        const secondComment = JSON.parse(addRes.body).comment;

        // Delete first comment
        const delRes = await deleteRequest(
            commentsUrl(srv, `thread/${thread.id}/comment/${thread.comments[0].id}`, 'path=page.md'),
        );
        expect(delRes.status).toBe(204);

        // Verify only second comment remains
        const getRes = await request(commentsUrl(srv, '', 'path=page.md'));
        const sidecar = JSON.parse(getRes.body);
        expect(sidecar.threads[thread.id].comments).toHaveLength(1);
        expect(sidecar.threads[thread.id].comments[0].id).toBe(secondComment.id);
    });

    // ========================================================================
    // 7. DELETE removes a thread
    // ========================================================================
    it('DELETE removes a thread', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);

        const delRes = await deleteRequest(
            commentsUrl(srv, `thread/${thread.id}`, 'path=page.md'),
        );
        expect(delRes.status).toBe(204);

        const getRes = await request(commentsUrl(srv, '', 'path=page.md'));
        const sidecar = JSON.parse(getRes.body);
        expect(sidecar.threads).toEqual({});
    });

    // ========================================================================
    // 8. 404 when thread does not exist
    // ========================================================================
    it('404 when thread does not exist', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const patchRes = await patchJSON(commentsUrl(srv, 'thread/nonexistent'), {
            path: 'page.md',
            status: 'resolved',
        });
        expect(patchRes.status).toBe(404);

        const delRes = await deleteRequest(
            commentsUrl(srv, 'thread/nonexistent', 'path=page.md'),
        );
        expect(delRes.status).toBe(404);
    });

    // ========================================================================
    // 9. 404 when comment does not exist
    // ========================================================================
    it('404 when comment does not exist', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);

        const patchRes = await patchJSON(
            commentsUrl(srv, `thread/${thread.id}/comment/nonexistent`),
            { path: 'page.md', content: 'x' },
        );
        expect(patchRes.status).toBe(404);

        const delRes = await deleteRequest(
            commentsUrl(srv, `thread/${thread.id}/comment/nonexistent`, 'path=page.md'),
        );
        expect(delRes.status).toBe(404);
    });

    // ========================================================================
    // 10. 403 on path traversal attempts
    // ========================================================================
    it('403 on path traversal attempts', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // GET with traversal
        const getRes = await request(
            commentsUrl(srv, '', 'path=../../etc/passwd'),
        );
        expect(getRes.status).toBe(403);

        // POST thread with traversal
        const postRes = await postJSON(commentsUrl(srv, 'thread'), {
            path: '../../evil',
            thread: { anchor: { quotedText: 'x', prefix: '', suffix: '' }, comments: [{ content: 'x' }] },
        });
        expect(postRes.status).toBe(403);

        // PUT with traversal
        const putRes = await putJSON(commentsUrl(srv), {
            path: '../../../etc/shadow',
            threads: {},
        });
        expect(putRes.status).toBe(403);
    });

    // ========================================================================
    // 11. 400 on missing required fields
    // ========================================================================
    it('400 on missing required fields', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // GET without path
        const getRes = await request(commentsUrl(srv));
        expect(getRes.status).toBe(400);

        // POST thread without thread field
        const postRes1 = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
        });
        expect(postRes1.status).toBe(400);

        // POST thread without anchor
        const postRes2 = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            thread: { comments: [{ content: 'x' }] },
        });
        expect(postRes2.status).toBe(400);

        // PATCH thread without status
        const thread = await createThread(srv);
        const patchRes = await patchJSON(commentsUrl(srv, `thread/${thread.id}`), {
            path: 'page.md',
        });
        expect(patchRes.status).toBe(400);

        // POST comment without content
        const commentRes = await postJSON(commentsUrl(srv, `thread/${thread.id}/comment`), {
            path: 'page.md',
        });
        expect(commentRes.status).toBe(400);
    });

    // ========================================================================
    // 12. Verify sidecar file on disk
    // ========================================================================
    it('verify sidecar file on disk', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const thread = await createThread(srv);

        // Read the raw sidecar file
        const sidecarFile = path.join(
            getRepoDataPath(dataDir, wsId, 'notes'),
            'page.md.comments.json',
        );
        expect(fs.existsSync(sidecarFile)).toBe(true);

        const raw = fs.readFileSync(sidecarFile, 'utf-8');
        const parsed = JSON.parse(raw);

        expect(parsed.version).toBe(1);
        expect(parsed.threads[thread.id]).toBeDefined();
        expect(parsed.threads[thread.id].status).toBe('open');
        expect(parsed.threads[thread.id].comments).toHaveLength(1);

        // Verify pretty-printed (2-space indent)
        expect(raw).toBe(JSON.stringify(parsed, null, 2));
    });

    // ========================================================================
    // 13. PUT full replace
    // ========================================================================
    it('PUT full replace overwrites existing threads', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a thread via POST
        const thread = await createThread(srv);

        // PUT with completely different threads
        const replacementThreads = {
            'custom-id': {
                id: 'custom-id',
                status: 'resolved' as const,
                createdAt: '2025-01-01T00:00:00.000Z',
                resolvedAt: '2025-01-02T00:00:00.000Z',
                anchor: { quotedText: 'replaced', prefix: 'pre', suffix: 'suf' },
                comments: [{ id: 'c1', content: 'Replaced comment', createdAt: '2025-01-01T00:00:00.000Z' }],
            },
        };

        const putRes = await putJSON(commentsUrl(srv), {
            path: 'page.md',
            threads: replacementThreads,
        });
        expect(putRes.status).toBe(200);

        // GET — should have only the PUT payload, not the original POST thread
        const getRes = await request(commentsUrl(srv, '', 'path=page.md'));
        const sidecar = JSON.parse(getRes.body);
        expect(sidecar.threads['custom-id']).toBeDefined();
        expect(sidecar.threads[thread.id]).toBeUndefined();
        expect(sidecar.threads['custom-id'].anchor.quotedText).toBe('replaced');
    });
});
