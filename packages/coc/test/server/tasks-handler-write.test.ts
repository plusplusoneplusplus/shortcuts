/**
 * Tasks Handler Write Tests
 *
 * Comprehensive tests for the Task write REST API endpoints:
 * create, rename, status update, delete, archive/unarchive.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

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

function jsonRequest(url: string, method: string, data: unknown) {
    const body = JSON.stringify(data);
    return request(url, {
        method,
        body,
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(body)),
        },
    });
}

// ============================================================================
// Tests
// ============================================================================

describe('Tasks Handler Write', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-write-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-write-ws-'));
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

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await jsonRequest(`${srv.url}/api/workspaces`, 'POST', {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    function createTaskFiles(files: Record<string, string>, folder = '.vscode/tasks'): void {
        const tasksDir = path.join(workspaceDir, folder);
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(tasksDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    function tasksDir(): string {
        return path.join(workspaceDir, '.vscode', 'tasks');
    }

    // ========================================================================
    // POST /api/workspaces/:id/tasks — Create task
    // ========================================================================

    describe('POST /api/workspaces/:id/tasks — Create', () => {
        it('should create a task file with frontmatter and return 201', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            // Ensure tasks dir exists
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {
                name: 'my-task',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.name).toBe('my-task');
            expect(body.type).toBe('file');
            expect(body.path).toBe('my-task.md');

            // Verify file exists with correct frontmatter
            const content = fs.readFileSync(path.join(tasksDir(), 'my-task.md'), 'utf-8');
            expect(content).toContain('status: pending');
            expect(content).toContain('# my-task');
        });

        it('should create a task file with docType', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {
                name: 'feature1',
                docType: 'plan',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('feature1.plan.md');
            expect(fs.existsSync(path.join(tasksDir(), 'feature1.plan.md'))).toBe(true);
        });

        it('should create a task in a subfolder', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {
                name: 'subtask',
                folder: 'feature1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/feature1/);
            expect(fs.existsSync(path.join(tasksDir(), 'feature1', 'subtask.md'))).toBe(true);
        });

        it('should create a folder and return 201', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {
                name: 'new-folder',
                type: 'folder',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.type).toBe('folder');
            expect(body.name).toBe('new-folder');

            const stat = fs.statSync(path.join(tasksDir(), 'new-folder'));
            expect(stat.isDirectory()).toBe(true);
        });

        it('should create nested folder with parent', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(path.join(tasksDir(), 'parent'), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {
                name: 'child',
                type: 'folder',
                parent: 'parent',
            });
            expect(res.status).toBe(201);
            expect(fs.statSync(path.join(tasksDir(), 'parent', 'child')).isDirectory()).toBe(true);
        });

        it('should return 400 when name is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {});
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('name');
        });

        it('should return 404 for non-existent workspace', async () => {
            const srv = await startServer();

            const res = await jsonRequest(`${srv.url}/api/workspaces/nonexistent/tasks`, 'POST', {
                name: 'test',
            });
            expect(res.status).toBe(404);
        });

        it('should return 409 when file already exists', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'existing.md': '# Existing' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'POST', {
                name: 'existing',
            });
            expect(res.status).toBe(409);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/tasks — Rename
    // ========================================================================

    describe('PATCH /api/workspaces/:id/tasks — Rename', () => {
        it('should rename a task file and return 200', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'old-name.md': '# Old' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'old-name.md',
                newName: 'new-name',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.name).toBe('new-name');
            expect(body.path).toBe('new-name.md');

            // Old file gone, new file exists
            expect(fs.existsSync(path.join(tasksDir(), 'old-name.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir(), 'new-name.md'))).toBe(true);
        });

        it('should rename a document group (all related files)', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({
                'task1.plan.md': '# Plan',
                'task1.spec.md': '# Spec',
                'task1.test.md': '# Test',
            });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'task1.plan.md',
                newName: 'feature-x',
            });
            expect(res.status).toBe(200);

            // All old files should be renamed
            expect(fs.existsSync(path.join(tasksDir(), 'task1.plan.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir(), 'task1.spec.md'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir(), 'task1.test.md'))).toBe(false);

            expect(fs.existsSync(path.join(tasksDir(), 'feature-x.plan.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir(), 'feature-x.spec.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir(), 'feature-x.test.md'))).toBe(true);
        });

        it('should rename a directory', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'old-dir/task.md': '# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'old-dir',
                newName: 'new-dir',
            });
            expect(res.status).toBe(200);
            expect(fs.existsSync(path.join(tasksDir(), 'old-dir'))).toBe(false);
            expect(fs.existsSync(path.join(tasksDir(), 'new-dir', 'task.md'))).toBe(true);
        });

        it('should return 409 on name collision', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({
                'task-a.md': '# A',
                'task-b.md': '# B',
            });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'task-a.md',
                newName: 'task-b',
            });
            expect(res.status).toBe(409);
        });

        it('should return 404 for non-existent file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'nonexistent.md',
                newName: 'new-name',
            });
            expect(res.status).toBe(404);
        });

        it('should return 404 for non-existent workspace', async () => {
            const srv = await startServer();

            const res = await jsonRequest(`${srv.url}/api/workspaces/nonexistent/tasks`, 'PATCH', {
                path: 'test.md',
                newName: 'new-name',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/tasks — Status update
    // ========================================================================

    describe('PATCH /api/workspaces/:id/tasks — Status update', () => {
        it('should update task status in frontmatter', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'task.md': '---\nstatus: pending\n---\n\n# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'task.md',
                status: 'in-progress',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.status).toBe('in-progress');

            const content = fs.readFileSync(path.join(tasksDir(), 'task.md'), 'utf-8');
            expect(content).toContain('status: in-progress');
            expect(content).not.toContain('status: pending');
        });

        it('should add frontmatter when file has none', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'no-fm.md': '# No Frontmatter\n\nContent here.' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'no-fm.md',
                status: 'done',
            });
            expect(res.status).toBe(200);

            const content = fs.readFileSync(path.join(tasksDir(), 'no-fm.md'), 'utf-8');
            expect(content).toMatch(/^---\nstatus: done\n---\n/);
        });

        it('should add status to existing frontmatter without status field', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'partial-fm.md': '---\ntitle: My Task\n---\n\n# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'partial-fm.md',
                status: 'future',
            });
            expect(res.status).toBe(200);

            const content = fs.readFileSync(path.join(tasksDir(), 'partial-fm.md'), 'utf-8');
            expect(content).toContain('status: future');
            expect(content).toContain('title: My Task');
        });

        it('should return 400 for invalid status value', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'task.md': '---\nstatus: pending\n---\n\n# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'task.md',
                status: 'invalid-status',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid status');
        });

        it('should return 400 when neither status nor newName provided', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'task.md': '# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'PATCH', {
                path: 'task.md',
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('status');
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/tasks — Delete
    // ========================================================================

    describe('DELETE /api/workspaces/:id/tasks — Delete', () => {
        it('should delete a task file and return 204', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'to-delete.md': '# Delete me' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'DELETE', {
                path: 'to-delete.md',
            });
            expect(res.status).toBe(204);
            expect(fs.existsSync(path.join(tasksDir(), 'to-delete.md'))).toBe(false);
        });

        it('should delete a folder recursively and return 204', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({
                'folder/task1.md': '# Task 1',
                'folder/task2.md': '# Task 2',
                'folder/sub/task3.md': '# Task 3',
            });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'DELETE', {
                path: 'folder',
            });
            expect(res.status).toBe(204);
            expect(fs.existsSync(path.join(tasksDir(), 'folder'))).toBe(false);
        });

        it('should return 403 for path traversal attempt', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'DELETE', {
                path: '../../etc/passwd',
            });
            expect(res.status).toBe(403);
        });

        it('should return 404 for non-existent file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'DELETE', {
                path: 'nonexistent.md',
            });
            expect(res.status).toBe(404);
        });

        it('should return 404 for non-existent workspace', async () => {
            const srv = await startServer();

            const res = await jsonRequest(`${srv.url}/api/workspaces/nonexistent/tasks`, 'DELETE', {
                path: 'test.md',
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 when path is missing', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks`, 'DELETE', {});
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/tasks/archive — Archive/Unarchive
    // ========================================================================

    describe('POST /api/workspaces/:id/tasks/archive — Archive', () => {
        it('should archive a file to archive/ subfolder', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'my-task.md': '# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: 'my-task.md',
                action: 'archive',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.path).toMatch(/archive/);

            // Original should be gone
            expect(fs.existsSync(path.join(tasksDir(), 'my-task.md'))).toBe(false);
            // Should exist in archive
            expect(fs.existsSync(path.join(tasksDir(), 'archive', 'my-task.md'))).toBe(true);
        });

        it('should preserve structure when archiving nested items', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'feature1/backlog/task.md': '# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: 'feature1/backlog/task.md',
                action: 'archive',
            });
            expect(res.status).toBe(200);

            // Should preserve relative structure inside archive
            expect(fs.existsSync(path.join(tasksDir(), 'archive', 'feature1', 'backlog', 'task.md'))).toBe(true);
        });

        it('should handle archive name collision with timestamp suffix', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({
                'task.md': '# Task',
                'archive/task.md': '# Already archived',
            });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: 'task.md',
                action: 'archive',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Should have timestamp suffix
            expect(body.path).toMatch(/archive\/task-\d+\.md/);
        });

        it('should unarchive a file back to tasks root', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'archive/my-task.md': '# Archived Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: 'archive/my-task.md',
                action: 'unarchive',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.path).toBe('my-task.md');

            expect(fs.existsSync(path.join(tasksDir(), 'my-task.md'))).toBe(true);
            expect(fs.existsSync(path.join(tasksDir(), 'archive', 'my-task.md'))).toBe(false);
        });

        it('should return 404 for non-existent file', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            fs.mkdirSync(tasksDir(), { recursive: true });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: 'nonexistent.md',
                action: 'archive',
            });
            expect(res.status).toBe(404);
        });

        it('should return 400 for invalid action', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createTaskFiles({ 'task.md': '# Task' });

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: 'task.md',
                action: 'invalid',
            });
            expect(res.status).toBe(400);
        });

        it('should return 404 for non-existent workspace', async () => {
            const srv = await startServer();

            const res = await jsonRequest(`${srv.url}/api/workspaces/nonexistent/tasks/archive`, 'POST', {
                path: 'task.md',
                action: 'archive',
            });
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal attempt', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await jsonRequest(`${srv.url}/api/workspaces/${wsId}/tasks/archive`, 'POST', {
                path: '../../etc/passwd',
                action: 'archive',
            });
            expect(res.status).toBe(403);
        });
    });
});
