/**
 * Tasks Handler Tests
 *
 * Comprehensive tests for the Task read-only REST API endpoints:
 * hierarchy, content, and settings.
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
import { resolveTaskRoot } from '../../src/server/tasks/task-root-resolver';

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

// ============================================================================
// Tests
// ============================================================================

describe('Tasks Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-workspace-'));
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

    /** Create task files in the resolver-determined tasks directory, or in a custom workspace-relative folder. */
    function createTaskFiles(files: Record<string, string>, workspaceRelativeFolder?: string): void {
        const tasksDir = workspaceRelativeFolder
            ? path.join(workspaceDir, workspaceRelativeFolder)
            : resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(tasksDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    // ========================================================================
    // GET /api/workspaces/:id/tasks/content — File content
    // ========================================================================

    describe('GET /api/workspaces/:id/tasks/content — Content', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/nonexistent/tasks/content?path=test.md`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('should return 400 when path query param is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('path');
        });

        it('should return file content for a valid path', async () => {
            const srv = await startServer();
            const markdown = '# My Task\n\nThis is the content.';
            createTaskFiles({ 'my-task.md': markdown });

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=my-task.md`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(markdown);
            expect(body.path).toBe('my-task.md');
            expect(typeof body.mtime).toBe('number');
            expect(body.mtime).toBeGreaterThan(0);
        });

        it('should return content for nested file paths', async () => {
            const srv = await startServer();
            const markdown = '# Nested Task\n\nNested content.';
            createTaskFiles({ 'feature1/task1.plan.md': markdown });

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=feature1/task1.plan.md`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(markdown);
            expect(body.path).toBe('feature1/task1.plan.md');
        });

        it('should return 404 for nonexistent file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=nonexistent.md`);
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal attempts', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            // Use enough ../ levels to escape the data directory entirely
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=../../../../../../etc/passwd`);
            expect(res.status).toBe(403);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('outside');
        });

        it('should return 403 for path traversal with encoded dots', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            // Use enough ../ levels to escape the data directory entirely
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=..%2F..%2F..%2F..%2F..%2F..%2Fetc%2Fpasswd`);
            expect(res.status).toBe(403);
        });

        it('should return 404 (not 403) for traversal within the data directory', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            // ../../etc/passwd resolves inside dataDir, so access is allowed but file doesn't exist
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=..%2F..%2Fetc%2Fpasswd`);
            expect(res.status).toBe(404);
        });

        it('should return content for files in the absolute task root', async () => {
            const srv = await startServer();
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId });
            fs.mkdirSync(taskRoot.absolutePath, { recursive: true });
            const markdown = '# Task Root File\n\nContent from task root.';
            fs.writeFileSync(path.join(taskRoot.absolutePath, 'root-task.md'), markdown, 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=root-task.md`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(markdown);
        });

        it('should accept file paths under the data directory (~/.coc)', async () => {
            const srv = await startServer();
            // Create a file in the dataDir but outside the normal task root for this workspace
            const otherRepoDir = path.join(dataDir, 'repos', 'other-repo-hash', 'tasks', 'coc');
            fs.mkdirSync(otherRepoDir, { recursive: true });
            const markdown = '# Plan from another repo path';
            fs.writeFileSync(path.join(otherRepoDir, 'plan.md'), markdown, 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const filePath = encodeURIComponent(path.join(otherRepoDir, 'plan.md'));
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=${filePath}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(markdown);
        });

        it('should return 400 for files exceeding 4MB', async () => {
            const srv = await startServer();
            const largeContent = 'x'.repeat(4 * 1024 * 1024 + 1);
            createTaskFiles({ 'huge.md': largeContent });

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=huge.md`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('too large');
        });

        it('should return 200 for files just under 4MB', async () => {
            const srv = await startServer();
            const content = 'x'.repeat(4 * 1024 * 1024 - 1);
            createTaskFiles({ 'big.md': content });

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=big.md`);
            expect(res.status).toBe(200);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/tasks/settings — Default settings
    // ========================================================================

    describe('GET /api/workspaces/:id/tasks/settings — Settings', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/nonexistent/tasks/settings`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('should return valid default settings', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.enabled).toBe(true);
            expect(path.isAbsolute(body.folderPath)).toBe(true);
            expect(body.showArchived).toBe(false);
            expect(body.showFuture).toBe(false);
            expect(body.sortBy).toBe('name');
            expect(body.groupRelatedDocuments).toBe(true);
            expect(body.discovery).toBeDefined();
            expect(body.discovery.enabled).toBe(false);
            expect(body.discovery.defaultScope).toBeDefined();
            expect(body.discovery.defaultScope.includeSourceFiles).toBe(true);
            expect(body.discovery.defaultScope.includeDocs).toBe(true);
            expect(body.discovery.defaultScope.includeConfigFiles).toBe(false);
            expect(body.discovery.defaultScope.includeGitHistory).toBe(false);
            expect(body.discovery.defaultScope.maxCommits).toBe(50);
            expect(body.discovery.showRelatedInTree).toBe(true);
            expect(body.discovery.groupByCategory).toBe(true);
        });

        it('should return taskRootPath as an absolute path', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.taskRootPath).toBeDefined();
            expect(typeof body.taskRootPath).toBe('string');
            expect(path.isAbsolute(body.taskRootPath)).toBe(true);
            expect(body.taskRootPath).toContain('repos');
            expect(body.taskRootPath).toMatch(/tasks$/);
        });

        it('should return taskRootPath matching folderPath', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.taskRootPath).toBe(body.folderPath);
        });

        it('should return different taskRootPath for different workspaces', async () => {
            const srv = await startServer();
            const workspace2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-workspace2-'));
            try {
                const wsId1 = await registerWorkspace(srv, workspaceDir);
                const wsId2 = 'test-ws-2-' + Date.now();
                const regRes = await postJSON(`${srv.url}/api/workspaces`, {
                    id: wsId2,
                    name: 'Test Workspace 2',
                    rootPath: workspace2,
                });
                expect(regRes.status).toBe(201);

                const res1 = await request(`${srv.url}/api/workspaces/${wsId1}/tasks/settings`);
                const res2 = await request(`${srv.url}/api/workspaces/${wsId2}/tasks/settings`);
                const body1 = JSON.parse(res1.body);
                const body2 = JSON.parse(res2.body);

                expect(body1.taskRootPath).not.toBe(body2.taskRootPath);
            } finally {
                fs.rmSync(workspace2, { recursive: true, force: true });
            }
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/files/preview — File preview
    // ========================================================================

    describe('GET /api/workspaces/:id/files/preview — Preview', () => {
        it('should accept file paths under the task root directory', async () => {
            const srv = await startServer();
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId });
            fs.mkdirSync(taskRoot.absolutePath, { recursive: true });
            fs.writeFileSync(path.join(taskRoot.absolutePath, 'test-preview.md'), '# Preview Test', 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const filePath = encodeURIComponent(path.join(taskRoot.absolutePath, 'test-preview.md'));
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/preview?path=${filePath}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('file');
            expect(body.lines).toContain('# Preview Test');
        });

        it('should reject paths outside workspace and task root', async () => {
            const srv = await startServer();
            // Use home dir (not ~/.copilot, not os.tmpdir) — genuinely outside all trusted roots.
            const evilDir = fs.mkdtempSync(path.join(os.homedir(), '_test_tasks_evil_'));
            fs.writeFileSync(path.join(evilDir, 'secret.txt'), 'secret', 'utf-8');
            try {
                const wsId = await registerWorkspace(srv, workspaceDir);
                const filePath = encodeURIComponent(path.join(evilDir, 'secret.txt'));
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/preview?path=${filePath}`);
                expect(res.status).toBe(403);
            } finally {
                fs.rmSync(evilDir, { recursive: true, force: true });
            }
        });

        it('should accept file paths under the data directory (~/.coc)', async () => {
            const srv = await startServer();
            // Create a file in the dataDir but outside the normal task root for this workspace
            const otherRepoDir = path.join(dataDir, 'repos', 'other-repo-hash', 'tasks', 'coc');
            fs.mkdirSync(otherRepoDir, { recursive: true });
            fs.writeFileSync(path.join(otherRepoDir, 'plan.md'), '# Plan from another repo path', 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const filePath = encodeURIComponent(path.join(otherRepoDir, 'plan.md'));
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/preview?path=${filePath}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.lines).toContain('# Plan from another repo path');
        });

        it('should always return mtime for file responses', async () => {
            const srv = await startServer();
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId });
            fs.mkdirSync(taskRoot.absolutePath, { recursive: true });
            const target = path.join(taskRoot.absolutePath, 'with-mtime.md');
            fs.writeFileSync(target, '# Hi', 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const filePath = encodeURIComponent(target);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/preview?path=${filePath}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(typeof body.mtime).toBe('number');
            expect(body.mtime).toBeGreaterThan(0);
        });

        it('should include the full content field when lines=0 is requested', async () => {
            const srv = await startServer();
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId });
            fs.mkdirSync(taskRoot.absolutePath, { recursive: true });
            const target = path.join(taskRoot.absolutePath, 'all-lines.md');
            const original = '# Title\n\nbody line 1\nbody line 2\n';
            fs.writeFileSync(target, original, 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const filePath = encodeURIComponent(target);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/preview?path=${filePath}&lines=0`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(original);
            expect(typeof body.mtime).toBe('number');
        });

        it('should omit the content field when lines>0 (preview only)', async () => {
            const srv = await startServer();
            const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId });
            fs.mkdirSync(taskRoot.absolutePath, { recursive: true });
            const target = path.join(taskRoot.absolutePath, 'preview-only.md');
            fs.writeFileSync(target, '# Hi\n\nbody\n', 'utf-8');

            await registerWorkspace(srv, workspaceDir);
            const filePath = encodeURIComponent(target);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/preview?path=${filePath}&lines=20`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBeUndefined();
            expect(Array.isArray(body.lines)).toBe(true);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/tasks/content — Write content
    // ========================================================================

    /** PATCH JSON helper. */
    function patchJSON(url: string, data: unknown) {
        return request(url, {
            method: 'PATCH',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
        });
    }

    describe('PATCH /api/workspaces/:id/tasks/content — Write content', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await patchJSON(`${srv.url}/api/workspaces/nonexistent/tasks/content`, {
                path: 'test.md', content: 'new'
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 when path field is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                content: 'new'
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('path');
        });

        it('should return 400 when content field is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'test.md'
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('content');
        });

        it('should return 404 for nonexistent file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'placeholder.md': '# Placeholder' });
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'nonexistent.md', content: 'new'
            });
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal attempts', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'test.md': '# Test' });
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: '../../../etc/passwd', content: 'hacked'
            });
            expect(res.status).toBe(403);
        });

        it('should write content to an existing file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'test.md': '# Original\n\nOld content' });

            const newContent = '# Updated\n\nNew content from AI';
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'test.md', content: newContent
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.path).toBe('test.md');
            expect(data.updated).toBe(true);
            expect(typeof data.mtime).toBe('number');
            expect(data.mtime).toBeGreaterThan(0);

            // Verify file on disk
            const filePath = path.join(resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath, 'test.md');
            const actual = fs.readFileSync(filePath, 'utf-8');
            expect(actual).toBe(newContent);
        });

        it('should return 409 conflict when expectedMtime does not match', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'test.md': '# Original' });

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'test.md', content: '# Updated', expectedMtime: 1 // stale
            });
            expect(res.status).toBe(409);
            const data = JSON.parse(res.body);
            expect(data.error).toBe('conflict');
            expect(data.reason).toBe('mtime_mismatch');
            expect(typeof data.currentMtime).toBe('number');
            expect(typeof data.currentContent).toBe('string');
        });

        it('should succeed when expectedMtime matches the current mtime', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'test.md': '# Original' });

            // First get the current mtime
            const getRes = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=test.md`);
            expect(getRes.status).toBe(200);
            const { mtime } = JSON.parse(getRes.body);

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'test.md', content: '# Updated', expectedMtime: mtime
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.updated).toBe(true);
            expect(typeof data.mtime).toBe('number');
        });

        it('should write content to a nested file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'feature/sub/task.plan.md': '# Old' });

            const newContent = '# Updated plan';
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'feature/sub/task.plan.md', content: newContent
            });
            expect(res.status).toBe(200);

            const filePath = path.join(resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath, 'feature/sub', 'task.plan.md');
            expect(fs.readFileSync(filePath, 'utf-8')).toBe(newContent);
        });

        it('should allow writing empty content', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'test.md': '# Has content' });

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: 'test.md', content: ''
            });
            expect(res.status).toBe(200);

            const filePath = path.join(resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath, 'test.md');
            expect(fs.readFileSync(filePath, 'utf-8')).toBe('');
        });

        it('should allow writing a workspace .md file outside the tasks folder', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const docsDir = path.join(workspaceDir, 'docs');
            fs.mkdirSync(docsDir, { recursive: true });
            const target = path.join(docsDir, 'readme.md');
            fs.writeFileSync(target, '# Old', 'utf-8');

            // Mirror the dialog's auto-branch: chat-linked file paths are absolute.
            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: target, content: '# Updated from dialog'
            });
            expect(res.status).toBe(200);
            expect(fs.readFileSync(target, 'utf-8')).toBe('# Updated from dialog');
        });

        it('should reject writing a workspace non-.md file (fallback only allows .md)', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const target = path.join(workspaceDir, 'config.json');
            fs.writeFileSync(target, '{}', 'utf-8');

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                path: target, content: '{"hacked":true}'
            });
            expect(res.status).toBe(403);
            expect(fs.readFileSync(target, 'utf-8')).toBe('{}');
        });

        it('should reject writing a path outside the workspace entirely', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evil-'));
            try {
                const target = path.join(evilDir, 'pwned.md');
                fs.writeFileSync(target, 'old', 'utf-8');

                const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
                    path: target, content: 'hacked'
                });
                expect(res.status).toBe(403);
                expect(fs.readFileSync(target, 'utf-8')).toBe('old');
            } finally {
                fs.rmSync(evilDir, { recursive: true, force: true });
            }
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/tasks — Status update (plain md files)
    // ========================================================================

    describe('PATCH /api/workspaces/:id/tasks — Status update for plain md files', () => {
        it('should update status for a task file (relative path)', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'sprint.plan.md': '---\nstatus: pending\n---\n# Sprint' });

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks`, {
                path: 'sprint.plan.md', status: 'in-progress'
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.status).toBe('in-progress');

            const taskRoot = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
            const content = fs.readFileSync(path.join(taskRoot, 'sprint.plan.md'), 'utf-8');
            expect(content).toContain('status: in-progress');
        });

        it('should update status for a plain md file using absolute workspace path', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const mdPath = path.join(workspaceDir, 'docs', 'notes.md');
            fs.mkdirSync(path.dirname(mdPath), { recursive: true });
            fs.writeFileSync(mdPath, '# Notes\n\nSome content', 'utf-8');

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks`, {
                path: mdPath, status: 'in-progress'
            });
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.status).toBe('in-progress');

            const content = fs.readFileSync(mdPath, 'utf-8');
            expect(content).toContain('status: in-progress');
        });

        it('should prepend frontmatter when plain md file has none', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const mdPath = path.join(workspaceDir, 'readme.md');
            fs.writeFileSync(mdPath, '# Hello World', 'utf-8');

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks`, {
                path: mdPath, status: 'done'
            });
            expect(res.status).toBe(200);

            const content = fs.readFileSync(mdPath, 'utf-8');
            expect(content).toBe('---\nstatus: done\n---\n# Hello World');
        });

        it('should update existing frontmatter status in plain md file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const mdPath = path.join(workspaceDir, 'task.md');
            fs.writeFileSync(mdPath, '---\ntitle: My Task\nstatus: pending\n---\n# Task', 'utf-8');

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks`, {
                path: mdPath, status: 'future'
            });
            expect(res.status).toBe(200);

            const content = fs.readFileSync(mdPath, 'utf-8');
            expect(content).toContain('status: future');
            expect(content).toContain('title: My Task');
        });

        it('should return 403 for absolute path outside workspace', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const outsidePath = path.join(os.tmpdir(), 'outside.md');
            fs.writeFileSync(outsidePath, '# Outside', 'utf-8');

            try {
                const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks`, {
                    path: outsidePath, status: 'done'
                });
                expect(res.status).toBe(403);
            } finally {
                fs.unlinkSync(outsidePath);
            }
        });

        it('should return 403 for non-md file with absolute path', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const txtPath = path.join(workspaceDir, 'notes.txt');
            fs.writeFileSync(txtPath, 'plain text', 'utf-8');

            const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks`, {
                path: txtPath, status: 'done'
            });
            expect(res.status).toBe(403);
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/files/image — Local image proxy
    // ========================================================================

    describe('GET /api/workspaces/:id/files/image', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const imgPath = path.join(os.tmpdir(), 'test-img.png');
            fs.writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            try {
                const res = await request(`${srv.url}/api/workspaces/nonexistent/files/image?path=${encodeURIComponent(imgPath)}`);
                expect(res.status).toBe(404);
            } finally {
                fs.unlinkSync(imgPath);
            }
        });

        it('should return 400 when path query param is missing', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image`);
            expect(res.status).toBe(400);
        });

        it('should return 415 for unsupported file extension', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const txtPath = path.join(os.tmpdir(), 'not-an-image.txt');
            fs.writeFileSync(txtPath, 'hello');
            try {
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(txtPath)}`);
                expect(res.status).toBe(415);
            } finally {
                fs.unlinkSync(txtPath);
            }
        });

        it('should return 404 when image file does not exist', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const missing = path.join(os.tmpdir(), 'nonexistent-image.png');
            const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(missing)}`);
            expect(res.status).toBe(404);
        });

        it('should serve a PNG image with correct content-type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const imgPath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`);
            const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            fs.writeFileSync(imgPath, pngBytes);
            try {
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(imgPath)}`);
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toBe('image/png');
                expect(res.headers['cache-control']).toContain('max-age=3600');
            } finally {
                fs.unlinkSync(imgPath);
            }
        });

        it('should serve a JPEG image with correct content-type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const imgPath = path.join(os.tmpdir(), `test-image-${Date.now()}.jpg`);
            fs.writeFileSync(imgPath, Buffer.from([0xff, 0xd8, 0xff]));
            try {
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(imgPath)}`);
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toBe('image/jpeg');
            } finally {
                fs.unlinkSync(imgPath);
            }
        });

        it('should serve a WebP image with correct content-type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const imgPath = path.join(os.tmpdir(), `test-image-${Date.now()}.webp`);
            fs.writeFileSync(imgPath, Buffer.from([0x52, 0x49, 0x46, 0x46]));
            try {
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(imgPath)}`);
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toBe('image/webp');
            } finally {
                fs.unlinkSync(imgPath);
            }
        });

        it('should serve an SVG with correct content-type', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const imgPath = path.join(os.tmpdir(), `test-image-${Date.now()}.svg`);
            fs.writeFileSync(imgPath, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
            try {
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(imgPath)}`);
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toBe('image/svg+xml');
            } finally {
                fs.unlinkSync(imgPath);
            }
        });

        it('should return image bytes matching the file on disk', async () => {
            const srv = await startServer();
            await registerWorkspace(srv, workspaceDir);
            const imgPath = path.join(os.tmpdir(), `test-image-bytes-${Date.now()}.png`);
            const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xde, 0xad, 0xbe, 0xef]);
            fs.writeFileSync(imgPath, data);
            try {
                const res = await request(`${srv.url}/api/workspaces/${wsId}/files/image?path=${encodeURIComponent(imgPath)}`);
                expect(res.status).toBe(200);
                // Body is returned as utf-8 string by the test helper, check length via content-length header
                expect(parseInt(res.headers['content-length'] as string, 10)).toBe(data.length);
            } finally {
                fs.unlinkSync(imgPath);
            }
        });
    });
});
