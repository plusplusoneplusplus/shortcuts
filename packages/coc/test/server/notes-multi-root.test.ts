/**
 * Notes Multi-Root Tests
 *
 * Tests for the `root` query parameter on read-only notes endpoints:
 * - GET /api/workspaces/:id/notes/tree?root=...
 * - GET /api/workspaces/:id/notes/content?path=...&root=...
 * - GET /api/workspaces/:id/notes/search?q=...&root=...
 *
 * Verifies:
 * - Default root behavior unchanged (backward compat)
 * - Repo-folder root resolution via configured preferences
 * - System folder suppression for non-default roots
 * - rootId included in tree response
 * - Search scoped to selected root
 * - Security: unconfigured root rejected with 400
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '../../src/server/types';
import { writeRepoPreferences } from '../../src/server/preferences-handler';
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

// ============================================================================
// Tests
// ============================================================================

describe('Notes Multi-Root — read endpoints', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-multi-root-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-multi-root-ws-'));
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

    /** Write a file under the workspace git root (repo-folder root). */
    function writeRepoFile(relPath: string, content: string): void {
        const abs = path.join(workspaceDir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
    }

    /** Write a file under the default managed notes root (~/.coc area). */
    function writeDefaultNote(relPath: string, content: string): void {
        const notesRoot = getRepoDataPath(dataDir, wsId, 'notes');
        const abs = path.join(notesRoot, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
    }

    function configureRoots(roots: string[]): void {
        writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: roots });
    }

    // ========================================================================
    // Tree endpoint
    // ========================================================================

    describe('GET /notes/tree', () => {
        it('returns default root when no root param is provided', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeDefaultNote('hello.md', '# Hello');

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.rootId).toBe('default');
            expect(data.systemFolders.length).toBeGreaterThan(0);
            // Should contain the hello.md page
            const pages = data.tree.filter((n: any) => n.type === 'page');
            expect(pages.some((p: any) => p.name === 'hello.md')).toBe(true);
        });

        it('returns repo-folder root tree when root param is set', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Set up files in workspace repo
            writeRepoFile('docs/notes/guide.md', '# Guide');
            writeRepoFile('docs/notes/sub/nested.md', '# Nested');
            writeRepoFile('docs/notes/image.png', 'binary'); // non-md should be excluded
            configureRoots(['docs/notes']);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/tree?root=${encodeURIComponent('docs/notes')}`,
            );
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.rootId).toBe('docs/notes');
            // No system folders for non-default root
            expect(data.systemFolders).toEqual([]);
            // Should see the md file, not the png
            const allNames = flatNames(data.tree);
            expect(allNames).toContain('guide.md');
            expect(allNames).toContain('nested.md');
            expect(allNames).not.toContain('image.png');
        });

        it('returns 400 for unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/tree?root=${encodeURIComponent('unconfigured/path')}`,
            );
            expect(res.status).toBe(400);
            const data = JSON.parse(res.body);
            expect(data.error).toContain('not configured');
        });

        it('returns default root when root=default', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/tree?root=default`,
            );
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.rootId).toBe('default');
            expect(data.systemFolders.length).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // Content endpoint
    // ========================================================================

    describe('GET /notes/content', () => {
        it('reads content from default root (backward compat)', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeDefaultNote('readme.md', '# Default Root Note');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/content?path=${encodeURIComponent('readme.md')}`,
            );
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.content).toBe('# Default Root Note');
        });

        it('reads content from repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/guide.md', '# Repo Guide');
            configureRoots(['docs/notes']);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/content?path=${encodeURIComponent('guide.md')}&root=${encodeURIComponent('docs/notes')}`,
            );
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.content).toBe('# Repo Guide');
        });

        it('rejects path traversal outside repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/ok.md', 'ok');
            configureRoots(['docs/notes']);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/content?path=${encodeURIComponent('../../secret.md')}&root=${encodeURIComponent('docs/notes')}`,
            );
            expect(res.status).toBe(403);
        });

        it('returns 400 for unconfigured root on content endpoint', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/content?path=foo.md&root=nonexistent`,
            );
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Search endpoint
    // ========================================================================

    describe('GET /notes/search', () => {
        it('searches default root when no root param', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeDefaultNote('searchable.md', 'unique-default-keyword');

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/search?q=unique-default-keyword`,
            );
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.results.length).toBeGreaterThan(0);
        });

        it('searches only the repo-folder root when root param is set', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Put unique content in both roots
            writeDefaultNote('a.md', 'alpha-in-default');
            writeRepoFile('my-notes/b.md', 'beta-in-repo');
            configureRoots(['my-notes']);

            // Search the repo root — should find beta, not alpha
            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/search?q=beta-in-repo&root=${encodeURIComponent('my-notes')}`,
            );
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.results.length).toBeGreaterThan(0);

            // Search the repo root for default content — should NOT find alpha
            const res2 = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/search?q=alpha-in-default&root=${encodeURIComponent('my-notes')}`,
            );
            const data2 = JSON.parse(res2.body);
            expect(data2.results.length).toBe(0);
        });

        it('returns 400 for unconfigured root on search endpoint', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await request(
                `${srv.url}/api/workspaces/${wsId}/notes/search?q=test&root=bad`,
            );
            expect(res.status).toBe(400);
        });
    });
});

// ============================================================================
// Helpers
// ============================================================================

/** Recursively collect all node names from a tree. */
function flatNames(nodes: any[]): string[] {
    const names: string[] = [];
    for (const node of nodes) {
        names.push(node.name);
        if (node.children) {
            names.push(...flatNames(node.children));
        }
    }
    return names;
}
