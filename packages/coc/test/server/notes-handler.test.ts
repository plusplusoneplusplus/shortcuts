/**
 * Notes Handler Tests
 *
 * Comprehensive tests for the Notes REST API endpoints:
 * tree, content read/write, create, rename, delete, search.
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
import { validateConfigWithSchema } from '../../src/config/schema';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
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

/** POST JSON helper. */
function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** PUT JSON helper. */
function putJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** PATCH JSON helper. */
function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** DELETE helper. */
function deleteRequest(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-workspace-'));
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

    /** Register a workspace and return its ID. */
    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    /** Create note files under the notes directory for the workspace. */
    function createNoteFiles(files: Record<string, string>): void {
        const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(notesDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    // ========================================================================
    // Config Schema
    // ========================================================================

    describe('Config Schema', () => {
        it('should accept { notes: { enabled: true } }', () => {
            const config = validateConfigWithSchema({ notes: { enabled: true } });
            expect(config.notes?.enabled).toBe(true);
        });

        it('should accept { notes: { enabled: false } }', () => {
            const config = validateConfigWithSchema({ notes: { enabled: false } });
            expect(config.notes?.enabled).toBe(false);
        });

        it('should allow unknown keys in notes (passthrough)', () => {
            const config = validateConfigWithSchema({ notes: { enabled: true, foo: 'bar' } });
            expect(config.notes?.enabled).toBe(true);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/notes/tree — Tree
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/tree — Tree', () => {
        it('should return only system folders when notes directory does not exist', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Plans is auto-created as a system folder even when no user notes exist
            expect(body.tree).toHaveLength(1);
            expect(body.tree[0].name).toBe('Plans');
            expect(body.tree[0].type).toBe('notebook');
            expect(body.notesRoot).toBeTruthy();
            expect(body.systemFolders).toEqual(['Plans']);
        });

        it('should return correct hierarchy for nested notebooks/sections/pages', async () => {
            const srv = await startServer();
            createNoteFiles({
                'work/projects/project1.md': '# Project 1',
                'work/daily.md': '# Daily Notes',
                'personal/journal.md': '# Journal',
                'quick-note.md': '# Quick Note',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const tree = body.tree;

            // Top-level should have 3 notebooks (dirs) + 1 page (Plans auto-created as a system folder)
            expect(tree).toHaveLength(4);

            // Directories first, alphabetical (case-insensitive): personal, Plans, work
            expect(tree[0].name).toBe('personal');
            expect(tree[0].type).toBe('notebook');
            expect(tree[0].children).toHaveLength(1);
            expect(tree[0].children[0].name).toBe('journal.md');
            expect(tree[0].children[0].type).toBe('page');

            // Plans is the system folder auto-created between personal and work
            expect(tree[1].name).toBe('Plans');
            expect(tree[1].type).toBe('notebook');

            expect(tree[2].name).toBe('work');
            expect(tree[2].type).toBe('notebook');
            expect(tree[2].children).toHaveLength(2);
            // Nested dir 'projects' is a section
            expect(tree[2].children[0].name).toBe('projects');
            expect(tree[2].children[0].type).toBe('section');
            expect(tree[2].children[0].children).toHaveLength(1);
            expect(tree[2].children[0].children[0].name).toBe('project1.md');

            expect(tree[2].children[1].name).toBe('daily.md');
            expect(tree[2].children[1].type).toBe('page');
            expect(tree[2].children[1].lastModifiedAt).toEqual(expect.any(String));
            expect(Number.isNaN(Date.parse(tree[2].children[1].lastModifiedAt))).toBe(false);
            expect(tree[2].lastModifiedAt).toBeUndefined();

            // File last
            expect(tree[3].name).toBe('quick-note.md');
            expect(tree[3].type).toBe('page');
            expect(tree[3].lastModifiedAt).toEqual(expect.any(String));
        });

        it('should sort directories before files, alphabetically within each', async () => {
            const srv = await startServer();
            createNoteFiles({
                'zebra.md': '# Zebra',
                'alpha.md': '# Alpha',
                'beta/note.md': '# Beta',
                'aaaa/note.md': '# AAAA',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const tree = body.tree;

            // Dirs first: aaaa, beta, Plans (case-insensitive: a < b < p) — then files: alpha, zebra
            expect(tree[0].name).toBe('aaaa');
            expect(tree[1].name).toBe('beta');
            expect(tree[2].name).toBe('Plans');
            expect(tree[3].name).toBe('alpha.md');
            expect(tree[4].name).toBe('zebra.md');
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/notes/content — Content Read
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/content — Content Read', () => {
        it('should return markdown content and path for valid file', async () => {
            const srv = await startServer();
            const markdown = '# Hello World\n\nThis is a note.';
            createNoteFiles({ 'hello.md': markdown });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=hello.md`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(markdown);
            expect(body.path).toBe('hello.md');
        });

        it('should return content for nested file paths', async () => {
            const srv = await startServer();
            const markdown = '# Nested Note';
            createNoteFiles({ 'work/projects/design.md': markdown });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=work/projects/design.md`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(markdown);
            expect(body.path).toBe('work/projects/design.md');
        });

        it('should return 404 for non-existent file', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=nonexistent.md`);
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=../../../../../../etc/passwd`);
            expect(res.status).toBe(403);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('outside');
        });

        it('should return 400 when path query param is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/content`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('path');
        });
    });

    // ========================================================================
    // PUT /api/workspaces/:id/notes/content — Content Write (Autosave)
    // ========================================================================

    describe('PUT /api/workspaces/:id/notes/content — Content Write', () => {
        it('should create/overwrite file content and return updated true', async () => {
            const srv = await startServer();
            createNoteFiles({ 'test.md': 'original' });
            await registerWorkspace(srv, workspaceDir);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/content`, {
                path: 'test.md',
                content: 'updated content',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('test.md');
            expect(body.updated).toBe(true);

            // Verify content was written
            const readRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=test.md`);
            const readBody = JSON.parse(readRes.body);
            expect(readBody.content).toBe('updated content');
        });

        it('should return 403 for path outside notes root', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await putJSON(`${srv.url}/api/workspaces/${wsId}/notes/content`, {
                path: '../../../../../../tmp/evil.md',
                content: 'evil',
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/notes/page — Create
    // ========================================================================

    describe('POST /api/workspaces/:id/notes/page — Create', () => {
        it('should create notebook (directory) with type notebook, returns 201', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'my-notebook',
                type: 'notebook',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('my-notebook');
            expect(body.type).toBe('notebook');

            // Verify it shows in tree as notebook
            const treeRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(treeRes.body).tree;
            expect(tree[0].name).toBe('my-notebook');
            expect(tree[0].type).toBe('notebook');
        });

        it('should create section (directory) with type section, returns 201', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'notebook/my-section',
                type: 'section',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('notebook/my-section');
            expect(body.type).toBe('section');
        });

        it('should create page (empty .md file) with type page, returns 201', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'my-note.md',
                type: 'page',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('my-note.md');
            expect(body.type).toBe('page');

            // Verify it's an empty file
            const contentRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=my-note.md`);
            const content = JSON.parse(contentRes.body);
            expect(content.content).toBe('');
        });

        it('should auto-append .md when creating page without extension (regression)', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // UI sends name without .md (e.g. user typed "my-page" in the dialog)
            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'my-notebook/my-page',
                type: 'page',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('my-notebook/my-page.md');
            expect(body.type).toBe('page');

            // Page must appear in the tree (was previously invisible)
            const treeRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(treeRes.body).tree;
            expect(tree[0].name).toBe('my-notebook');
            expect(tree[0].type).toBe('notebook');
            expect(tree[0].children[0].name).toBe('my-page.md');
            expect(tree[0].children[0].type).toBe('page');
        });

        it('should not double-append .md when page path already has extension', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'my-page.md',
                type: 'page',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('my-page.md');

            // Content must be readable at the exact returned path
            const contentRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=my-page.md`);
            expect(contentRes.status).toBe(200);
        });

        it('should return 400 for missing path', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                type: 'page',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('path');
        });

        it('should return 400 for missing type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: 'test.md',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('type');
        });

        it('should return 403 for path traversal', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/notes/page`, {
                path: '../../evil',
                type: 'notebook',
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/notes/path — Rename
    // ========================================================================

    describe('PATCH /api/workspaces/:id/notes/path — Rename', () => {
        it('should rename file and return old and new paths', async () => {
            const srv = await startServer();
            createNoteFiles({ 'old-name.md': '# Old Name' });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'old-name.md',
                newPath: 'new-name.md',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.oldPath).toBe('old-name.md');
            expect(body.newPath).toBe('new-name.md');

            // Old path should be gone
            const oldRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=old-name.md`);
            expect(oldRes.status).toBe(404);

            // New path should exist
            const newRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=new-name.md`);
            expect(newRes.status).toBe(200);
            expect(JSON.parse(newRes.body).content).toBe('# Old Name');
        });

        it('should auto-append .md when renaming a page without extension', async () => {
            const srv = await startServer();
            const sidecarData = JSON.stringify({ threads: { t1: { id: 't1' } } });
            createNoteFiles({
                'old-name.md': '# Old Name',
                'old-name.md.comments.json': sidecarData,
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'old-name.md',
                newPath: 'new-name',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.oldPath).toBe('old-name.md');
            expect(body.newPath).toBe('new-name.md');

            const oldRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=old-name.md`);
            expect(oldRes.status).toBe(404);

            const newRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=new-name.md`);
            expect(newRes.status).toBe(200);
            expect(JSON.parse(newRes.body).content).toBe('# Old Name');

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            expect(fs.existsSync(path.join(notesDir, 'new-name.md.comments.json'))).toBe(true);
            expect(fs.existsSync(path.join(notesDir, 'old-name.md.comments.json'))).toBe(false);
        });

        it('should rename directory', async () => {
            const srv = await startServer();
            createNoteFiles({
                'old-dir/note1.md': '# Note 1',
                'old-dir/note2.md': '# Note 2',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'old-dir',
                newPath: 'new-dir',
            });
            expect(res.status).toBe(200);

            // Tree should show new-dir
            const treeRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(treeRes.body).tree;
            expect(tree.some((n: any) => n.name === 'new-dir')).toBe(true);
            expect(tree.some((n: any) => n.name === 'old-dir')).toBe(false);
        });

        it('should return 409 for collision (newPath already exists)', async () => {
            const srv = await startServer();
            createNoteFiles({
                'file-a.md': '# A',
                'file-b.md': '# B',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'file-a.md',
                newPath: 'file-b.md',
            });
            expect(res.status).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('already exists');
        });

        it('should return 409 when an implicit .md rename destination already exists', async () => {
            const srv = await startServer();
            createNoteFiles({
                'file-a.md': '# A',
                'file-b.md': '# B',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'file-a.md',
                newPath: 'file-b',
            });
            expect(res.status).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('already exists');

            const originalRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=file-a.md`);
            expect(originalRes.status).toBe(200);
        });

        it('should allow renaming a file when only casing changes', async () => {
            const srv = await startServer();
            const sidecarData = JSON.stringify({ threads: { t1: { id: 't1' } } });
            createNoteFiles({
                'Bugs.md': '# Bugs',
                'Bugs.md.comments.json': sidecarData,
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'Bugs.md',
                newPath: 'bugs.md',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.oldPath).toBe('Bugs.md');
            expect(body.newPath).toBe('bugs.md');

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            const entries = fs.readdirSync(notesDir);
            expect(entries).toContain('bugs.md');
            expect(entries).toContain('bugs.md.comments.json');
            expect(entries).not.toContain('Bugs.md');
            expect(entries).not.toContain('Bugs.md.comments.json');

            const newRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=bugs.md`);
            expect(newRes.status).toBe(200);
            expect(JSON.parse(newRes.body).content).toBe('# Bugs');
        });

        it('should allow renaming a directory when only casing changes', async () => {
            const srv = await startServer();
            createNoteFiles({ 'Bugs/issue.md': '# Issue' });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'Bugs',
                newPath: 'bugs',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.oldPath).toBe('Bugs');
            expect(body.newPath).toBe('bugs');

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            const entries = fs.readdirSync(notesDir);
            expect(entries).toContain('bugs');
            expect(entries).not.toContain('Bugs');

            const newRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=bugs/issue.md`);
            expect(newRes.status).toBe(200);
            expect(JSON.parse(newRes.body).content).toBe('# Issue');
        });

        it('should return 403 for path traversal', async () => {
            const srv = await startServer();
            createNoteFiles({ 'legit.md': '# Legit' });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'legit.md',
                newPath: '../../etc/evil.md',
            });
            expect(res.status).toBe(403);
        });

        it('should return 404 for non-existent source', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'nonexistent.md',
                newPath: 'new.md',
            });
            expect(res.status).toBe(404);
        });

        it('should rename sidecar .comments.json when renaming a page', async () => {
            const srv = await startServer();
            const sidecarData = JSON.stringify({ threads: { t1: { id: 't1' } } });
            createNoteFiles({
                'old-name.md': '# Old Name',
                'old-name.md.comments.json': sidecarData,
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'old-name.md',
                newPath: 'new-name.md',
            });
            expect(res.status).toBe(200);

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            // Old sidecar gone
            expect(fs.existsSync(path.join(notesDir, 'old-name.md.comments.json'))).toBe(false);
            // New sidecar exists with same content
            const newSidecar = fs.readFileSync(
                path.join(notesDir, 'new-name.md.comments.json'), 'utf-8'
            );
            expect(JSON.parse(newSidecar)).toEqual({ threads: { t1: { id: 't1' } } });
        });

        it('should succeed when renaming a page with no sidecar', async () => {
            const srv = await startServer();
            createNoteFiles({ 'solo.md': '# Solo' });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'solo.md',
                newPath: 'renamed-solo.md',
            });
            expect(res.status).toBe(200);
        });

        it('should move sidecars when renaming a directory', async () => {
            const srv = await startServer();
            createNoteFiles({
                'nb/page.md': '# Page',
                'nb/page.md.comments.json': '{"threads":{}}',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/notes/path`, {
                oldPath: 'nb',
                newPath: 'renamed-nb',
            });
            expect(res.status).toBe(200);

            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            expect(fs.existsSync(path.join(notesDir, 'renamed-nb', 'page.md'))).toBe(true);
            expect(fs.existsSync(path.join(notesDir, 'renamed-nb', 'page.md.comments.json'))).toBe(true);
            expect(fs.existsSync(path.join(notesDir, 'nb'))).toBe(false);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/notes/path — Delete
    // ========================================================================

    describe('DELETE /api/workspaces/:id/notes/path — Delete', () => {
        it('should delete file and return 204', async () => {
            const srv = await startServer();
            createNoteFiles({ 'to-delete.md': '# Delete me' });
            await registerWorkspace(srv, workspaceDir);

            const res = await deleteRequest(`${srv.url}/api/workspaces/${wsId}/notes/path?path=to-delete.md`);
            expect(res.status).toBe(204);

            // File should be gone
            const check = await request(`${srv.url}/api/workspaces/${wsId}/notes/content?path=to-delete.md`);
            expect(check.status).toBe(404);
        });

        it('should delete directory recursively and return 204', async () => {
            const srv = await startServer();
            createNoteFiles({
                'my-notebook/note1.md': '# Note 1',
                'my-notebook/sub/note2.md': '# Note 2',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await deleteRequest(`${srv.url}/api/workspaces/${wsId}/notes/path?path=my-notebook`);
            expect(res.status).toBe(204);

            // Directory should be gone from tree
            const treeRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/tree`);
            const tree = JSON.parse(treeRes.body).tree;
            expect(tree.some((n: any) => n.name === 'my-notebook')).toBe(false);
        });

        it('should return 404 for non-existent path', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await deleteRequest(`${srv.url}/api/workspaces/${wsId}/notes/path?path=nonexistent.md`);
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await deleteRequest(`${srv.url}/api/workspaces/${wsId}/notes/path?path=../../../../../../etc/passwd`);
            expect(res.status).toBe(403);
        });

        it('should delete sidecar .comments.json when deleting a page', async () => {
            const srv = await startServer();
            createNoteFiles({
                'commented.md': '# Has comments',
                'commented.md.comments.json': JSON.stringify({ threads: {} }),
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await deleteRequest(
                `${srv.url}/api/workspaces/${wsId}/notes/path?path=commented.md`
            );
            expect(res.status).toBe(204);

            // Both the page and its sidecar should be gone
            const notesDir = getRepoDataPath(dataDir, wsId, 'notes');
            expect(fs.existsSync(path.join(notesDir, 'commented.md'))).toBe(false);
            expect(fs.existsSync(path.join(notesDir, 'commented.md.comments.json'))).toBe(false);
        });

        it('should succeed when deleting a page with no sidecar', async () => {
            const srv = await startServer();
            createNoteFiles({ 'no-comments.md': '# No comments' });
            await registerWorkspace(srv, workspaceDir);

            const res = await deleteRequest(
                `${srv.url}/api/workspaces/${wsId}/notes/path?path=no-comments.md`
            );
            expect(res.status).toBe(204);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/notes/search — Search
    // ========================================================================

    describe('GET /api/workspaces/:id/notes/search — Search', () => {
        it('should return matching lines with line numbers', async () => {
            const srv = await startServer();
            createNoteFiles({
                'notes.md': 'line one\nfind me here\nline three\nfind me again',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search?q=find me`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.results).toHaveLength(1);
            expect(body.results[0].path).toBe('notes.md');
            // Content matches (line 2 and line 4)
            const contentMatches = body.results[0].matches.filter((m: any) => m.line > 0);
            expect(contentMatches).toHaveLength(2);
            expect(contentMatches[0].line).toBe(2);
            expect(contentMatches[0].text).toBe('find me here');
            expect(contentMatches[1].line).toBe(4);
            expect(contentMatches[1].text).toBe('find me again');
        });

        it('should be case-insensitive', async () => {
            const srv = await startServer();
            createNoteFiles({
                'mixed.md': 'Hello WORLD\nhello world\nHELLO World',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search?q=hello world`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.results).toHaveLength(1);
            const contentMatches = body.results[0].matches.filter((m: any) => m.line > 0);
            expect(contentMatches).toHaveLength(3);
        });

        it('should return empty results when no matches', async () => {
            const srv = await startServer();
            createNoteFiles({
                'test.md': 'nothing relevant here',
            });
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search?q=xyznonexistent`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.results).toHaveLength(0);
            expect(body.truncated).toBe(false);
        });

        it('should return empty results when notes root does not exist', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Don't create any note files — notes dir doesn't exist
            // But we need to make sure the parent dir exists without the notes subdir
            const notesRoot = getRepoDataPath(dataDir, wsId, 'notes');
            // Remove the notes dir if auto-created by workspace registration
            try { fs.rmSync(notesRoot, { recursive: true, force: true }); } catch { /* ignore */ }

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search?q=test`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.results).toHaveLength(0);
            expect(body.truncated).toBe(false);
        });

        it('should search both filename and content', async () => {
            const srv = await startServer();
            createNoteFiles({
                'meeting-notes.md': 'Discussed project timeline',
            });
            await registerWorkspace(srv, workspaceDir);

            // Search for "meeting" — should match filename
            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search?q=meeting`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.results).toHaveLength(1);
            // Should have filename match (line 0)
            const filenameMatch = body.results[0].matches.find((m: any) => m.line === 0);
            expect(filenameMatch).toBeDefined();
            expect(filenameMatch.text).toBe('meeting-notes.md');
        });

        it('should respect truncation caps', async () => {
            const srv = await startServer();
            // Create 60 files with matching content to exceed 50-file cap
            const files: Record<string, string> = {};
            for (let i = 0; i < 60; i++) {
                files[`note-${String(i).padStart(3, '0')}.md`] = 'target match content';
            }
            createNoteFiles(files);
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search?q=target`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.results.length).toBeLessThanOrEqual(50);
            expect(body.truncated).toBe(true);
        });

        it('should return 400 when q query param is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/search`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('q');
        });
    });
});
