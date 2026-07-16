/**
 * Notes Comments Multi-Root Tests
 *
 * Tests for the `root` parameter on comment endpoints, verifying:
 * - Default root sidecar remains co-located (backward compat)
 * - Repo-folder root sidecars are stored in managed area (~/.coc/repos/<wsId>/notes-comments/)
 * - Full CRUD cycle for comments on repo-folder root notes
 * - Sidecar isolation: comments on different roots don't interfere
 * - Unconfigured root rejected with 400
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
import { encodeRootPath } from '../../src/server/notes/notes-root-resolver';
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

function putJSON(url: string, data: unknown): Promise<{ status: number; body: string }> {
    const body = JSON.stringify(data);
    return request(url, {
        method: 'PUT',
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

function deleteRequest(url: string): Promise<{ status: number; body: string }> {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Notes Comments Multi-Root', { timeout: 30_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;
    const REPO_ROOT = 'docs/notes';

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-comments-mr-data-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-comments-mr-ws-'));
        wsId = 'cmr-ws-' + Date.now();

        // Create workspace repo folder structure
        const repoNotesDir = path.join(workspaceDir, REPO_ROOT);
        fs.mkdirSync(repoNotesDir, { recursive: true });
        fs.writeFileSync(path.join(repoNotesDir, 'page.md'), '# Hello\n\nSome text here.');
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        safeRm(dataDir);
        safeRm(workspaceDir);
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
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

    function configureRoot(): void {
        writeRepoPreferences(dataDir, wsId, { additionalNotesRoots: [REPO_ROOT] });
    }

    function writeTaskSettings(folderPaths: string[]): void {
        const settingsPath = getRepoDataPath(dataDir, wsId, 'tasks-settings.json');
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify({ folderPaths }, null, 2), 'utf-8');
    }

    async function listRoots(srv: ExecutionServer): Promise<any[]> {
        const res = await request(`${srv.url}/api/workspaces/${wsId}/notes/roots`);
        expect(res.status).toBe(200);
        return JSON.parse(res.body).roots;
    }

    function commentsUrl(srv: ExecutionServer, subpath = '', query = ''): string {
        const base = `${srv.url}/api/workspaces/${wsId}/notes/comments`;
        const full = subpath ? `${base}/${subpath}` : base;
        return query ? `${full}?${query}` : full;
    }

    // ========================================================================
    // 1. GET on repo-folder root returns empty sidecar
    // ========================================================================
    it('GET returns empty sidecar for uncreated repo-folder root note', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        configureRoot();

        const res = await request(
            commentsUrl(srv, '', `path=page.md&root=${encodeURIComponent(REPO_ROOT)}`),
        );
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data).toEqual({ version: 1, threads: {} });
    });

    // ========================================================================
    // 2. POST create thread on repo-folder root stores in managed area
    // ========================================================================
    it('POST creates thread for repo-folder root and stores sidecar in managed area', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        configureRoot();

        const res = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            root: REPO_ROOT,
            thread: {
                anchor: { quotedText: 'hello', prefix: '', suffix: '' },
                comments: [{ content: 'Test comment on repo root' }],
            },
        });
        expect(res.status).toBe(201);
        const { thread } = JSON.parse(res.body);
        expect(thread.comments[0].content).toBe('Test comment on repo root');

        // Verify sidecar is NOT co-located in the repo folder
        const colocatedPath = path.join(workspaceDir, REPO_ROOT, 'page.md.comments.json');
        expect(fs.existsSync(colocatedPath)).toBe(false);

        // Verify sidecar IS in the managed area
        const encoded = encodeRootPath(REPO_ROOT);
        const managedPath = path.join(dataDir, 'repos', wsId, 'notes-comments', encoded, 'page.md.comments.json');
        expect(fs.existsSync(managedPath)).toBe(true);
        const stored = JSON.parse(fs.readFileSync(managedPath, 'utf-8'));
        expect(stored.threads[thread.id]).toBeDefined();
    });

    // ========================================================================
    // 3. Full CRUD cycle on repo-folder root
    // ========================================================================
    it('full CRUD cycle works for repo-folder root comments', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        configureRoot();

        // Create thread
        const createRes = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            root: REPO_ROOT,
            thread: {
                anchor: { quotedText: 'Some text', prefix: '', suffix: '' },
                comments: [{ content: 'Initial comment' }],
            },
        });
        expect(createRes.status).toBe(201);
        const { thread } = JSON.parse(createRes.body);
        const threadId = thread.id;
        const commentId = thread.comments[0].id;

        // GET to verify
        const getRes = await request(
            commentsUrl(srv, '', `path=page.md&root=${encodeURIComponent(REPO_ROOT)}`),
        );
        expect(getRes.status).toBe(200);
        const sidecar = JSON.parse(getRes.body);
        expect(Object.keys(sidecar.threads)).toHaveLength(1);

        // Add comment to thread
        const addRes = await postJSON(commentsUrl(srv, `thread/${threadId}/comment`), {
            path: 'page.md',
            root: REPO_ROOT,
            content: 'Follow-up comment',
        });
        expect(addRes.status).toBe(201);
        const newComment = JSON.parse(addRes.body).comment;

        // Patch thread status (resolve)
        const patchRes = await patchJSON(commentsUrl(srv, `thread/${threadId}`), {
            path: 'page.md',
            root: REPO_ROOT,
            status: 'resolved',
        });
        expect(patchRes.status).toBe(200);
        expect(JSON.parse(patchRes.body).thread.status).toBe('resolved');

        // Edit comment
        const editRes = await patchJSON(commentsUrl(srv, `thread/${threadId}/comment/${commentId}`), {
            path: 'page.md',
            root: REPO_ROOT,
            content: 'Updated comment',
        });
        expect(editRes.status).toBe(200);
        expect(JSON.parse(editRes.body).comment.content).toBe('Updated comment');

        // Delete comment
        const delCommentRes = await deleteRequest(
            commentsUrl(srv, `thread/${threadId}/comment/${newComment.id}`, `path=page.md&root=${encodeURIComponent(REPO_ROOT)}`),
        );
        expect(delCommentRes.status).toBe(204);

        // Delete thread
        const delThreadRes = await deleteRequest(
            commentsUrl(srv, `thread/${threadId}`, `path=page.md&root=${encodeURIComponent(REPO_ROOT)}`),
        );
        expect(delThreadRes.status).toBe(204);

        // GET should be empty
        const finalRes = await request(
            commentsUrl(srv, '', `path=page.md&root=${encodeURIComponent(REPO_ROOT)}`),
        );
        expect(JSON.parse(finalRes.body).threads).toEqual({});
    });

    it('keeps full comment CRUD isolated across every task-derived collection', async () => {
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

        for (const root of taskRoots) {
            fs.mkdirSync(root.directory, { recursive: true });
            fs.writeFileSync(path.join(root.directory, 'shared.plan.md'), '# Shared plan', 'utf-8');
        }
        writeTaskSettings(['plans/relative', absoluteRoot]);

        const srv = await startServer();
        await registerWorkspace(srv);
        const listed = await listRoots(srv);
        const entries = taskRoots.map(root => {
            const entry = listed.find(candidate => candidate.label === root.label);
            expect(entry).toMatchObject({ isDefault: false, isProtected: true });
            expect(entry.rootId).toMatch(/^task:[a-f0-9]{64}$/);
            return { ...root, rootId: entry.rootId as string };
        });
        expect(new Set(entries.map(entry => entry.rootId)).size).toBe(taskRoots.length);

        const created = [];
        for (const [index, entry] of entries.entries()) {
            const createRes = await postJSON(commentsUrl(srv, 'thread'), {
                path: 'shared.plan.md',
                root: entry.rootId,
                thread: {
                    anchor: { quotedText: 'Shared plan', prefix: '', suffix: '' },
                    comments: [{ content: `root-${index}-initial` }],
                },
            });
            expect(createRes.status).toBe(201);
            const thread = JSON.parse(createRes.body).thread;
            created.push({ ...entry, threadId: thread.id as string, commentId: thread.comments[0].id as string });

            const managedPath = path.join(
                dataDir,
                'repos',
                wsId,
                'notes-comments',
                encodeRootPath(entry.rootId),
                'shared.plan.md.comments.json',
            );
            expect(fs.existsSync(managedPath)).toBe(true);
            expect(fs.existsSync(path.join(entry.directory, 'shared.plan.md.comments.json'))).toBe(false);
        }

        for (const [index, entry] of created.entries()) {
            const rootQuery = encodeURIComponent(entry.rootId);
            const getRes = await request(
                commentsUrl(srv, '', `path=shared.plan.md&root=${rootQuery}`),
            );
            expect(getRes.status).toBe(200);
            const threads = Object.values(JSON.parse(getRes.body).threads) as any[];
            expect(threads).toHaveLength(1);
            expect(threads[0].comments.map((comment: any) => comment.content)).toEqual([
                `root-${index}-initial`,
            ]);

            const addRes = await postJSON(commentsUrl(srv, `thread/${entry.threadId}/comment`), {
                path: 'shared.plan.md',
                root: entry.rootId,
                content: `root-${index}-follow-up`,
            });
            expect(addRes.status).toBe(201);
            const addedCommentId = JSON.parse(addRes.body).comment.id as string;

            const resolveRes = await patchJSON(commentsUrl(srv, `thread/${entry.threadId}`), {
                path: 'shared.plan.md',
                root: entry.rootId,
                status: 'resolved',
            });
            expect(resolveRes.status).toBe(200);
            expect(JSON.parse(resolveRes.body).thread.status).toBe('resolved');

            const editRes = await patchJSON(
                commentsUrl(srv, `thread/${entry.threadId}/comment/${entry.commentId}`),
                {
                    path: 'shared.plan.md',
                    root: entry.rootId,
                    content: `root-${index}-edited`,
                },
            );
            expect(editRes.status).toBe(200);
            expect(JSON.parse(editRes.body).comment.content).toBe(`root-${index}-edited`);

            const deleteCommentRes = await deleteRequest(
                commentsUrl(
                    srv,
                    `thread/${entry.threadId}/comment/${addedCommentId}`,
                    `path=shared.plan.md&root=${rootQuery}`,
                ),
            );
            expect(deleteCommentRes.status).toBe(204);

            const isolatedRes = await request(
                commentsUrl(srv, '', `path=shared.plan.md&root=${rootQuery}`),
            );
            const isolatedThreads = Object.values(JSON.parse(isolatedRes.body).threads) as any[];
            expect(isolatedThreads).toHaveLength(1);
            expect(isolatedThreads[0].comments.map((comment: any) => comment.content)).toEqual([
                `root-${index}-edited`,
            ]);

            const deleteThreadRes = await deleteRequest(
                commentsUrl(
                    srv,
                    `thread/${entry.threadId}`,
                    `path=shared.plan.md&root=${rootQuery}`,
                ),
            );
            expect(deleteThreadRes.status).toBe(204);
        }

        for (const entry of created) {
            const finalRes = await request(
                commentsUrl(
                    srv,
                    '',
                    `path=shared.plan.md&root=${encodeURIComponent(entry.rootId)}`,
                ),
            );
            expect(JSON.parse(finalRes.body).threads).toEqual({});
        }
    });

    // ========================================================================
    // 4. Sidecar isolation: default and repo-folder roots don't interfere
    // ========================================================================
    it('comments on default root and repo-folder root are isolated', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        configureRoot();

        // Create on default root
        const defaultRes = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            thread: {
                anchor: { quotedText: 'default', prefix: '', suffix: '' },
                comments: [{ content: 'Default root comment' }],
            },
        });
        expect(defaultRes.status).toBe(201);

        // Create on repo-folder root
        const repoRes = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            root: REPO_ROOT,
            thread: {
                anchor: { quotedText: 'repo', prefix: '', suffix: '' },
                comments: [{ content: 'Repo root comment' }],
            },
        });
        expect(repoRes.status).toBe(201);

        // GET default root — should have 1 thread
        const getDefault = await request(commentsUrl(srv, '', 'path=page.md'));
        const defaultSidecar = JSON.parse(getDefault.body);
        expect(Object.keys(defaultSidecar.threads)).toHaveLength(1);
        const defaultThread = Object.values(defaultSidecar.threads)[0] as any;
        expect(defaultThread.comments[0].content).toBe('Default root comment');

        // GET repo-folder root — should have 1 thread (different)
        const getRepo = await request(
            commentsUrl(srv, '', `path=page.md&root=${encodeURIComponent(REPO_ROOT)}`),
        );
        const repoSidecar = JSON.parse(getRepo.body);
        expect(Object.keys(repoSidecar.threads)).toHaveLength(1);
        const repoThread = Object.values(repoSidecar.threads)[0] as any;
        expect(repoThread.comments[0].content).toBe('Repo root comment');
    });

    // ========================================================================
    // 5. Unconfigured root rejected with 400
    // ========================================================================
    it('rejects comment operations on unconfigured root with 400', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        // NOTE: do NOT configure the root

        const getRes = await request(
            commentsUrl(srv, '', `path=page.md&root=${encodeURIComponent('unconfigured/path')}`),
        );
        expect(getRes.status).toBe(400);

        const postRes = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            root: 'unconfigured/path',
            thread: {
                anchor: { quotedText: 'x', prefix: '', suffix: '' },
                comments: [{ content: 'nope' }],
            },
        });
        expect(postRes.status).toBe(400);
    });

    it('rejects task-root comment paths that escape through traversal or symlinks', async () => {
        const primaryRoot = getRepoDataPath(dataDir, wsId, 'tasks');
        const outsideRoot = getRepoDataPath(dataDir, wsId, 'outside-comments-root');
        fs.mkdirSync(primaryRoot, { recursive: true });
        fs.mkdirSync(outsideRoot, { recursive: true });
        fs.writeFileSync(path.join(primaryRoot, 'page.md'), '# Task plan', 'utf-8');
        fs.writeFileSync(path.join(outsideRoot, 'secret.md'), '# Secret', 'utf-8');
        fs.symlinkSync(
            outsideRoot,
            path.join(primaryRoot, 'escape'),
            process.platform === 'win32' ? 'junction' : 'dir',
        );

        const srv = await startServer();
        await registerWorkspace(srv);
        const rootsRes = await request(`${srv.url}/api/workspaces/${wsId}/notes/roots`);
        expect(rootsRes.status).toBe(200);
        const rootId = JSON.parse(rootsRes.body).roots.find((root: any) => root.label === 'Task Plans')?.rootId;
        expect(rootId).toMatch(/^task:[a-f0-9]{64}$/);

        const invalidPaths = [
            'escape/secret.md',
            '../secret.md',
            '..\\secret.md',
            'C:\\outside\\secret.md',
            '\\\\server\\share\\secret.md',
        ];
        for (const invalidPath of invalidPaths) {
            const response = await postJSON(commentsUrl(srv, 'thread'), {
                path: invalidPath,
                root: rootId,
                thread: {
                    anchor: { quotedText: 'Secret', prefix: '', suffix: '' },
                    comments: [{ content: 'Must not escape' }],
                },
            });
            expect(response.status, invalidPath).toBe(403);
        }

        const encodedTraversal = await request(
            commentsUrl(srv, '', `path=${encodeURIComponent('../secret.md')}&root=${encodeURIComponent(rootId)}`),
        );
        expect(encodedTraversal.status).toBe(403);
        expect(fs.existsSync(path.join(outsideRoot, 'secret.md.comments.json'))).toBe(false);

        const sidecarLink = path.join(
            dataDir,
            'repos',
            wsId,
            'notes-comments',
            encodeRootPath(rootId),
        );
        fs.mkdirSync(path.dirname(sidecarLink), { recursive: true });
        fs.symlinkSync(
            outsideRoot,
            sidecarLink,
            process.platform === 'win32' ? 'junction' : 'dir',
        );
        const sidecarEscape = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'page.md',
            root: rootId,
            thread: {
                anchor: { quotedText: 'Task plan', prefix: '', suffix: '' },
                comments: [{ content: 'Must stay in managed storage' }],
            },
        });
        expect(sidecarEscape.status).toBe(403);
        expect(fs.existsSync(path.join(outsideRoot, 'page.md.comments.json'))).toBe(false);
    });

    // ========================================================================
    // 6. PUT bulk update on repo-folder root
    // ========================================================================
    it('PUT bulk update works for repo-folder root', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);
        configureRoot();

        const threadData = {
            't1': {
                id: 't1',
                status: 'open',
                createdAt: new Date().toISOString(),
                anchor: { quotedText: 'test', prefix: '', suffix: '' },
                comments: [{ id: 'c1', content: 'Bulk comment', createdAt: new Date().toISOString() }],
            },
        };

        const res = await putJSON(commentsUrl(srv), {
            path: 'page.md',
            root: REPO_ROOT,
            threads: threadData,
        });
        expect(res.status).toBe(200);
        const data = JSON.parse(res.body);
        expect(data.threads.t1.comments[0].content).toBe('Bulk comment');

        // Verify stored in managed area, not repo
        const colocatedPath = path.join(workspaceDir, REPO_ROOT, 'page.md.comments.json');
        expect(fs.existsSync(colocatedPath)).toBe(false);
    });

    // ========================================================================
    // 7. Default root backward compatibility (no root param)
    // ========================================================================
    it('default root sidecar is co-located when root param is omitted', async () => {
        const srv = await startServer();
        await registerWorkspace(srv);

        // Create note in default root so sidecar directory exists
        const defaultNotesRoot = getRepoDataPath(dataDir, wsId, 'notes');
        fs.mkdirSync(defaultNotesRoot, { recursive: true });
        fs.writeFileSync(path.join(defaultNotesRoot, 'test.md'), '# Test');

        const res = await postJSON(commentsUrl(srv, 'thread'), {
            path: 'test.md',
            thread: {
                anchor: { quotedText: 'Test', prefix: '', suffix: '' },
                comments: [{ content: 'Default comment' }],
            },
        });
        expect(res.status).toBe(201);

        // Verify sidecar IS co-located in default root
        const colocatedPath = path.join(defaultNotesRoot, 'test.md.comments.json');
        expect(fs.existsSync(colocatedPath)).toBe(true);
    });
});
