/**
 * Workspace Summary Handler Tests
 *
 * Tests for GET /api/workspaces/:id/summary which returns both
 * workflows and tasks in a single response.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { resolveTaskRoot } from '../../src/server/tasks/task-root-resolver';

// Mock loadDefaultMcpConfig from forge to control the global MCP config in tests.
const mockLoadDefaultMcpConfig = vi.fn().mockReturnValue({
    mcpServers: {} as Record<string, any>,
    configPath: '',
    loadedAt: 0,
});

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadDefaultMcpConfig: () => mockLoadDefaultMcpConfig(),
        executePipeline: vi.fn().mockResolvedValue({
            executionStats: { totalItems: 0, successfulItems: 0, failedItems: 0, durationMs: 0 },
            output: { formattedOutput: '' },
        }),
        sdkServiceRegistry: {
            getOrThrow: () => ({ sendMessage: vi.fn(), isAvailable: vi.fn().mockResolvedValue({ available: false }) }),
        },
    };
});

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

describe('Workspace Summary Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-workspace-'));
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

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    function createPipelines(pipelines: Record<string, string>): void {
        const pipelinesDir = path.join(workspaceDir, '.vscode', 'workflows');
        for (const [name, content] of Object.entries(pipelines)) {
            const dir = path.join(pipelinesDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'pipeline.yaml'), content, 'utf-8');
        }
    }

    function createTaskFiles(files: Record<string, string>): void {
        const tasksDir = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(tasksDir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    const VALID_YAML = `name: "Test Workflow"
description: "A test workflow"

input:
  type: csv
  path: "input.csv"

map:
  prompt: "Analyze: {{title}}"
  output:
    - result
  parallel: 5

reduce:
  type: json
`;

    const VALID_YAML_NO_DESC = `name: "No Description"

input:
  type: csv
  path: "input.csv"

map:
  prompt: "Analyze: {{title}}"
  output:
    - result

reduce:
  type: json
`;

    const MISSING_FIELDS_YAML = `name: "Incomplete"
`;

    // ========================================================================
    // GET /api/workspaces/:id/summary
    // ========================================================================

    describe('GET /api/workspaces/:id/summary', () => {
        it('should return 404 for unknown workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/nonexistent/summary`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Workspace not found');
        });

        it('should return empty workflows and tasks when workspace has no data', async () => {
            const srv = await startServer();
            const id = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${id}/summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.workflows).toEqual([]);
            expect(body.tasks).toBeDefined();
            expect(body.tasks.name).toBeDefined();
            expect(body.tasks.children).toBeDefined();
            expect(Array.isArray(body.tasks.children)).toBe(true);
        });

        it('should return both workflows and tasks when both are populated', async () => {
            const srv = await startServer();

            createPipelines({
                'my-pipe': VALID_YAML,
                'another-pipe': VALID_YAML_NO_DESC,
            });

            // Create dummy input.csv for validation
            const pipelinesDir = path.join(workspaceDir, '.vscode', 'workflows');
            fs.writeFileSync(path.join(pipelinesDir, 'my-pipe', 'input.csv'), 'title\nfoo\n', 'utf-8');
            fs.writeFileSync(path.join(pipelinesDir, 'another-pipe', 'input.csv'), 'title\nbar\n', 'utf-8');

            createTaskFiles({
                'my-task.md': '# My Task\n\nSome content',
                'another-task.md': '# Another Task\n\nMore content',
            });

            const id = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${id}/summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            // Workflows
            expect(body.workflows).toHaveLength(2);
            const myPipe = body.workflows.find((p: any) => p.name === 'my-pipe');
            expect(myPipe).toBeDefined();
            expect(myPipe.description).toBe('A test workflow');
            expect(typeof myPipe.isValid).toBe('boolean');
            expect(Array.isArray(myPipe.validationErrors)).toBe(true);

            const anotherPipe = body.workflows.find((p: any) => p.name === 'another-pipe');
            expect(anotherPipe).toBeDefined();
            expect(anotherPipe.description).toBeUndefined();

            // Tasks
            const allDocs = [...(body.tasks.singleDocuments || []), ...(body.tasks.documentGroups || [])];
            expect(allDocs.length).toBeGreaterThanOrEqual(2);
        });

        it('should return invalid workflow with validation errors', async () => {
            const srv = await startServer();
            createPipelines({ 'bad-pipe': MISSING_FIELDS_YAML });
            const id = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${id}/summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.workflows).toHaveLength(1);
            expect(body.workflows[0].name).toBe('bad-pipe');
            expect(body.workflows[0].isValid).toBe(false);
            expect(body.workflows[0].validationErrors.length).toBeGreaterThan(0);
        });

        it('should honour the folder query param for workflows', async () => {
            const srv = await startServer();

            // Create workflow in a custom folder
            const customDir = path.join(workspaceDir, 'custom-workflows', 'my-pipe');
            fs.mkdirSync(customDir, { recursive: true });
            fs.writeFileSync(path.join(customDir, 'pipeline.yaml'), VALID_YAML, 'utf-8');
            fs.writeFileSync(path.join(customDir, 'input.csv'), 'title\nfoo\n', 'utf-8');

            const id = await registerWorkspace(srv, workspaceDir);

            // Without folder param — should find nothing in default .vscode/workflows
            const defaultRes = await request(`${srv.url}/api/workspaces/${id}/summary`);
            expect(defaultRes.status).toBe(200);
            const defaultBody = JSON.parse(defaultRes.body);
            expect(defaultBody.workflows).toEqual([]);

            // With custom folder param
            const customRes = await request(`${srv.url}/api/workspaces/${id}/summary?folder=custom-workflows`);
            expect(customRes.status).toBe(200);
            const customBody = JSON.parse(customRes.body);
            expect(customBody.workflows).toHaveLength(1);
            expect(customBody.workflows[0].name).toBe('my-pipe');
        });

        it('should include archive folder in tasks when showArchived=true', async () => {
            const srv = await startServer();

            createTaskFiles({
                'my-task.md': '# My Task',
                'archive/old-task.md': '# Old Task',
            });

            const id = await registerWorkspace(srv, workspaceDir);

            // Without showArchived — archive should not appear
            const defaultRes = await request(`${srv.url}/api/workspaces/${id}/summary`);
            expect(defaultRes.status).toBe(200);
            const defaultBody = JSON.parse(defaultRes.body);
            const defaultArchive = defaultBody.tasks.children?.find((c: any) => c.name === 'archive');
            expect(defaultArchive).toBeUndefined();

            // With showArchived=true — archive folder should appear
            const archiveRes = await request(`${srv.url}/api/workspaces/${id}/summary?showArchived=true`);
            expect(archiveRes.status).toBe(200);
            const archiveBody = JSON.parse(archiveRes.body);
            const archiveNode = archiveBody.tasks.children?.find((c: any) => c.name === 'archive');
            expect(archiveNode).toBeDefined();
            expect(archiveNode.isArchived).toBe(true);
        });

        it('should return task hierarchy with nested folders', async () => {
            const srv = await startServer();

            createTaskFiles({
                'feature1/task1.md': '# Task 1',
                'feature2/task2.md': '# Task 2',
            });

            const id = await registerWorkspace(srv, workspaceDir);
            const res = await request(`${srv.url}/api/workspaces/${id}/summary`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.tasks.children.length).toBe(2);
        });
    });

    // ========================================================================
    // Old endpoints are removed
    // ========================================================================

    describe('Old endpoints removed', () => {
        it('GET /api/workspaces/:id/workflows should return 404', async () => {
            const srv = await startServer();
            const id = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${id}/workflows`);
            expect(res.status).toBe(404);
        });

        it('GET /api/workspaces/:id/tasks should return 404', async () => {
            const srv = await startServer();
            const id = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${id}/tasks`);
            expect(res.status).toBe(404);
        });
    });
});
