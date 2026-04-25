/**
 * Notes Batch Resolve Tests
 *
 * Tests for the batch-resolve endpoint: POST /api/workspaces/:wsId/notes/batch-resolve?path=<notePath>
 *
 * Endpoint behavior:
 * - Body: { documentContent: string, userContext?: string }
 * - Returns 202 with { taskId } on success
 * - Returns 400 if no open comments
 * - Returns 400 if documentContent missing
 * - Returns 400 if path query param missing
 * - Returns 503 if bridge is not configured
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
// Request Helpers (copied from notes-comments-handler.test.ts)
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

// ============================================================================
// Tests
// ============================================================================

describe('Notes Batch Resolve Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-batch-resolve-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-batch-resolve-ws-'));
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
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
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

    function batchResolveUrl(srv: ExecutionServer, notePath: string): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/batch-resolve?path=${encodeURIComponent(notePath)}`;
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
    // 1. Returns 400 when path query param is missing
    // ========================================================================
    it('returns 400 when path query param is missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/batch-resolve`, {
            documentContent: '# Document\nContent here',
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('path');
    });

    // ========================================================================
    // 2. Returns 400 when documentContent is missing
    // ========================================================================
    it('returns 400 when documentContent is missing', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            // Missing documentContent
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('documentContent');
    });

    // ========================================================================
    // 3. Returns 400 when no open comments exist
    // ========================================================================
    it('returns 400 when no open comments exist', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a thread and resolve it immediately
        const thread = await createThread(srv, 'page.md');
        await patchJSON(commentsUrl(srv, `thread/${thread.id}`), {
            path: 'page.md',
            status: 'resolved',
        });

        // Now try batch-resolve on the page with no open comments
        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            documentContent: '# Document\nContent here',
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('No open comments');
    });

    // ========================================================================
    // 4. Returns 202 with taskId when bridge is configured
    // ========================================================================
    it('returns 202 with taskId when everything is valid', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a thread so there are open comments
        const thread = await createThread(srv, 'page.md');
        expect(thread.status).toBe('open');

        // Attempt batch-resolve with valid data
        // createExecutionServer() DOES set up a bridge by default
        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            documentContent: '# Document\nContent here',
            userContext: 'Some user context',
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBeDefined();
        expect(typeof body.taskId).toBe('string');
    });

    // ========================================================================
    // 5. Returns 400 for path traversal attempts
    // ========================================================================
    it('returns 403 for path traversal attempts', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a thread on a benign path first to have content
        const thread = await createThread(srv, 'page.md');

        // Attempt batch-resolve with path traversal
        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/notes/batch-resolve?path=${encodeURIComponent('../../etc/passwd')}`,
            {
                documentContent: '# Document',
            }
        );

        expect(res.status).toBe(403);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('Access denied');
    });

    // ========================================================================
    // 6. Returns 400 when documentContent is empty string
    // ========================================================================
    it('returns 400 when documentContent is empty string', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a thread so there are open comments
        await createThread(srv, 'page.md');

        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            documentContent: '',
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('documentContent');
    });

    // ========================================================================
    // 7. Accepts optional userContext field and returns 202
    // ========================================================================
    it('accepts optional userContext field in request', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a thread so there are open comments
        await createThread(srv, 'page.md');

        // Request with userContext should succeed with 202
        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            documentContent: '# Document\nContent here',
            userContext: 'User is working on feature X',
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBeDefined();
    });

    // ========================================================================
    // 8. Requires workspace to exist
    // ========================================================================
    it('returns 404 for non-existent workspace', async () => {
        const srv = await startServer();
        // Don't register any workspace

        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            documentContent: '# Document',
        });

        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.error).toContain('Workspace not found');
    });

    // ========================================================================
    // 9. Handles multiple open threads
    // ========================================================================
    it('works when multiple open comments exist on same note', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create multiple threads on the same note
        const thread1 = await createThread(srv, 'page.md', 'Comment 1');
        const thread2 = await createThread(srv, 'page.md', 'Comment 2', {
            quotedText: 'world',
            prefix: '',
            suffix: '',
        });

        expect(thread1.status).toBe('open');
        expect(thread2.status).toBe('open');

        // Attempt batch-resolve with multiple open threads
        const res = await postJSON(batchResolveUrl(srv, 'page.md'), {
            documentContent: '# Document\nContent here',
        });

        expect(res.status).toBe(202);
        const body = JSON.parse(res.body);
        expect(body.taskId).toBeDefined();
    });

    // ========================================================================
    // 10. Handles different note paths correctly
    // ========================================================================
    it('handles different note paths with nested structure', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create threads on different notes
        const thread1 = await createThread(srv, 'docs/page1.md', 'Comment on page1');
        const thread2 = await createThread(srv, 'docs/nested/page2.md', 'Comment on page2');

        // Resolve page1's thread
        await patchJSON(commentsUrl(srv, `thread/${thread1.id}`), {
            path: 'docs/page1.md',
            status: 'resolved',
        });

        // page1 should fail with "no open comments"
        const res1 = await postJSON(batchResolveUrl(srv, 'docs/page1.md'), {
            documentContent: '# Page 1',
        });
        expect(res1.status).toBe(400);
        const body1 = JSON.parse(res1.body);
        expect(body1.error).toContain('No open comments');

        // page2 should succeed with 202
        const res2 = await postJSON(batchResolveUrl(srv, 'docs/nested/page2.md'), {
            documentContent: '# Page 2',
        });
        expect(res2.status).toBe(202);
        const body2 = JSON.parse(res2.body);
        expect(body2.taskId).toBeDefined();
    });
});
