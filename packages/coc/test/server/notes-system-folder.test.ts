/**
 * Notes System Folder Protection Tests
 *
 * Tests for the systemFolders concept in the Notes REST API:
 * - GET /notes/tree exposes systemFolders and auto-creates Plans
 * - PATCH /notes/path returns 403 when renaming a system folder
 * - DELETE /notes/path returns 403 when deleting a system folder
 * - Rename/delete of pages *inside* a system folder works normally
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { safeRm } from '../helpers/safe-rm';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method ?? 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }),
                );
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function postJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

function patchJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
        body,
    });
}

function deleteReq(url: string): Promise<{ status: number; body: string }> {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes System Folder Protection', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-system-folder-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-system-ws-'));
        wsId = 'test-ws-' + Date.now();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        await safeRm(dataDir);
        await safeRm(workspaceDir);
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: '127.0.0.1', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer): Promise<void> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
    }

    function notesRoot(): string {
        return path.join(dataDir, 'repos', wsId, 'notes');
    }

    function treeUrl(srv: ExecutionServer): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/tree`;
    }

    function patchUrl(srv: ExecutionServer): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/path`;
    }

    function deleteUrl(srv: ExecutionServer, notePath: string): string {
        return `${srv.url}/api/workspaces/${wsId}/notes/path?path=${encodeURIComponent(notePath)}`;
    }

    // -------------------------------------------------------------------------
    // Tree response — systemFolders field
    // -------------------------------------------------------------------------

    it('GET /notes/tree includes systemFolders: ["Plans"]', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(treeUrl(srv));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.systemFolders).toEqual(['Plans']);
    });

    it('GET /notes/tree auto-creates the Plans folder', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const plansDir = path.join(notesRoot(), 'Plans');
        expect(fs.existsSync(plansDir)).toBe(false);

        const res = await request(treeUrl(srv));
        expect(res.status).toBe(200);

        expect(fs.existsSync(plansDir)).toBe(true);
        expect(fs.statSync(plansDir).isDirectory()).toBe(true);
    });

    it('GET /notes/tree Plans folder appears in the tree', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(treeUrl(srv));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        const plansNode = (data.tree as Array<{ name: string }>).find(n => n.name === 'Plans');
        expect(plansNode).toBeDefined();
    });

    // -------------------------------------------------------------------------
    // Rename — system folder root blocked
    // -------------------------------------------------------------------------

    it('PATCH /notes/path returns 403 when renaming Plans', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Ensure the folder exists
        await request(treeUrl(srv));

        const res = await patchJSON(patchUrl(srv), { oldPath: 'Plans', newPath: 'MyPlans' });
        expect(res.status).toBe(403);
        const data = JSON.parse(res.body);
        expect(data.error).toMatch(/system folder/i);
    });

    it('PATCH /notes/path still blocks rename of Plans when folder was pre-created', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Manually create the Plans folder
        fs.mkdirSync(path.join(notesRoot(), 'Plans'), { recursive: true });

        const res = await patchJSON(patchUrl(srv), { oldPath: 'Plans', newPath: 'RenamedPlans' });
        expect(res.status).toBe(403);
    });

    // -------------------------------------------------------------------------
    // Delete — system folder root blocked
    // -------------------------------------------------------------------------

    it('DELETE /notes/path returns 403 when deleting Plans', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Ensure the folder exists
        await request(treeUrl(srv));

        const res = await deleteReq(deleteUrl(srv, 'Plans'));
        expect(res.status).toBe(403);
        const data = JSON.parse(res.body);
        expect(data.error).toMatch(/system folder/i);
    });

    it('Plans folder is not deleted even when delete is attempted', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        await request(treeUrl(srv)); // auto-creates Plans

        await deleteReq(deleteUrl(srv, 'Plans'));

        // Folder must still exist
        expect(fs.existsSync(path.join(notesRoot(), 'Plans'))).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Pages inside a system folder — not blocked
    // -------------------------------------------------------------------------

    it('PATCH /notes/path allows renaming a page inside Plans', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Create a page inside Plans
        const planFile = path.join(notesRoot(), 'Plans', 'my-plan.md');
        fs.mkdirSync(path.dirname(planFile), { recursive: true });
        fs.writeFileSync(planFile, '# Plan', 'utf-8');

        const res = await patchJSON(patchUrl(srv), {
            oldPath: 'Plans/my-plan.md',
            newPath: 'Plans/renamed-plan.md',
        });
        expect(res.status).toBe(200);
        expect(fs.existsSync(path.join(notesRoot(), 'Plans', 'renamed-plan.md'))).toBe(true);
    });

    it('DELETE /notes/path allows deleting a page inside Plans', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const planFile = path.join(notesRoot(), 'Plans', 'to-delete.md');
        fs.mkdirSync(path.dirname(planFile), { recursive: true });
        fs.writeFileSync(planFile, '# Delete me', 'utf-8');

        const res = await deleteReq(deleteUrl(srv, 'Plans/to-delete.md'));
        expect(res.status).toBe(204);
        expect(fs.existsSync(planFile)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Non-system folders — not affected
    // -------------------------------------------------------------------------

    it('PATCH /notes/path allows renaming a regular folder', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const regularDir = path.join(notesRoot(), 'MyFolder');
        fs.mkdirSync(regularDir, { recursive: true });

        const res = await patchJSON(patchUrl(srv), { oldPath: 'MyFolder', newPath: 'RenamedFolder' });
        expect(res.status).toBe(200);
    });

    it('DELETE /notes/path allows deleting a regular folder', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const regularDir = path.join(notesRoot(), 'ToDelete');
        fs.mkdirSync(regularDir, { recursive: true });

        const res = await deleteReq(deleteUrl(srv, 'ToDelete'));
        expect(res.status).toBe(204);
    });
});
