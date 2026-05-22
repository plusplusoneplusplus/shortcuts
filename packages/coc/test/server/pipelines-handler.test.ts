/**
 * Workflows Handler Tests
 *
 * Comprehensive tests for the Workflow CRUD REST API endpoints:
 * list (enriched), content read/write, create from template, delete.
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

// Mock MCP config loaders from pipeline-core to control effective MCP config in tests.
// executePipeline is also mocked to avoid actual AI execution in workflow-run tests.
const mockLoadDefaultMcpConfig = vi.hoisted(() => vi.fn().mockReturnValue({
    mcpServers: {} as Record<string, any>,
    configPath: '',
    fileExists: false,
}));
const mockLoadWorkspaceMcpConfig = vi.hoisted(() => vi.fn().mockReturnValue({
    mcpServers: {} as Record<string, any>,
    configPath: '',
    fileExists: false,
}));
const mockLoadEffectiveMcpConfig = vi.hoisted(() => vi.fn((options?: { workingDirectory?: string }) => {
    const globalConfig = mockLoadDefaultMcpConfig();
    const workspaceConfig = mockLoadWorkspaceMcpConfig(options?.workingDirectory);
    return {
        success: true,
        mcpServers: {
            ...globalConfig.mcpServers,
            ...workspaceConfig.mcpServers,
        },
        configPath: workspaceConfig.configPath || globalConfig.configPath,
        fileExists: Boolean(globalConfig.fileExists || workspaceConfig.fileExists),
    };
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadDefaultMcpConfig: () => mockLoadDefaultMcpConfig(),
        loadWorkspaceMcpConfig: (workingDirectory: string) => mockLoadWorkspaceMcpConfig(workingDirectory),
        loadEffectiveMcpConfig: (options: { workingDirectory?: string }) => mockLoadEffectiveMcpConfig(options),
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

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function putJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PUT',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function deleteReq(url: string) {
    return request(url, { method: 'DELETE' });
}

// ============================================================================
// Tests
// ============================================================================

describe('Workflows Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflows-handler-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflows-workspace-'));
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
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    /** Create workflow directories with pipeline.yaml files. */
    function createPipelines(pipelines: Record<string, string>): void {
        const pipelinesDir = path.join(workspaceDir, '.vscode', 'workflows');
        for (const [name, content] of Object.entries(pipelines)) {
            const dir = path.join(pipelinesDir, name);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, 'pipeline.yaml'), content, 'utf-8');
        }
    }

    // Valid pipeline YAML for testing
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

    const INVALID_YAML = '{ bad: [yaml:';

    // ========================================================================
    // GET /api/workspaces/:id/pipelines/:name/content — Read content
    // ========================================================================

    describe('GET /api/workspaces/:id/pipelines/:name/content', () => {
        it('should return YAML content of a workflow', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const res = await request(`${srv.url}/api/workspaces/${wsId}/workflows/my-pipe/content`);
            expect(res.status).toBe(200);
            const data = JSON.parse(res.body);
            expect(data.content).toBe(VALID_YAML);
            expect(data.path).toContain('pipeline.yaml');
        });

        it('should return 404 for missing workflow', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/workflows/nonexistent/content`);
            expect(res.status).toBe(404);
        });

        it('should reject path traversal', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await request(`${srv.url}/api/workspaces/${wsId}/workflows/..%2F..%2Fetc%2Fpasswd/content`);
            expect(res.status === 403 || res.status === 404).toBe(true);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/pipelines/:name/content — Write content
    // ========================================================================

    describe('PATCH /api/workspaces/:id/pipelines/:name/content', () => {
        it('should update YAML content', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const newContent = 'name: "Updated"\ninput:\n  type: csv\n  path: "in.csv"\n';
            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/my-pipe/content`,
                { content: newContent }
            );
            expect(res.status).toBe(200);

            // Verify file on disk
            const onDisk = fs.readFileSync(
                path.join(workspaceDir, '.vscode', 'workflows', 'my-pipe', 'pipeline.yaml'),
                'utf-8'
            );
            expect(onDisk).toBe(newContent);
        });

        it('should reject invalid YAML', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/my-pipe/content`,
                { content: INVALID_YAML }
            );
            expect(res.status).toBe(400);
        });

        it('should reject missing content field', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'my-pipe': VALID_YAML });

            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/my-pipe/content`,
                {}
            );
            expect(res.status).toBe(400);
        });

        it('should return 404 for non-existent workflow', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await patchJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/nonexistent/content`,
                { content: 'name: test\n' }
            );
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/pipelines — Create workflow
    // ========================================================================

    describe('POST /api/workspaces/:id/pipelines', () => {
        it('should create a workflow from default template', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/workflows`, {
                name: 'new-pipe',
            });
            expect(res.status).toBe(201);

            const data = JSON.parse(res.body);
            expect(data.name).toBe('new-pipe');
            expect(data.template).toBe('custom');

            // Verify on disk
            const yamlPath = path.join(workspaceDir, '.vscode', 'workflows', 'new-pipe', 'pipeline.yaml');
            expect(fs.existsSync(yamlPath)).toBe(true);
            const content = fs.readFileSync(yamlPath, 'utf-8');
            expect(content).toContain('name:');
        });

        it('should create a workflow with specified template', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/workflows`, {
                name: 'fanout-pipe',
                template: 'data-fanout',
            });
            expect(res.status).toBe(201);
            const data = JSON.parse(res.body);
            expect(data.template).toBe('data-fanout');
        });

        it('should return 409 for duplicate workflow name', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res1 = await postJSON(`${srv.url}/api/workspaces/${wsId}/workflows`, {
                name: 'dup-pipe',
            });
            expect(res1.status).toBe(201);

            const res2 = await postJSON(`${srv.url}/api/workspaces/${wsId}/workflows`, {
                name: 'dup-pipe',
            });
            expect(res2.status).toBe(409);
        });

        it('should reject path traversal in name', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/workflows`, {
                name: '../escape',
            });
            expect(res.status).toBe(403);
        });

        it('should reject empty name', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(`${srv.url}/api/workspaces/${wsId}/workflows`, {
                name: '',
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/pipelines/:name — Delete workflow
    // ========================================================================

    describe('DELETE /api/workspaces/:id/pipelines/:name', () => {
        it('should delete an existing workflow', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            createPipelines({ 'to-delete': VALID_YAML });

            const pipeDir = path.join(workspaceDir, '.vscode', 'workflows', 'to-delete');
            expect(fs.existsSync(pipeDir)).toBe(true);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/workflows/to-delete`);
            expect(res.status).toBe(200);

            const data = JSON.parse(res.body);
            expect(data.deleted).toBe('to-delete');
            expect(fs.existsSync(pipeDir)).toBe(false);
        });

        it('should return 404 for non-existent workflow', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/workflows/nonexistent`);
            expect(res.status).toBe(404);
        });

        it('should reject path traversal', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await deleteReq(`${srv.url}/api/workspaces/${wsId}/workflows/..%2F..%2Fetc`);
            expect(res.status === 403 || res.status === 404).toBe(true);
        });
    });

    // ====================================================================
    // POST /api/workspaces/:id/pipelines/:name/run
    // ====================================================================

    describe('POST /api/workspaces/:id/pipelines/:name/run', () => {
        it('should return 201 with taskId when workflow exists', async () => {
            createPipelines({ 'my-pipeline': VALID_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/my-pipeline/run`,
                {}
            );
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
            expect(typeof body.taskId).toBe('string');
            expect(body.pipelineName).toBe('my-pipeline');
            expect(body.queuedAt).toBeDefined();
            expect(typeof body.queuedAt).toBe('number');
        });

        it('should return 404 when workspace not found', async () => {
            const srv = await startServer();

            const res = await postJSON(
                `${srv.url}/api/workspaces/nonexistent-ws/workflows/my-pipeline/run`,
                {}
            );
            expect(res.status).toBe(404);
        });

        it('should return 404 when workflow not found', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/nonexistent-pipeline/run`,
                {}
            );
            expect(res.status).toBe(404);
        });

        it('should return 403 for path traversal', async () => {
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/..%2F..%2Fetc/run`,
                {}
            );
            expect(res.status === 403 || res.status === 404).toBe(true);
        });

        it('should accept optional body with model and params', async () => {
            createPipelines({ 'param-pipeline': VALID_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);

            const res = await postJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/param-pipeline/run`,
                { model: 'gpt-4', params: { key: 'value' } }
            );
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
            expect(body.pipelineName).toBe('param-pipeline');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/pipelines/:name/run — MCP filter
    // ========================================================================

    describe('POST /api/workspaces/:id/pipelines/:name/run — MCP filter', () => {
        const JOB_YAML = `name: "MCP Test Job"\njob:\n  prompt: "Say hello"\n`;

        beforeEach(() => {
            mockLoadDefaultMcpConfig.mockReset();
            mockLoadDefaultMcpConfig.mockReturnValue({
                mcpServers: {},
                configPath: '',
                fileExists: false,
            });
            mockLoadWorkspaceMcpConfig.mockReset();
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                mcpServers: {},
                configPath: '',
                fileExists: false,
            });
            mockLoadEffectiveMcpConfig.mockClear();
        });

        async function runAndGetTask(srv: ExecutionServer, wsId: string, pipeName: string) {
            const runRes = await postJSON(
                `${srv.url}/api/workspaces/${wsId}/workflows/${pipeName}/run`,
                {}
            );
            expect(runRes.status).toBe(201);
            const { taskId } = JSON.parse(runRes.body);
            const taskRes = await request(`${srv.url}/api/queue/${taskId}`);
            expect(taskRes.status).toBe(200);
            return JSON.parse(taskRes.body).task;
        }

        it('should set payload.mcpServers=undefined when enabledMcpServers is not set (global config)', async () => {
            createPipelines({ 'mcp-pipe': JOB_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            // No PUT to mcp-config — enabledMcpServers is undefined
            const task = await runAndGetTask(srv, wsId, 'mcp-pipe');
            expect(task.payload.mcpServers).toBeUndefined();
        });

        it('should set payload.mcpServers=undefined when enabledMcpServers=null (opt-out)', async () => {
            createPipelines({ 'mcp-pipe-null': JOB_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            await putJSON(`${srv.url}/api/workspaces/${wsId}/mcp-config`, { enabledMcpServers: null });
            const task = await runAndGetTask(srv, wsId, 'mcp-pipe-null');
            expect(task.payload.mcpServers).toBeUndefined();
        });

        it('should set payload.mcpServers={} when enabledMcpServers=[] (all disabled)', async () => {
            createPipelines({ 'mcp-pipe-empty': JOB_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            mockLoadDefaultMcpConfig.mockReturnValue({
                mcpServers: { serverA: { command: 'npx', args: ['serverA'] } },
                configPath: '',
                fileExists: true,
            });
            await putJSON(`${srv.url}/api/workspaces/${wsId}/mcp-config`, { enabledMcpServers: [] });
            const task = await runAndGetTask(srv, wsId, 'mcp-pipe-empty');
            expect(task.payload.mcpServers).toEqual({});
        });

        it('should filter to only named server when enabledMcpServers=["serverA"]', async () => {
            createPipelines({ 'mcp-pipe-filter': JOB_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const serverAConfig = { command: 'npx', args: ['-y', 'serverA'] };
            mockLoadDefaultMcpConfig.mockReturnValue({
                mcpServers: {
                    serverA: serverAConfig,
                    serverB: { command: 'npx', args: ['-y', 'serverB'] },
                },
                configPath: '',
                fileExists: true,
            });
            await putJSON(`${srv.url}/api/workspaces/${wsId}/mcp-config`, { enabledMcpServers: ['serverA'] });
            const task = await runAndGetTask(srv, wsId, 'mcp-pipe-filter');
            expect(task.payload.mcpServers).toEqual({ serverA: serverAConfig });
        });

        it('should filter against workspace-over-global effective MCP config', async () => {
            createPipelines({ 'mcp-pipe-workspace': JOB_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            const workspaceServerConfig = { command: 'workspace-cmd' };
            mockLoadDefaultMcpConfig.mockReturnValue({
                mcpServers: {
                    shared: { command: 'global-cmd' },
                    globalOnly: { command: 'global-only' },
                },
                configPath: '',
                fileExists: true,
            });
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                mcpServers: {
                    shared: workspaceServerConfig,
                    workspaceOnly: { command: 'workspace-only' },
                },
                configPath: '',
                fileExists: true,
            });
            await putJSON(`${srv.url}/api/workspaces/${wsId}/mcp-config`, { enabledMcpServers: ['shared', 'workspaceOnly'] });
            const task = await runAndGetTask(srv, wsId, 'mcp-pipe-workspace');
            expect(mockLoadEffectiveMcpConfig).toHaveBeenCalledWith({ workingDirectory: workspaceDir });
            expect(task.payload.mcpServers).toEqual({
                shared: workspaceServerConfig,
                workspaceOnly: { command: 'workspace-only' },
            });
        });

        it('should produce {} when named server is absent from effective config', async () => {
            createPipelines({ 'mcp-pipe-absent': JOB_YAML });
            const srv = await startServer();
            const wsId = await registerWorkspace(srv, workspaceDir);
            mockLoadDefaultMcpConfig.mockReturnValue({
                mcpServers: { serverA: { command: 'npx', args: ['serverA'] } },
                configPath: '',
                fileExists: true,
            });
            await putJSON(`${srv.url}/api/workspaces/${wsId}/mcp-config`, { enabledMcpServers: ['serverX'] });
            const task = await runAndGetTask(srv, wsId, 'mcp-pipe-absent');
            expect(task.payload.mcpServers).toEqual({});
        });
    });
});
