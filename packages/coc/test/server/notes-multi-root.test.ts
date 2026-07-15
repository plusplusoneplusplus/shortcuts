/**
 * Notes Multi-Root Tests
 *
 * Tests for the `root` query parameter on read-only notes endpoints:
 * - GET /api/workspaces/:id/notes/tree?root=...
 * - GET /api/workspaces/:id/notes/content?path=...&root=...
 * - GET /api/workspaces/:id/notes/search?q=...&root=...
 *
 * Tests for write endpoints with multi-root:
 * - POST/PUT/PATCH/DELETE with root parameter
 *
 * Tests for git scoping:
 * - Git operations always operate on default managed root
 *
 * Verifies:
 * - Default root behavior unchanged (backward compat)
 * - Repo-folder root resolution via configured preferences
 * - System folder suppression for non-default roots
 * - rootId included in tree response
 * - Search scoped to selected root
 * - Security: unconfigured root rejected with 400
 * - Git operations scoped to default managed root only
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
// Write endpoints — multi-root support
// ============================================================================

describe('Notes Multi-Root — write endpoints', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-wr-multi-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-wr-multi-ws-'));
        wsId = 'test-ws-wr-' + Date.now();
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

    function writeRepoFile(relPath: string, content: string): void {
        const abs = path.join(workspaceDir, relPath);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
    }

    function configureRoots(roots: string[]): void {
        writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: roots });
    }

    function writeTaskSettings(folderPaths: string[]): void {
        const settingsPath = getRepoDataPath(dataDir, wsId, 'tasks-settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ folderPaths }, null, 2), 'utf-8');
    }

    function putJSON(urlStr: string, data: unknown): Promise<{ status: number; body: string }> {
        const body = JSON.stringify(data);
        return request(urlStr, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
            body,
        });
    }

    function patchJSON(urlStr: string, data: unknown): Promise<{ status: number; body: string }> {
        const body = JSON.stringify(data);
        return request(urlStr, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) },
            body,
        });
    }

    function deleteReq(urlStr: string): Promise<{ status: number; body: string }> {
        return request(urlStr, { method: 'DELETE' });
    }

    async function listRoots(srv: ExecutionServer): Promise<any[]> {
        const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/roots`);
        expect(res.status).toBe(200);
        return JSON.parse(res.body).roots;
    }

    // ========================================================================
    // Task-derived roots — normal Notes operations
    // ========================================================================

    describe('task-derived collections', () => {
        it('browses and edits primary, legacy, relative, and absolute task roots in isolation', async () => {
            const primaryRoot = getRepoDataPath(dataDir, wsId, 'tasks');
            const legacyRoot = path.join(workspaceDir, '.vscode', 'tasks');
            const relativeRoot = path.join(workspaceDir, 'plans', 'relative');
            const absoluteRoot = path.join(workspaceDir, 'configured-absolute-plans');
            const taskRoots = [
                { label: 'Task Plans', directory: primaryRoot },
                { label: 'Legacy Plans (.vscode/tasks)', directory: legacyRoot },
                { label: 'plans/relative', directory: relativeRoot },
                { label: absoluteRoot, directory: absoluteRoot },
            ];

            for (const [index, root] of taskRoots.entries()) {
                fs.mkdirSync(root.directory, { recursive: true });
                fs.writeFileSync(path.join(root.directory, 'shared.md'), `root-${index}`, 'utf-8');
                fs.writeFileSync(path.join(root.directory, 'existing.plan.md'), `plan-${index}`, 'utf-8');
                fs.writeFileSync(path.join(root.directory, 'existing.goal.md'), `goal-${index}`, 'utf-8');
            }
            writeTaskSettings(['plans/relative', absoluteRoot]);

            const managedRoot = getRepoDataPath(dataDir, wsId, 'notes');
            fs.mkdirSync(managedRoot, { recursive: true });
            fs.writeFileSync(path.join(managedRoot, 'shared.md'), 'managed', 'utf-8');

            const srv = await startServer();
            await registerWorkspace(srv);
            const listed = await listRoots(srv);

            for (const [index, root] of taskRoots.entries()) {
                const entry = listed.find(candidate => candidate.label === root.label);
                expect(entry).toMatchObject({ isDefault: false, isProtected: true });
                expect(entry.rootId).toMatch(/^task:[a-f0-9]{64}$/);

                const rootQuery = encodeURIComponent(entry.rootId);
                const treeRes = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/tree?root=${rootQuery}`,
                );
                expect(treeRes.status).toBe(200);
                const tree = JSON.parse(treeRes.body);
                expect(tree.rootId).toBe(entry.rootId);
                expect(tree.systemFolders).toEqual([]);
                expect(flatNames(tree.tree)).toEqual(expect.arrayContaining([
                    'shared.md',
                    'existing.plan.md',
                    'existing.goal.md',
                ]));

                for (const fileName of ['shared.md', 'existing.plan.md', 'existing.goal.md']) {
                    const contentRes = await request(
                        `${srv.url}/api/workspaces/${wsId}/notes/content?path=${encodeURIComponent(fileName)}&root=${rootQuery}`,
                    );
                    expect(contentRes.status).toBe(200);
                }

                const uniqueContent = `task-root-${index}-search-token`;
                const saveRes = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/content`, {
                    path: 'shared.md',
                    content: uniqueContent,
                    root: entry.rootId,
                });
                expect(saveRes.status).toBe(200);
                expect(fs.readFileSync(path.join(root.directory, 'shared.md'), 'utf-8')).toBe(uniqueContent);

                const createFolderRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                    path: 'drafts',
                    type: 'section',
                    root: entry.rootId,
                });
                expect(createFolderRes.status).toBe(201);
                const createPageRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                    path: 'drafts/new-plan.plan',
                    type: 'page',
                    root: entry.rootId,
                });
                expect(createPageRes.status).toBe(201);

                const renameRes = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                    oldPath: 'drafts/new-plan.plan.md',
                    newPath: 'drafts/renamed.goal.md',
                    root: entry.rootId,
                });
                expect(renameRes.status).toBe(200);
                expect(fs.existsSync(path.join(root.directory, 'drafts', 'renamed.goal.md'))).toBe(true);

                const orderRes = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                    parentPath: 'drafts',
                    order: ['renamed.goal.md'],
                    root: entry.rootId,
                });
                expect(orderRes.status).toBe(200);
                expect(JSON.parse(fs.readFileSync(path.join(root.directory, 'drafts', '.order.json'), 'utf-8')))
                    .toEqual({ order: ['renamed.goal.md'] });

                const searchRes = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/search?q=${uniqueContent}&root=${rootQuery}`,
                );
                expect(searchRes.status).toBe(200);
                expect(JSON.parse(searchRes.body).results).toEqual([
                    expect.objectContaining({ path: 'shared.md' }),
                ]);

                const deleteRes = await deleteReq(
                    `${srv.url}/api/workspaces/${wsId}/notes/path?path=${encodeURIComponent('drafts/renamed.goal.md')}&root=${rootQuery}`,
                );
                expect(deleteRes.status).toBe(204);
                expect(fs.existsSync(path.join(root.directory, 'drafts', 'renamed.goal.md'))).toBe(false);
            }

            expect(fs.readFileSync(path.join(managedRoot, 'shared.md'), 'utf-8')).toBe('managed');
            for (const [index, root] of taskRoots.entries()) {
                expect(fs.readFileSync(path.join(root.directory, 'shared.md'), 'utf-8'))
                    .toBe(`task-root-${index}-search-token`);
            }
        });

        it('rejects stale and cross-workspace task root identities', async () => {
            const primaryRoot = getRepoDataPath(dataDir, wsId, 'tasks');
            fs.mkdirSync(primaryRoot, { recursive: true });
            fs.writeFileSync(path.join(primaryRoot, 'shared.md'), 'first workspace', 'utf-8');

            const srv = await startServer();
            await registerWorkspace(srv);
            const listed = await listRoots(srv);
            const primaryEntry = listed.find(root => root.label === 'Task Plans');
            expect(primaryEntry?.rootId).toMatch(/^task:[a-f0-9]{64}$/);

            const otherWsId = `${wsId}-other`;
            const otherWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-task-root-other-ws-'));
            try {
                const otherPrimaryRoot = getRepoDataPath(dataDir, otherWsId, 'tasks');
                fs.mkdirSync(otherPrimaryRoot, { recursive: true });
                fs.writeFileSync(path.join(otherPrimaryRoot, 'shared.md'), 'second workspace', 'utf-8');
                const registered = await postJSON(`${srv.url}/api/workspaces`, {
                    id: otherWsId,
                    name: 'Other Workspace',
                    rootPath: otherWorkspaceDir,
                });
                expect(registered.status).toBe(201);

                const crossWorkspace = await request(
                    `${srv.url}/api/workspaces/${otherWsId}/notes/content?path=shared.md&root=${encodeURIComponent(primaryEntry.rootId)}`,
                );
                expect(crossWorkspace.status).toBe(400);
                expect(fs.readFileSync(path.join(otherPrimaryRoot, 'shared.md'), 'utf-8')).toBe('second workspace');

                fs.rmSync(primaryRoot, { recursive: true });
                const stale = await request(
                    `${srv.url}/api/workspaces/${wsId}/notes/content?path=shared.md&root=${encodeURIComponent(primaryEntry.rootId)}`,
                );
                expect(stale.status).toBe(400);
            } finally {
                await safeRm(otherWorkspaceDir);
            }
        });
    });

    // ========================================================================
    // POST /notes/page — Create page in repo-folder root
    // ========================================================================

    describe('POST /notes/page', () => {
        it('creates a page in a repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            // Ensure the repo-folder root directory exists
            fs.mkdirSync(path.join(workspaceDir, 'docs/notes'), { recursive: true });
            configureRoots(['docs/notes']);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'new-page',
                type: 'page',
                root: 'docs/notes',
            });
            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.path).toBe('new-page.md');

            // Verify the file was created under the repo-folder root
            const created = path.join(workspaceDir, 'docs/notes', 'new-page.md');
            expect(fs.existsSync(created)).toBe(true);
        });

        it('creates a notebook in a repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            fs.mkdirSync(path.join(workspaceDir, 'docs/notes'), { recursive: true });
            configureRoots(['docs/notes']);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'my-notebook',
                type: 'notebook',
                root: 'docs/notes',
            });
            expect(res.status).toBe(201);

            const created = path.join(workspaceDir, 'docs/notes', 'my-notebook');
            expect(fs.existsSync(created)).toBe(true);
            expect(fs.statSync(created).isDirectory()).toBe(true);
        });

        it('rejects create in unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'new-page',
                type: 'page',
                root: 'unconfigured',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // PUT /notes/content — Autosave in repo-folder root
    // ========================================================================

    describe('PUT /notes/content', () => {
        it('writes content to a repo-folder root note', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/existing.md', '# Old Content');
            configureRoots(['docs/notes']);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/content`, {
                path: 'existing.md',
                content: '# Updated Content',
                root: 'docs/notes',
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.updated).toBe(true);

            // Verify on disk
            const diskContent = fs.readFileSync(
                path.join(workspaceDir, 'docs/notes', 'existing.md'),
                'utf-8',
            );
            expect(diskContent).toBe('# Updated Content');
        });

        it('rejects path traversal via absolute path for non-default roots', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/ok.md', 'ok');
            configureRoots(['docs/notes']);

            // Use an absolute path pointing outside the repo-folder root
            const outsidePath = path.resolve(workspaceDir, '..', 'secret.md');
            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/content`, {
                path: outsidePath,
                content: 'hacked',
                root: 'docs/notes',
            });
            // Absolute path resolved relative to notesRoot becomes outside the root directory
            expect(res.status).toBe(403);
        });

        it('rejects path traversal outside repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/ok.md', 'ok');
            configureRoots(['docs/notes']);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/content`, {
                path: '../../etc/passwd',
                content: 'hacked',
                root: 'docs/notes',
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // PATCH /notes/path — Rename in repo-folder root
    // ========================================================================

    describe('PATCH /notes/path', () => {
        it('renames a note in a repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/old-name.md', '# My Note');
            configureRoots(['docs/notes']);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'old-name.md',
                newPath: 'new-name.md',
                root: 'docs/notes',
            });
            expect(res.status).toBe(200);

            // Old path should be gone, new path should exist
            expect(fs.existsSync(path.join(workspaceDir, 'docs/notes', 'old-name.md'))).toBe(false);
            expect(fs.existsSync(path.join(workspaceDir, 'docs/notes', 'new-name.md'))).toBe(true);
        });

        it('rejects rename in unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'a.md',
                newPath: 'b.md',
                root: 'bad-root',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // DELETE /notes/path — Delete in repo-folder root
    // ========================================================================

    describe('DELETE /notes/path', () => {
        it('deletes a note in a repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/to-delete.md', '# Delete me');
            configureRoots(['docs/notes']);

            const res = await deleteReq(
                `${srv.url}/api/workspaces/${wsId}/notes/path?path=${encodeURIComponent('to-delete.md')}&root=${encodeURIComponent('docs/notes')}`,
            );
            expect(res.status).toBe(204);

            // Verify file is removed
            expect(fs.existsSync(path.join(workspaceDir, 'docs/notes', 'to-delete.md'))).toBe(false);
        });

        it('deletes a directory in a repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/subdir/page.md', '# Page');
            configureRoots(['docs/notes']);

            const res = await deleteReq(
                `${srv.url}/api/workspaces/${wsId}/notes/path?path=subdir&root=${encodeURIComponent('docs/notes')}`,
            );
            expect(res.status).toBe(204);
            expect(fs.existsSync(path.join(workspaceDir, 'docs/notes', 'subdir'))).toBe(false);
        });

        it('rejects delete with unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await deleteReq(
                `${srv.url}/api/workspaces/${wsId}/notes/path?path=x.md&root=bogus`,
            );
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // PUT /notes/order — Order in repo-folder root
    // ========================================================================

    describe('PUT /notes/order', () => {
        it('persists order in a repo-folder root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/a.md', 'a');
            writeRepoFile('docs/notes/b.md', 'b');
            configureRoots(['docs/notes']);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: '',
                order: ['b.md', 'a.md'],
                root: 'docs/notes',
            });
            expect(res.status).toBe(200);

            // Verify .order.json was written in the repo-folder root
            const orderPath = path.join(workspaceDir, 'docs/notes', '.order.json');
            expect(fs.existsSync(orderPath)).toBe(true);
            const orderContent = JSON.parse(fs.readFileSync(orderPath, 'utf-8'));
            expect(orderContent).toEqual({ order: ['b.md', 'a.md'] });
        });

        it('rejects order with unconfigured root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/order`, {
                parentPath: '',
                order: ['a.md'],
                root: 'nope',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Git scoping — git endpoints always operate on default managed root
    // ========================================================================

    describe('git scoping', () => {
        it('git init operates on default managed root regardless of configured repo-folder roots', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            writeRepoFile('docs/notes/page.md', '# Hello');
            configureRoots(['docs/notes']);

            // Initialize git on the default root
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/git/init`, {});
            expect(res.status).toBe(200);

            // .git should exist in the default managed root, NOT in the repo-folder root
            const defaultRoot = getRepoDataPath(dataDir, wsId, 'notes');
            expect(fs.existsSync(path.join(defaultRoot, '.git'))).toBe(true);
            expect(fs.existsSync(path.join(workspaceDir, 'docs/notes', '.git'))).toBe(false);
        });

        it('git status returns status of default managed root only', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            configureRoots(['docs/notes']);

            // Status with no git init — returns uninitialized
            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/git/status`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.initialized).toBe(false);

            // Init and check again
            await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/git/init`, {});
            const res2 = await request(`${srv.url}/api/workspaces/${wsId}/notes/git/status`);
            expect(res2.status).toBe(200);
            const body2 = JSON.parse(res2.body);
            expect(body2.initialized).toBe(true);
        });

        it('git commit applies only to files in the default managed root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);

            // Configure a repo-folder root and write a note there
            writeRepoFile('docs/notes/repo-note.md', '# Repo Note');
            configureRoots(['docs/notes']);

            // Init git on the default managed root first
            await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/git/init`, {});

            // Write a note in the default managed root AFTER init so there's a change to commit
            const defaultRoot = getRepoDataPath(dataDir, wsId, 'notes');
            fs.writeFileSync(path.join(defaultRoot, 'managed-note.md'), '# Managed Note', 'utf-8');

            // Commit
            const commitRes = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/git/commit`, {
                message: 'test commit',
            });
            expect(commitRes.status).toBe(200);
            const commitBody = JSON.parse(commitRes.body);
            expect(commitBody.committed).toBe(true);

            // Verify the log shows the commit
            const logRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/git/log`);
            expect(logRes.status).toBe(200);
            const logBody = JSON.parse(logRes.body);
            expect(logBody.entries.length).toBeGreaterThanOrEqual(2);
            // Most recent commit is our test commit
            expect(logBody.entries[0].message).toBe('test commit');
        });

        it('git log returns only the initial commit when no additional commits made', async () => {
            const srv = await startServer();
            await registerWorkspace(srv);
            configureRoots(['docs/notes']);

            // Init but don't commit anything new
            await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/git/init`, {});
            const logRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/git/log`);
            expect(logRes.status).toBe(200);
            const logBody = JSON.parse(logRes.body);
            // Only the initial commit from git init
            expect(logBody.entries.length).toBe(1);
            expect(logBody.entries[0].message).toContain('Initial');
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
