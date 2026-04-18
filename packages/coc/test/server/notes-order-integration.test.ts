/**
 * Notes Order Integration Tests
 *
 * Tests for the .order.json-based custom sort order:
 *   - buildTree respects .order.json
 *   - PUT /notes/order endpoint
 *   - Rename updates .order.json
 *   - Delete removes from .order.json
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';
import { ORDER_FILE_NAME } from '../../src/server/notes-order';

// ── HTTP helpers ───────────────────────────────────────────────────────

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
                method: options.method || 'GET',
                headers: options.headers,
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () =>
                    resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }),
                );
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function putJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
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

function deleteReq(url: string) {
    return request(url, { method: 'DELETE' });
}

// ── Test fixture helpers ───────────────────────────────────────────────

describe('Notes Order — Integration', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-order-int-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-order-ws-'));
        wsId = 'test-ws-order-' + Date.now();
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

    async function registerWorkspace(srv: ExecutionServer): Promise<void> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test',
            rootPath: workspaceDir,
        });
        expect(res.status).toBe(201);
    }

    function notesDir(): string {
        return getRepoDataPath(dataDir, wsId, 'notes');
    }

    function createFiles(files: Record<string, string>): void {
        const root = notesDir();
        for (const [p, c] of Object.entries(files)) {
            const full = path.join(root, p);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, c, 'utf-8');
        }
    }

    function writeOrder(relDir: string, order: string[]): void {
        const dir = path.join(notesDir(), relDir);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, ORDER_FILE_NAME), JSON.stringify({ order }, null, 2), 'utf-8');
    }

    function readOrder(relDir: string): string[] {
        try {
            const raw = fs.readFileSync(path.join(notesDir(), relDir, ORDER_FILE_NAME), 'utf-8');
            return JSON.parse(raw).order ?? [];
        } catch {
            return [];
        }
    }

    // ── buildTree respects .order.json ────────────────────────────────

    describe('buildTree — respects .order.json', () => {
        it('returns tree in alphabetical (dirs-first) order when no .order.json exists', async () => {
            const srv = await startServer();
            createFiles({
                'zebra/x.md': '',
                'alpha/x.md': '',
                'note.md': '',
            });
            await registerWorkspace(srv);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(res.body);

            // Default: dirs first (alpha, zebra), then files (note.md)
            expect(tree[0].name).toBe('alpha');
            expect(tree[1].name).toBe('zebra');
            expect(tree[2].name).toBe('note.md');
        });

        it('returns tree in custom order when .order.json is present at root', async () => {
            const srv = await startServer();
            createFiles({
                'alpha/x.md': '',
                'beta/x.md': '',
                'gamma/x.md': '',
            });
            // Custom order: gamma first, then alpha, then beta
            writeOrder('', ['gamma', 'beta', 'alpha']);
            await registerWorkspace(srv);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(res.body);

            expect(tree[0].name).toBe('gamma');
            expect(tree[1].name).toBe('beta');
            expect(tree[2].name).toBe('alpha');
        });

        it('puts unlisted items after explicitly-ordered items, in default order', async () => {
            const srv = await startServer();
            createFiles({
                'alpha/x.md': '',
                'beta/x.md': '',
                'gamma/x.md': '',
                'z-page.md': '',
                'a-page.md': '',
            });
            // Only order the directories; pages are unlisted
            writeOrder('', ['gamma', 'alpha']);
            await registerWorkspace(srv);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(res.body);

            // gamma and alpha come first (explicitly ordered)
            expect(tree[0].name).toBe('gamma');
            expect(tree[1].name).toBe('alpha');
            // Then unlisted items in default order (dirs before files, alphabetical)
            expect(tree[2].name).toBe('beta');
            expect(tree[3].name).toBe('a-page.md');
            expect(tree[4].name).toBe('z-page.md');
        });

        it('applies .order.json inside a nested notebook', async () => {
            const srv = await startServer();
            createFiles({
                'notebook/section-a/x.md': '',
                'notebook/section-b/x.md': '',
                'notebook/page-z.md': '',
                'notebook/page-a.md': '',
            });
            // Order inside notebook: sections after pages (reverse of default)
            writeOrder('notebook', ['page-z.md', 'page-a.md', 'section-b', 'section-a']);
            await registerWorkspace(srv);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(res.body);
            const nb = tree.find((n: any) => n.name === 'notebook');
            expect(nb).toBeDefined();

            expect(nb.children[0].name).toBe('page-z.md');
            expect(nb.children[1].name).toBe('page-a.md');
            expect(nb.children[2].name).toBe('section-b');
            expect(nb.children[3].name).toBe('section-a');
        });
    });

    // ── PUT /notes/order endpoint ─────────────────────────────────────

    describe('PUT /api/workspaces/:id/notes/order', () => {
        it('writes .order.json for root (parentPath = "") and returns 200', async () => {
            const srv = await startServer();
            createFiles({ 'alpha/x.md': '', 'beta/x.md': '' });
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: '',
                order: ['beta', 'alpha'],
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.parentPath).toBe('');
            expect(body.order).toEqual(['beta', 'alpha']);

            // Verify it was written to disk
            expect(readOrder('')).toEqual(['beta', 'alpha']);
        });

        it('writes .order.json for a nested directory', async () => {
            const srv = await startServer();
            createFiles({ 'work/section-a/x.md': '', 'work/section-b/x.md': '' });
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: 'work',
                order: ['section-b', 'section-a'],
            });
            expect(res.status).toBe(200);
            expect(readOrder('work')).toEqual(['section-b', 'section-a']);
        });

        it('reflects new order in subsequent tree fetch', async () => {
            const srv = await startServer();
            createFiles({ 'z-nb/x.md': '', 'a-nb/x.md': '' });
            await registerWorkspace(srv);

            // Default: a-nb before z-nb
            const before = JSON.parse((await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`)).body);
            expect(before[0].name).toBe('a-nb');

            // Reorder to put z-nb first
            await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: '',
                order: ['z-nb', 'a-nb'],
            });

            const after = JSON.parse((await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`)).body);
            expect(after[0].name).toBe('z-nb');
            expect(after[1].name).toBe('a-nb');
        });

        it('returns 400 when parentPath is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                order: ['a', 'b'],
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when order is not an array', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: '',
                order: 'not-an-array',
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 when parentPath directory does not exist', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: 'nonexistent-dir',
                order: ['a'],
            });
            expect(res.status).toBe(404);
        });

        it('returns 403 for path traversal', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: '../../etc',
                order: ['x'],
            });
            expect(res.status).toBe(403);
        });
    });

    // ── Rename updates .order.json ────────────────────────────────────

    describe('PATCH /notes/path — updates .order.json on rename', () => {
        it('renames entry in parent .order.json when name changes within same parent', async () => {
            const srv = await startServer();
            createFiles({ 'alpha.md': '', 'beta.md': '', 'gamma.md': '' });
            writeOrder('', ['gamma.md', 'beta.md', 'alpha.md']);
            await registerWorkspace(srv);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'beta.md',
                newPath: 'renamed-beta.md',
            });
            expect(res.status).toBe(200);

            expect(readOrder('')).toEqual(['gamma.md', 'renamed-beta.md', 'alpha.md']);
        });

        it('removes from old parent .order.json on cross-parent move', async () => {
            const srv = await startServer();
            createFiles({ 'nb-a/page.md': '', 'nb-b/x.md': '' });
            writeOrder('nb-a', ['page.md']);
            await registerWorkspace(srv);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'nb-a/page.md',
                newPath: 'nb-b/page.md',
            });
            expect(res.status).toBe(200);

            // Removed from source parent order
            expect(readOrder('nb-a')).toEqual([]);
        });

        it('leaves .order.json intact for same-parent rename when no order file exists', async () => {
            const srv = await startServer();
            createFiles({ 'page.md': '' });
            await registerWorkspace(srv);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'page.md',
                newPath: 'renamed.md',
            });
            expect(res.status).toBe(200);
            // No .order.json was created
            expect(fs.existsSync(path.join(notesDir(), ORDER_FILE_NAME))).toBe(false);
        });
    });

    // ── Delete removes from .order.json ──────────────────────────────

    describe('DELETE /notes/path — removes from .order.json on delete', () => {
        it('removes deleted page from parent .order.json', async () => {
            const srv = await startServer();
            createFiles({ 'alpha.md': '', 'beta.md': '' });
            writeOrder('', ['beta.md', 'alpha.md']);
            await registerWorkspace(srv);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/notes/path?path=beta.md`);
            expect(res.status).toBe(204);

            expect(readOrder('')).toEqual(['alpha.md']);
        });

        it('removes deleted directory from parent .order.json', async () => {
            const srv = await startServer();
            createFiles({ 'nb-a/x.md': '', 'nb-b/x.md': '' });
            writeOrder('', ['nb-b', 'nb-a']);
            await registerWorkspace(srv);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/notes/path?path=nb-a`);
            expect(res.status).toBe(204);

            expect(readOrder('')).toEqual(['nb-b']);
        });

        it('no-ops when .order.json does not exist', async () => {
            const srv = await startServer();
            createFiles({ 'page.md': '' });
            await registerWorkspace(srv);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/notes/path?path=page.md`);
            expect(res.status).toBe(204);
            // Should not throw or create an empty .order.json
            expect(fs.existsSync(path.join(notesDir(), ORDER_FILE_NAME))).toBe(false);
        });
    });
});
