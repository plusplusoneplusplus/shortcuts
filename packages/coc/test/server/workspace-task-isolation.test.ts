/**
 * Workspace Task Isolation Tests — Section 1
 *
 * Verifies that tasks in workspace A are completely isolated from workspace B:
 * - GET, POST, PATCH (content and status), DELETE operations on workspace A
 *   do not affect workspace B and vice versa.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { resolveTaskRoot } from '../../src/server/task-root-resolver';

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

function jsonReq(url: string, method: string, data?: unknown) {
    const body = data !== undefined ? JSON.stringify(data) : undefined;
    return request(url, {
        method,
        body,
        headers: {
            'Content-Type': 'application/json',
            ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}),
        },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Workspace Task Isolation', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let wsDirA: string;
    let wsDirB: string;
    const wsIdA = 'ws-task-a';
    const wsIdB = 'ws-task-b';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-task-iso-'));
        wsDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-task-dir-a-'));
        wsDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-task-dir-b-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(wsDirA, { recursive: true, force: true });
        fs.rmSync(wsDirB, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir , skipNonEssentialInit: true });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, id: string, rootPath: string): Promise<void> {
        const res = await jsonReq(`${srv.url}/api/workspaces`, 'POST', { id, name: id, rootPath });
        expect(res.status).toBe(201);
    }

    function taskRootFor(wsId: string, wsDir: string): string {
        return resolveTaskRoot({ dataDir, rootPath: wsDir, workspaceId: wsId }).absolutePath;
    }

    function seedTaskFile(wsId: string, wsDir: string, filePath: string, content: string): void {
        const dir = taskRootFor(wsId, wsDir);
        const full = path.join(dir, filePath);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, 'utf-8');
    }

    // ========================================================================
    // Section 1 tests
    // ========================================================================

    it('GET /api/workspaces/A/summary returns tasks for A', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        seedTaskFile(wsIdA, wsDirA, 'task-a.md', '# Task A');

        const res = await request(`${srv.url}/api/workspaces/${wsIdA}/summary`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        const docs = [...(body.tasks.singleDocuments ?? []), ...(body.tasks.documentGroups ?? [])];
        expect(docs.some((d: any) => d.baseName === 'task-a' || d.fileName === 'task-a.md')).toBe(true);
    });

    it('GET /api/workspaces/B/summary returns empty task list — not A\'s tasks', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        seedTaskFile(wsIdA, wsDirA, 'task-a-only.md', '# Task A Only');

        const res = await request(`${srv.url}/api/workspaces/${wsIdB}/summary`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        const docs = [...(body.tasks.singleDocuments ?? []), ...(body.tasks.documentGroups ?? [])];
        expect(docs.some((d: any) => d.baseName === 'task-a-only')).toBe(false);
    });

    it('POST /api/workspaces/A/tasks creates task → not visible in B', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        // Ensure task dir for A exists
        fs.mkdirSync(taskRootFor(wsIdA, wsDirA), { recursive: true });

        const createRes = await jsonReq(`${srv.url}/api/workspaces/${wsIdA}/tasks`, 'POST', { name: 'new-task-a' });
        expect(createRes.status).toBe(201);

        // Task should not appear in B
        const resB = await request(`${srv.url}/api/workspaces/${wsIdB}/summary`);
        const bodyB = JSON.parse(resB.body);
        const docsB = [...(bodyB.tasks.singleDocuments ?? []), ...(bodyB.tasks.documentGroups ?? [])];
        expect(docsB.some((d: any) => d.baseName === 'new-task-a')).toBe(false);
    });

    it('Content update in A → workspace B file on disk unchanged', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        const originalContent = '# Shared Name\n\nOriginal content';
        const sharedRelPath = 'shared-name.md';
        seedTaskFile(wsIdA, wsDirA, sharedRelPath, originalContent);
        seedTaskFile(wsIdB, wsDirB, sharedRelPath, originalContent);

        const updatedContent = '# Shared Name\n\nUpdated content for A';
        const patchRes = await jsonReq(`${srv.url}/api/workspaces/${wsIdA}/tasks/content`, 'PATCH', {
            path: sharedRelPath,
            content: updatedContent,
        });
        expect(patchRes.status).toBe(200);

        // Workspace B's file should still have original content
        const bFilePath = path.join(taskRootFor(wsIdB, wsDirB), sharedRelPath);
        const bContent = fs.readFileSync(bFilePath, 'utf-8');
        expect(bContent).toBe(originalContent);
    });

    it('DELETE in A → workspace B tasks unaffected', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        seedTaskFile(wsIdA, wsDirA, 'task-shared.md', '# Task in A');
        seedTaskFile(wsIdB, wsDirB, 'task-in-b.md', '# Task in B');

        // Delete shared task from A
        const deleteRes = await jsonReq(`${srv.url}/api/workspaces/${wsIdA}/tasks`, 'DELETE', {
            path: 'task-shared.md',
        });
        expect(deleteRes.status).toBe(204);

        // Workspace B tasks should still be accessible
        const resB = await request(`${srv.url}/api/workspaces/${wsIdB}/summary`);
        expect(resB.status).toBe(200);
        const bodyB = JSON.parse(resB.body);
        const docsB = [...(bodyB.tasks.singleDocuments ?? []), ...(bodyB.tasks.documentGroups ?? [])];
        expect(docsB.some((d: any) => d.baseName === 'task-in-b')).toBe(true);
    });

    it('GET /api/workspaces/B/tasks/content → returns B\'s own content', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        const contentA = '# Content from A';
        const contentB = '# Content from B';
        seedTaskFile(wsIdA, wsDirA, 'doc.md', contentA);
        seedTaskFile(wsIdB, wsDirB, 'doc.md', contentB);

        const resB = await request(`${srv.url}/api/workspaces/${wsIdB}/tasks/content?path=doc.md`);
        expect(resB.status).toBe(200);
        const bodyB = JSON.parse(resB.body);
        expect(bodyB.content).toBe(contentB);
        expect(bodyB.content).not.toBe(contentA);
    });

    it('PATCH status in A → B task with same path unaffected', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        const sharedPath = 'feature.md';
        seedTaskFile(wsIdA, wsDirA, sharedPath, '---\nstatus: pending\n---\n# Feature');
        seedTaskFile(wsIdB, wsDirB, sharedPath, '---\nstatus: pending\n---\n# Feature');

        // Update status in A
        const patchRes = await jsonReq(`${srv.url}/api/workspaces/${wsIdA}/tasks`, 'PATCH', {
            path: sharedPath,
            status: 'done',
        });
        expect(patchRes.status).toBe(200);

        // B's file should still have the original status
        const bFilePath = path.join(taskRootFor(wsIdB, wsDirB), sharedPath);
        const bContent = fs.readFileSync(bFilePath, 'utf-8');
        expect(bContent).toContain('status: pending');
        expect(bContent).not.toContain('status: done');
    });

    it('taskRootPath differs between workspaces', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, wsIdA, wsDirA);
        await registerWorkspace(srv, wsIdB, wsDirB);

        const resA = await request(`${srv.url}/api/workspaces/${wsIdA}/tasks/settings`);
        const resB = await request(`${srv.url}/api/workspaces/${wsIdB}/tasks/settings`);
        expect(resA.status).toBe(200);
        expect(resB.status).toBe(200);

        const bodyA = JSON.parse(resA.body);
        const bodyB = JSON.parse(resB.body);
        expect(bodyA.taskRootPath).not.toBe(bodyB.taskRootPath);
    });
});
