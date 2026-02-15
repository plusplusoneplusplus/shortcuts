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
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';

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

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-workspace-'));
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
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    /** Create task files in the workspace's .vscode/tasks directory. */
    function createTaskFiles(files: Record<string, string>, folder = '.vscode/tasks'): void {
        const tasksDir = path.join(workspaceDir, folder);
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(tasksDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    // ========================================================================
    // GET /api/workspaces/:id/tasks — Hierarchy
    // ========================================================================

    describe('GET /api/workspaces/:id/tasks — Hierarchy', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/nonexistent/tasks`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('should return empty hierarchy when tasks folder does not exist', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.name).toBeDefined();
            expect(body.children).toBeDefined();
            expect(Array.isArray(body.children)).toBe(true);
        });

        it('should return hierarchy with task files', async () => {
            const srv = await startServer();

            createTaskFiles({
                'my-task.md': '# My Task\n\nSome content',
                'another-task.md': '# Another Task\n\nMore content',
            });

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Should contain the task documents
            const allDocs = [...(body.singleDocuments || []), ...(body.documentGroups || [])];
            expect(allDocs.length).toBeGreaterThanOrEqual(2);
        });

        it('should return hierarchy with nested folders', async () => {
            const srv = await startServer();

            createTaskFiles({
                'feature1/task1.md': '# Task 1',
                'feature1/task2.md': '# Task 2',
                'feature2/task3.md': '# Task 3',
            });

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.children.length).toBe(2);
        });

        it('should use custom folder when ?folder= is specified', async () => {
            const srv = await startServer();

            createTaskFiles({
                'task-a.md': '# Task A',
            }, 'custom-tasks');

            const wsId = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks?folder=custom-tasks`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const allDocs = [...(body.singleDocuments || []), ...(body.documentGroups || [])];
            expect(allDocs.length).toBeGreaterThanOrEqual(1);
        });
    });

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

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=../../etc/passwd`);
            expect(res.status).toBe(403);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('outside');
        });

        it('should return 403 for path traversal with encoded dots', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/content?path=..%2F..%2Fetc%2Fpasswd`);
            expect(res.status).toBe(403);
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
            expect(body.folderPath).toBe('.vscode/tasks');
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
    });
});
