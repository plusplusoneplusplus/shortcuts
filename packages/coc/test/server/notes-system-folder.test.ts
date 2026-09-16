/**
 * Tests for the systemFolders concept in the Notes REST API:
 * - GET /notes/tree exposes and auto-creates system folders
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

    it('GET /notes/tree includes all system folders', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(treeUrl(srv));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.systemFolders).toEqual(['Plans', 'Sentinel']);
    });

    it.each(['Plans', 'Sentinel'])('GET /notes/tree auto-creates the %s folder', async (folderName) => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const systemDir = path.join(notesRoot(), folderName);
        expect(fs.existsSync(systemDir)).toBe(false);

        const res = await request(treeUrl(srv));
        expect(res.status).toBe(200);

        expect(fs.existsSync(systemDir)).toBe(true);
        expect(fs.statSync(systemDir).isDirectory()).toBe(true);
    });

    it('GET /notes/tree system folders appear in the tree', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        const res = await request(treeUrl(srv));
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        const names = (data.tree as Array<{ name: string }>).map(node => node.name);
        expect(names).toEqual(expect.arrayContaining(['Plans', 'Sentinel']));
    });

    // -------------------------------------------------------------------------
    // Rename — system folder root blocked
    // -------------------------------------------------------------------------

    it.each(['Plans', 'Sentinel'])('PATCH /notes/path returns 403 when renaming %s', async (folderName) => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Ensure the folder exists
        await request(treeUrl(srv));

        const res = await patchJSON(patchUrl(srv), { oldPath: folderName, newPath: `My${folderName}` });
        expect(res.status).toBe(403);
        const data = JSON.parse(res.body);
        expect(data.error).toMatch(/system folder/i);
    });

    it.each(['Plans', 'Sentinel'])(
        'PATCH /notes/path still blocks rename of pre-created %s',
        async (folderName) => {
            const srv = await startServer();
            await registerWorkspace(srv);

            fs.mkdirSync(path.join(notesRoot(), folderName), { recursive: true });

            const res = await patchJSON(patchUrl(srv), {
                oldPath: folderName,
                newPath: `Renamed${folderName}`,
            });
            expect(res.status).toBe(403);
        },
    );

    // -------------------------------------------------------------------------
    // Delete — system folder root blocked
    // -------------------------------------------------------------------------

    it.each(['Plans', 'Sentinel'])('DELETE /notes/path returns 403 when deleting %s', async (folderName) => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Ensure the folder exists
        await request(treeUrl(srv));

        const res = await deleteReq(deleteUrl(srv, folderName));
        expect(res.status).toBe(403);
        const data = JSON.parse(res.body);
        expect(data.error).toMatch(/system folder/i);
    });

    it.each(['Plans', 'Sentinel'])('%s is not deleted when delete is attempted', async (folderName) => {
        const srv = await startServer();
        await registerWorkspace(srv);

        await request(treeUrl(srv));

        await deleteReq(deleteUrl(srv, folderName));

        expect(fs.existsSync(path.join(notesRoot(), folderName))).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Pages inside a system folder — not blocked
    // -------------------------------------------------------------------------

    it.each(['Plans', 'Sentinel'])(
        'PATCH /notes/path allows renaming a page inside %s',
        async (folderName) => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const noteFile = path.join(notesRoot(), folderName, 'page.md');
            fs.mkdirSync(path.dirname(noteFile), { recursive: true });
            fs.writeFileSync(noteFile, '# Page', 'utf-8');

            const res = await patchJSON(patchUrl(srv), {
                oldPath: `${folderName}/page.md`,
                newPath: `${folderName}/renamed-page.md`,
            });
            expect(res.status).toBe(200);
            expect(fs.existsSync(path.join(notesRoot(), folderName, 'renamed-page.md'))).toBe(true);
        },
    );

    it.each(['Plans', 'Sentinel'])(
        'DELETE /notes/path allows deleting a page inside %s',
        async (folderName) => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const noteFile = path.join(notesRoot(), folderName, 'to-delete.md');
            fs.mkdirSync(path.dirname(noteFile), { recursive: true });
            fs.writeFileSync(noteFile, '# Delete me', 'utf-8');

            const res = await deleteReq(deleteUrl(srv, `${folderName}/to-delete.md`));
            expect(res.status).toBe(204);
            expect(fs.existsSync(noteFile)).toBe(false);
        },
    );

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
