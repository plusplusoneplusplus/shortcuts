/**
 * Notes Git Handler Tests
 *
 * Tests for the notes git REST API endpoints. Uses a real HTTP server
 * with an OS-assigned port for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore, getRepoDataPath } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '../../src/server/types';
import { safeRm } from '../helpers/safe-rm';

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

// ============================================================================
// Tests
// ============================================================================

describe('Notes Git Handler', { timeout: 60_000 }, () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-git-handler-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-git-ws-'));
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

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    function gitUrl(srv: ExecutionServer, action: string, query: string = ''): string {
        const base = `${srv.url}/api/workspaces/${wsId}/notes/git/${action}`;
        return query ? `${base}?${query}` : base;
    }

    function notesRoot(): string {
        return getRepoDataPath(dataDir, wsId, 'notes');
    }

    function writeNote(relativePath: string, content: string): void {
        const filePath = path.join(notesRoot(), relativePath);
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf-8');
    }

    // ========================================================================
    // Route registration
    // ========================================================================
    describe('route registration', () => {
        it('all 6 routes respond with valid status codes', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // POST /init
            const initRes = await postJSON(gitUrl(srv, 'init'), {});
            expect(initRes.status).toBe(200);

            // GET /status
            const statusRes = await request(gitUrl(srv, 'status'));
            expect(statusRes.status).toBe(200);

            // GET /log
            const logRes = await request(gitUrl(srv, 'log'));
            expect(logRes.status).toBe(200);

            // GET /diff
            const diffRes = await request(gitUrl(srv, 'diff'));
            expect(diffRes.status).toBe(200);

            // GET /diff/:hash — use initial commit hash
            const logData = JSON.parse(logRes.body);
            if (logData.entries.length > 0) {
                const hash = logData.entries[0].hash;
                const diffHashRes = await request(gitUrl(srv, `diff/${hash}`));
                expect(diffHashRes.status).toBe(200);
            }

            // POST /commit
            const commitRes = await postJSON(gitUrl(srv, 'commit'), {});
            expect(commitRes.status).toBe(200);
        });
    });

    // ========================================================================
    // POST /init
    // ========================================================================
    describe('POST /init', () => {
        it('initializes notes git and returns 200', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(gitUrl(srv, 'init'), {});
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.initialized).toBe(true);

            // Verify .git exists
            expect(fs.existsSync(path.join(notesRoot(), '.git'))).toBe(true);
        });

        it('is idempotent on repeated calls', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            await postJSON(gitUrl(srv, 'init'), {});
            const res2 = await postJSON(gitUrl(srv, 'init'), {});
            expect(res2.status).toBe(200);
            expect(JSON.parse(res2.body).initialized).toBe(true);
        });
    });

    // ========================================================================
    // GET /status
    // ========================================================================
    describe('GET /status', () => {
        it('returns NotesGitStatus shape when initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'status'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data).toHaveProperty('initialized', true);
            expect(data).toHaveProperty('branch');
            expect(data).toHaveProperty('clean', true);
            expect(data).toHaveProperty('staged');
            expect(data).toHaveProperty('unstaged');
            expect(data).toHaveProperty('untracked');
            expect(data).toHaveProperty('totalChanges', 0);
        });

        it('works when not initialized (dir does not exist)', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(gitUrl(srv, 'status'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.initialized).toBe(false);
            expect(data.clean).toBe(true);
        });

        it('detects new file as untracked', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('new.md', '# New');

            const res = await request(gitUrl(srv, 'status'));
            const data = JSON.parse(res.body);
            expect(data.clean).toBe(false);
            expect(data.untracked).toContain('new.md');
            expect(data.totalChanges).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // GET /log
    // ========================================================================
    describe('GET /log', () => {
        it('returns log with default pagination', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'log'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.limit).toBe(20);
            expect(data.offset).toBe(0);
            expect(Array.isArray(data.entries)).toBe(true);
            expect(data.entries.length).toBeGreaterThanOrEqual(1);
        });

        it('respects custom limit and offset via query params', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            // Create extra commits
            writeNote('a.md', 'a');
            await postJSON(gitUrl(srv, 'commit'), { message: 'commit a' });
            writeNote('b.md', 'b');
            await postJSON(gitUrl(srv, 'commit'), { message: 'commit b' });

            const res = await request(gitUrl(srv, 'log', 'limit=1&offset=1'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.limit).toBe(1);
            expect(data.offset).toBe(1);
            expect(data.entries).toHaveLength(1);
        });

        it('clamps limit to 100', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'log', 'limit=500'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.limit).toBe(100);
        });

        it('returns empty entries when not initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(gitUrl(srv, 'log'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.entries).toEqual([]);
        });
    });

    // ========================================================================
    // GET /diff
    // ========================================================================
    describe('GET /diff', () => {
        it('returns uncommitted diff', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'diff'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data).toHaveProperty('files');
            expect(Array.isArray(data.files)).toBe(true);
        });
    });

    // ========================================================================
    // GET /diff/:hash
    // ========================================================================
    describe('GET /diff/:hash', () => {
        it('returns diff for a specific commit', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('test.md', '# Test');
            const commitRes = await postJSON(gitUrl(srv, 'commit'), { message: 'add test' });
            const commitData = JSON.parse(commitRes.body);

            const res = await request(gitUrl(srv, `diff/${commitData.hash}`));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.files.length).toBeGreaterThan(0);
        });

        it('rejects invalid hash (non-hex)', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Non-hex chars won't match the route pattern [a-f0-9]+
            const res = await request(gitUrl(srv, 'diff/xyz-not-hex'));
            // Should get 404 from router (no matching route)
            expect([400, 404]).toContain(res.status);
        });

        it('rejects too-short hash', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'diff/abc'));
            expect(res.status).toBe(400);
        });

        it('returns 404 for unknown hash', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'diff/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'));
            // Could be 404 or 500 depending on git error message
            expect([404, 500]).toContain(res.status);
        });
    });

    // ========================================================================
    // POST /commit
    // ========================================================================
    describe('POST /commit', () => {
        it('commits with auto-generated message', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('note.md', '# Note');

            const res = await postJSON(gitUrl(srv, 'commit'), {});
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.committed).toBe(true);
            expect(data.hash).toBeTruthy();
            expect(data.message).toMatch(/^Notes snapshot /);
        });

        it('commits with custom message', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('note.md', '# Note');

            const res = await postJSON(gitUrl(srv, 'commit'), { message: 'Custom commit' });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.committed).toBe(true);
            expect(data.message).toBe('Custom commit');
        });

        it('returns committed: false when nothing to commit', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await postJSON(gitUrl(srv, 'commit'), {});
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.committed).toBe(false);
        });

        it('rejects message over 500 chars', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await postJSON(gitUrl(srv, 'commit'), { message: 'x'.repeat(501) });
            expect(res.status).toBe(400);
        });

        it('rejects empty string message', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await postJSON(gitUrl(srv, 'commit'), { message: '' });
            expect(res.status).toBe(400);
        });

        it('rejects whitespace-only message', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await postJSON(gitUrl(srv, 'commit'), { message: '   ' });
            expect(res.status).toBe(400);
        });

        it('returns 409 when not initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            // Ensure notes dir exists but has no git
            fs.mkdirSync(notesRoot(), { recursive: true });

            const res = await postJSON(gitUrl(srv, 'commit'), {});
            expect(res.status).toBe(409);
        });
    });

    // ========================================================================
    // GET /file-log
    // ========================================================================
    describe('GET /file-log', () => {
        it('returns empty entries for untracked file', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'file-log', 'path=note.md'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.entries).toEqual([]);
            expect(data.path).toBe('note.md');
        });

        it('returns only commits that touched the file', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('a.md', 'content a');
            await postJSON(gitUrl(srv, 'commit'), { message: 'add a' });
            writeNote('b.md', 'content b');
            await postJSON(gitUrl(srv, 'commit'), { message: 'add b' });

            const res = await request(gitUrl(srv, 'file-log', 'path=a.md'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.entries).toHaveLength(1);
            expect(data.entries[0].message).toBe('add a');
        });

        it('sets isNamedCheckpoint for [v] prefixed commits', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('note.md', 'v1');
            await postJSON(gitUrl(srv, 'commit'), { message: '[v] My checkpoint' });
            writeNote('note.md', 'v2');
            await postJSON(gitUrl(srv, 'commit'), { message: 'auto save' });

            const res = await request(gitUrl(srv, 'file-log', 'path=note.md'));
            const data = JSON.parse(res.body);
            const checkpoint = data.entries.find((e: any) => e.message === '[v] My checkpoint');
            const auto = data.entries.find((e: any) => e.message === 'auto save');
            expect(checkpoint.isNamedCheckpoint).toBe(true);
            expect(auto.isNamedCheckpoint).toBe(false);
        });

        it('returns 400 when path param is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(gitUrl(srv, 'file-log'));
            expect(res.status).toBe(400);
        });

        it('returns 403 for path traversal attempt', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'file-log', `path=${encodeURIComponent('../../etc/passwd')}`));
            expect(res.status).toBe(403);
        });

        it('clamps limit to 200', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'file-log', 'path=note.md&limit=9999'));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.limit).toBe(200);
        });
    });

    // ========================================================================
    // GET /file-content
    // ========================================================================
    describe('GET /file-content', () => {
        it('returns file content at a specific revision', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('note.md', 'version 1\n');
            const commitRes = await postJSON(gitUrl(srv, 'commit'), { message: 'v1' });
            const { hash } = JSON.parse(commitRes.body);

            writeNote('note.md', 'version 2\n');
            await postJSON(gitUrl(srv, 'commit'), { message: 'v2' });

            const res = await request(gitUrl(srv, 'file-content', `hash=${hash}&path=note.md`));
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.content.trim()).toBe('version 1');
            expect(data.hash).toBe(hash);
        });

        it('returns 400 when hash is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(gitUrl(srv, 'file-content', 'path=note.md'));
            expect(res.status).toBe(400);
        });

        it('returns 400 when path is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await request(gitUrl(srv, 'file-content', 'hash=deadbeefdeadbeef'));
            expect(res.status).toBe(400);
        });

        it('returns 403 for path traversal attempt', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await request(gitUrl(srv, 'file-content',
                `hash=deadbeefdeadbeef&path=${encodeURIComponent('../../etc/passwd')}`));
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // POST /save-checkpoint
    // ========================================================================
    describe('POST /save-checkpoint', () => {
        it('creates a [v] prefixed checkpoint commit', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('note.md', 'checkpoint content');
            const res = await postJSON(gitUrl(srv, 'save-checkpoint'), {
                path: 'note.md',
                name: 'My first checkpoint',
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.message).toBe('[v] My first checkpoint');
            expect(data.hash).toMatch(/^[a-f0-9]{40}$/);

            // Verify it shows up in file-log with isNamedCheckpoint: true
            const logRes = await request(gitUrl(srv, 'file-log', 'path=note.md'));
            const logData = JSON.parse(logRes.body);
            const cp = logData.entries.find((e: any) => e.isNamedCheckpoint);
            expect(cp).toBeDefined();
        });

        it('returns 400 when path is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(gitUrl(srv, 'save-checkpoint'), { name: 'test' });
            expect(res.status).toBe(400);
        });

        it('returns 400 when name is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(gitUrl(srv, 'save-checkpoint'), { path: 'note.md' });
            expect(res.status).toBe(400);
        });

        it('returns 400 when there are no changes to checkpoint', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            // File already committed — no staged changes
            writeNote('note.md', 'content');
            await postJSON(gitUrl(srv, 'commit'), { message: 'committed' });

            const res = await postJSON(gitUrl(srv, 'save-checkpoint'), {
                path: 'note.md',
                name: 'should fail',
            });
            expect(res.status).toBe(400);
        });

        it('returns 409 when not initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(notesRoot(), { recursive: true });

            const res = await postJSON(gitUrl(srv, 'save-checkpoint'), {
                path: 'note.md',
                name: 'test',
            });
            expect(res.status).toBe(409);
        });

        it('returns 403 for path traversal attempt', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await postJSON(gitUrl(srv, 'save-checkpoint'), {
                path: '../../etc/passwd',
                name: 'hack',
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // POST /restore-version
    // ========================================================================
    describe('POST /restore-version', () => {
        it('restores a file to a previous version', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            writeNote('note.md', 'original content\n');
            const commitRes = await postJSON(gitUrl(srv, 'commit'), { message: 'original' });
            const { hash: originalHash } = JSON.parse(commitRes.body);

            writeNote('note.md', 'updated content\n');
            await postJSON(gitUrl(srv, 'commit'), { message: 'updated' });

            // Restore to original
            const restoreRes = await postJSON(gitUrl(srv, 'restore-version'), {
                path: 'note.md',
                hash: originalHash,
            });
            expect(restoreRes.status).toBe(200);
            const restoreData = JSON.parse(restoreRes.body);
            expect(typeof restoreData.mtime).toBe('number');

            // Verify file was restored
            const restoredContent = fs.readFileSync(path.join(notesRoot(), 'note.md'), 'utf-8');
            expect(restoredContent.trim()).toBe('original content');
        });

        it('returns 400 when path is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(gitUrl(srv, 'restore-version'), {
                hash: 'deadbeefdeadbeef',
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when hash is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(gitUrl(srv, 'restore-version'), { path: 'note.md' });
            expect(res.status).toBe(400);
        });

        it('returns 409 when not initialized', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(notesRoot(), { recursive: true });

            const res = await postJSON(gitUrl(srv, 'restore-version'), {
                path: 'note.md',
                hash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
            });
            expect(res.status).toBe(409);
        });

        it('returns 403 for path traversal attempt', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            await postJSON(gitUrl(srv, 'init'), {});

            const res = await postJSON(gitUrl(srv, 'restore-version'), {
                path: '../../etc/passwd',
                hash: 'deadbeefdeadbeef',
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // Workspace resolution
    // ========================================================================
    describe('workspace resolution', () => {
        it('returns 404 for unknown workspace ID', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/workspaces/nonexistent/notes/git/status`);
            expect(res.status).toBe(404);
        });
    });
});
