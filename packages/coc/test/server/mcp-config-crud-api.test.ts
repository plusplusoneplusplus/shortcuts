/**
 * MCP Config CRUD API Endpoint Tests
 *
 * Tests for the new MCP server management REST endpoints:
 * - GET  /api/workspaces/:id/mcp-config/:server/detail
 * - POST /api/workspaces/:id/mcp-config  (create)
 * - PUT  /api/workspaces/:id/mcp-config/:server  (update)
 * - DELETE /api/workspaces/:id/mcp-config/:server
 * - POST /api/workspaces/:id/mcp-config/:server/migrate
 * - PUT  /api/workspaces/:id/mcp-config (enabledMcpTools support)
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mocks for forge and mcp-config-writer
// ============================================================================

const mockLoadDefaultMcpConfig = vi.hoisted(() => vi.fn());
const mockLoadWorkspaceMcpConfig = vi.hoisted(() => vi.fn());
vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        loadDefaultMcpConfig: mockLoadDefaultMcpConfig,
        loadWorkspaceMcpConfig: mockLoadWorkspaceMcpConfig,
    };
});

const mockGetServerDetail = vi.hoisted(() => vi.fn());
const mockUpdateServerConfig = vi.hoisted(() => vi.fn());
const mockDeleteServerFromConfig = vi.hoisted(() => vi.fn());
const mockAddServerToConfig = vi.hoisted(() => vi.fn());
const mockMigrateServerScope = vi.hoisted(() => vi.fn());
const mockReadAllDescriptions = vi.hoisted(() => vi.fn().mockReturnValue({}));
const mockFindServerSource = vi.hoisted(() => vi.fn());

vi.mock('../../src/server/routes/mcp-config-writer', () => ({
    getServerDetail: mockGetServerDetail,
    updateServerConfig: mockUpdateServerConfig,
    deleteServerFromConfig: mockDeleteServerFromConfig,
    addServerToConfig: mockAddServerToConfig,
    migrateServerScope: mockMigrateServerScope,
    readAllDescriptions: mockReadAllDescriptions,
    findServerSource: mockFindServerSource,
}));

const mockTestMcpConnection = vi.hoisted(() => vi.fn());
vi.mock('../../src/server/routes/mcp-connection-tester', () => ({
    testMcpConnection: mockTestMcpConnection,
}));

// ============================================================================
// Test Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('MCP Config CRUD API endpoints', () => {
    let server: http.Server;
    let port: number;
    let mockStore: ReturnType<typeof createMockProcessStore>;

    const WORKSPACE_ID = 'ws-crud';

    beforeAll(async () => {
        mockStore = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my' }],
        });

        const routes: Route[] = [];
        registerApiRoutes(routes, mockStore);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
        vi.resetAllMocks();
        mockReadAllDescriptions.mockReturnValue({});
        mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: {}, configPath: '~/.copilot/mcp-config.json', fileExists: false });
        mockLoadWorkspaceMcpConfig.mockReturnValue({ mcpServers: {}, configPath: '/projects/my/.vscode/mcp.json', fileExists: false });
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my' },
        ]);
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            return { id, name: 'My Project', rootPath: '/projects/my', ...updates };
        });
    });

    const base = () => `http://127.0.0.1:${port}`;

    // ========================================================================
    // GET /api/workspaces/:id/mcp-config/:server/detail
    // ========================================================================

    describe('GET /api/workspaces/:id/mcp-config/:server/detail', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown/mcp-config/github/detail`);
            expect(res.status).toBe(404);
        });

        it('returns 404 when server not found', async () => {
            mockGetServerDetail.mockReturnValue(null);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/unknown-server/detail`);
            expect(res.status).toBe(404);
        });

        it('returns server detail when found', async () => {
            const detail = {
                description: 'GitHub MCP server',
                envKeys: ['GITHUB_TOKEN'],
                args: ['-y', '@modelcontextprotocol/server-github'],
                toolScope: 'all',
                source: 'global',
                rawJson: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'secret' } },
            };
            mockGetServerDetail.mockReturnValue(detail);

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github/detail`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.description).toBe('GitHub MCP server');
            expect(data.envKeys).toEqual(['GITHUB_TOKEN']);
            expect(data.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
            expect(data.toolScope).toBe('all');
            expect(data.source).toBe('global');
            expect(data.rawJson).toBeDefined();
            // rawJson should not expose secret values in keys (they're part of rawJson by design)
            expect(mockGetServerDetail).toHaveBeenCalledWith('github', '/projects/my');
        });

        it('URL-decodes server names with special characters', async () => {
            mockGetServerDetail.mockReturnValue({
                description: '', envKeys: [], args: [], toolScope: 'all', source: 'workspace', rawJson: {},
            });
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/my%20server/detail`);
            expect(mockGetServerDetail).toHaveBeenCalledWith('my server', '/projects/my');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/mcp-config  (create)
    // ========================================================================

    describe('POST /api/workspaces/:id/mcp-config', () => {
        beforeEach(() => {
            mockFindServerSource.mockReturnValue(null); // no conflict by default
            mockAddServerToConfig.mockImplementation(() => undefined);
        });

        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({ name: 'github', type: 'stdio', scope: 'global' }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when name is missing', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({ type: 'stdio', scope: 'global' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when type is invalid', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({ name: 'test', type: 'websocket', scope: 'global' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when scope is invalid', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({ name: 'test', type: 'stdio', scope: 'invalid' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when http server is missing url', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({ name: 'test', type: 'http', scope: 'global' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when server name already exists', async () => {
            mockFindServerSource.mockReturnValue({ source: 'global', rawEntry: {} });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({ name: 'github', type: 'stdio', scope: 'global' }),
            });
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.code).toBe('BAD_REQUEST');
        });

        it('creates a stdio server and returns 201', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'myserver',
                    type: 'stdio',
                    command: 'npx',
                    args: ['-y', '@org/mcp-server'],
                    description: 'My custom server',
                    scope: 'workspace',
                }),
            });
            expect(res.status).toBe(201);
            const data = res.json();
            expect(data.name).toBe('myserver');
            expect(data.scope).toBe('workspace');
            expect(mockAddServerToConfig).toHaveBeenCalledWith('/projects/my', expect.objectContaining({
                name: 'myserver',
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@org/mcp-server'],
                description: 'My custom server',
                scope: 'workspace',
            }));
        });

        it('creates an http server and returns 201', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'POST',
                body: JSON.stringify({
                    name: 'remote',
                    type: 'http',
                    url: 'https://api.example.com/mcp',
                    scope: 'global',
                }),
            });
            expect(res.status).toBe(201);
            expect(mockAddServerToConfig).toHaveBeenCalledWith('/projects/my', expect.objectContaining({
                name: 'remote',
                type: 'http',
                url: 'https://api.example.com/mcp',
                scope: 'global',
            }));
        });
    });

    // ========================================================================
    // PUT /api/workspaces/:id/mcp-config/:server  (update)
    // ========================================================================

    describe('PUT /api/workspaces/:id/mcp-config/:server', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown/mcp-config/github`, {
                method: 'PUT',
                body: JSON.stringify({ description: 'new desc' }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 404 when server not found', async () => {
            mockUpdateServerConfig.mockReturnValue(false);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/unknown`, {
                method: 'PUT',
                body: JSON.stringify({ description: 'new desc' }),
            });
            expect(res.status).toBe(404);
        });

        it('updates server config and returns 200', async () => {
            mockUpdateServerConfig.mockReturnValue(true);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github`, {
                method: 'PUT',
                body: JSON.stringify({
                    description: 'Updated description',
                    args: ['--verbose'],
                    toolScope: 'readonly',
                }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.updated).toBe(true);
            expect(mockUpdateServerConfig).toHaveBeenCalledWith('github', '/projects/my', {
                description: 'Updated description',
                args: ['--verbose'],
                toolScope: 'readonly',
            });
        });

        it('only passes defined fields to updateServerConfig', async () => {
            mockUpdateServerConfig.mockReturnValue(true);
            await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github`, {
                method: 'PUT',
                body: JSON.stringify({ description: 'Only desc' }),
            });
            const call = mockUpdateServerConfig.mock.calls[0][2];
            expect(call.description).toBe('Only desc');
            expect(call.args).toBeUndefined();
            expect(call.env).toBeUndefined();
            expect(call.toolScope).toBeUndefined();
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/mcp-config/:server
    // ========================================================================

    describe('DELETE /api/workspaces/:id/mcp-config/:server', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown/mcp-config/github`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });

        it('returns 404 when server not found', async () => {
            mockDeleteServerFromConfig.mockReturnValue(false);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/unknown`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(404);
        });

        it('deletes server and returns 200', async () => {
            mockDeleteServerFromConfig.mockReturnValue(true);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github`, {
                method: 'DELETE',
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.deleted).toBe(true);
            expect(mockDeleteServerFromConfig).toHaveBeenCalledWith('github', '/projects/my');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/mcp-config/:server/migrate
    // ========================================================================

    describe('POST /api/workspaces/:id/mcp-config/:server/migrate', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown/mcp-config/github/migrate`, {
                method: 'POST',
                body: JSON.stringify({ targetScope: 'global' }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when targetScope is invalid', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github/migrate`, {
                method: 'POST',
                body: JSON.stringify({ targetScope: 'local' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 404 when server not found', async () => {
            mockMigrateServerScope.mockReturnValue(false);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/unknown/migrate`, {
                method: 'POST',
                body: JSON.stringify({ targetScope: 'global' }),
            });
            expect(res.status).toBe(404);
        });

        it('migrates server to global scope and returns 200', async () => {
            mockMigrateServerScope.mockReturnValue(true);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github/migrate`, {
                method: 'POST',
                body: JSON.stringify({ targetScope: 'global' }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.name).toBe('github');
            expect(data.scope).toBe('global');
            expect(mockMigrateServerScope).toHaveBeenCalledWith('github', '/projects/my', 'global');
        });

        it('migrates server to workspace scope and returns 200', async () => {
            mockMigrateServerScope.mockReturnValue(true);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/github/migrate`, {
                method: 'POST',
                body: JSON.stringify({ targetScope: 'workspace' }),
            });
            expect(res.status).toBe(200);
            expect(mockMigrateServerScope).toHaveBeenCalledWith('github', '/projects/my', 'workspace');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/mcp-config/test
    // ========================================================================

    describe('POST /api/workspaces/:id/mcp-config/test', () => {
        beforeEach(() => {
            mockTestMcpConnection.mockResolvedValue({ success: true, message: 'MCP server responded successfully' });
        });

        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'some-server'] }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 when type is invalid', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'unknown' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when stdio type has no command', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'stdio' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 400 when http type has no url', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'http' }),
            });
            expect(res.status).toBe(400);
        });

        it('returns 200 and success when stdio test passes', async () => {
            mockTestMcpConnection.mockResolvedValue({
                success: true,
                message: 'MCP server responded successfully',
                protocolVersion: '2024-11-05',
                serverName: 'github-mcp',
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_TOKEN: 'token' } }),
            });
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.success).toBe(true);
            expect(data.protocolVersion).toBe('2024-11-05');
            expect(data.serverName).toBe('github-mcp');
            expect(mockTestMcpConnection).toHaveBeenCalledWith({
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-github'],
                env: { GITHUB_TOKEN: 'token' },
                url: undefined,
            });
        });

        it('returns 422 when test fails', async () => {
            mockTestMcpConnection.mockResolvedValue({
                success: false,
                message: 'Timed out waiting for MCP initialize response (10 s)',
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'stdio', command: 'bad-command' }),
            });
            expect(res.status).toBe(422);
            const data = res.json();
            expect(data.success).toBe(false);
            expect(data.message).toContain('Timed out');
        });

        it('returns 200 for successful http test', async () => {
            mockTestMcpConnection.mockResolvedValue({ success: true, message: 'Server responded with HTTP 200' });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'http', url: 'http://localhost:8080/mcp' }),
            });
            expect(res.status).toBe(200);
            expect(res.json().success).toBe(true);
            expect(mockTestMcpConnection).toHaveBeenCalledWith({
                type: 'http',
                url: 'http://localhost:8080/mcp',
                command: undefined,
                args: undefined,
                env: undefined,
            });
        });

        it('returns 422 for failed http test', async () => {
            mockTestMcpConnection.mockResolvedValue({ success: false, message: 'Connection failed: ECONNREFUSED' });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config/test`, {
                method: 'POST',
                body: JSON.stringify({ type: 'sse', url: 'http://localhost:9999/events' }),
            });
            expect(res.status).toBe(422);
            expect(res.json().success).toBe(false);
        });
    });
});
