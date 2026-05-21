/**
 * MCP Config API Endpoint Tests
 *
 * Tests for the MCP config API routes:
 * - GET /api/workspaces/:id/mcp-config
 * - PUT /api/workspaces/:id/mcp-config
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock MCP config loaders
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

// Mock mcp-config-writer so readAllDescriptions doesn't touch real filesystem
const mockReadAllDescriptions = vi.hoisted(() => vi.fn().mockReturnValue({}));
vi.mock('../../src/server/routes/mcp-config-writer', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, readAllDescriptions: mockReadAllDescriptions };
});

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

describe('MCP Config API endpoints', () => {
    let server: http.Server;
    let port: number;
    let mockStore: ReturnType<typeof createMockProcessStore>;

    const WORKSPACE_ID = 'ws-1';

    beforeAll(async () => {
        mockStore = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my' }],
        });
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my' },
        ]);
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            return { id, name: 'My Project', rootPath: '/projects/my', ...updates };
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
        mockLoadDefaultMcpConfig.mockReset();
        mockLoadWorkspaceMcpConfig.mockReset();
        mockReadAllDescriptions.mockReset();
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
    // GET /api/workspaces/:id/mcp-config
    // ========================================================================

    describe('GET /api/workspaces/:id/mcp-config', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/mcp-config`);
            expect(res.status).toBe(404);
        });

        it('returns enabledMcpServers: null when enabledMcpServers is undefined', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.enabledMcpServers).toBeNull();
        });

        it('returns enabledMcpServers array when workspace has enabledMcpServers set', async () => {
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my', enabledMcpServers: ['github'] },
            ]);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.enabledMcpServers).toEqual(['github']);
        });

        it('returns global source servers and effective availableServers when only global config exists', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: {
                    github: { type: 'stdio', command: 'npx', args: ['@modelcontextprotocol/server-github'] },
                    filesystem: { type: 'stdio', command: 'npx', args: ['@modelcontextprotocol/server-filesystem', '/'] },
                },
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(Array.isArray(data.availableServers)).toBe(true);
            const names = data.availableServers.map((s: any) => s.name);
            expect(names).toContain('github');
            expect(names).toContain('filesystem');
            const github = data.availableServers.find((s: any) => s.name === 'github');
            expect(github.type).toBe('stdio');
            expect(github.command).toBe('npx');
            expect(github.args).toBeUndefined();
            expect(github.env).toBeUndefined();
            expect(github.source).toBe('global');
            expect(github.effective).toBe(true);
            expect(data.sources.global).toMatchObject({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                success: true,
            });
            expect(data.sources.global.servers).toHaveLength(2);
            expect(data.sources.workspace.servers).toEqual([]);
        });

        it('returns workspace source servers when only workspace config exists', async () => {
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                configPath: '/projects/my/.vscode/mcp.json',
                fileExists: true,
                mcpServers: {
                    repo: { type: 'sse', url: 'http://localhost:1234/sse' },
                },
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            // availableServers now includes a `status` field derived server-side
            expect(data.availableServers).toMatchObject([{
                name: 'repo',
                type: 'sse',
                url: 'http://localhost:1234/sse',
                source: 'workspace',
                effective: true,
                status: 'auth', // sse → 'auth' when enabled
            }]);
            expect(data.availableServers[0].env).toBeUndefined();
            expect(data.sources.global.servers).toEqual([]);
        });

        it('returns distinct global and workspace servers in source sections', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: {
                    globalOnly: { command: 'global-cmd' },
                },
            });
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                configPath: '/projects/my/.vscode/mcp.json',
                fileExists: true,
                mcpServers: {
                    workspaceOnly: { command: 'workspace-cmd' },
                },
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers.map((server: any) => server.name)).toEqual(['globalOnly', 'workspaceOnly']);
            expect(data.sources.global.servers.map((server: any) => server.name)).toEqual(['globalOnly']);
            expect(data.sources.workspace.servers.map((server: any) => server.name)).toEqual(['workspaceOnly']);
        });

        it('marks global duplicate as overridden and workspace duplicate as effective', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: {
                    shared: { command: 'global-cmd' },
                    globalOnly: { command: 'global-only' },
                },
            });
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                configPath: '/projects/my/.vscode/mcp.json',
                fileExists: true,
                mcpServers: {
                    shared: { command: 'workspace-cmd' },
                },
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers.find((server: any) => server.name === 'shared')).toMatchObject({
                name: 'shared',
                command: 'workspace-cmd',
                source: 'workspace',
                effective: true,
            });
            expect(data.sources.global.servers.find((server: any) => server.name === 'shared')).toMatchObject({
                name: 'shared',
                command: 'global-cmd',
                source: 'global',
                effective: false,
                overriddenBy: 'workspace',
            });
            expect(data.sources.workspace.servers.find((server: any) => server.name === 'shared')).toMatchObject({
                name: 'shared',
                command: 'workspace-cmd',
                source: 'workspace',
                effective: true,
            });
        });

        it('returns availableServers: [] and empty source sections when neither config exists', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers).toEqual([]);
            expect(data.sources.global).toMatchObject({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: false,
                success: true,
                servers: [],
            });
            expect(data.sources.workspace).toMatchObject({
                configPath: '/projects/my/.vscode/mcp.json',
                fileExists: false,
                success: true,
                servers: [],
            });
        });

        it('includes url for SSE servers and omits headers', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: {
                    'mcp-server': { type: 'sse', url: 'http://0.0.0.0:8000/sse', headers: { Authorization: 'Bearer secret' }, tools: ['*'] },
                },
            });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers).toHaveLength(1);
            const server = data.availableServers[0];
            expect(server.name).toBe('mcp-server');
            expect(server.type).toBe('sse');
            expect(server.url).toBe('http://0.0.0.0:8000/sse');
            expect(server.headers).toBeUndefined();
        });

        it('passes forceReload=true to both config loaders when requested', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config?forceReload=true`);
            expect(res.status).toBe(200);
            expect(mockLoadDefaultMcpConfig).toHaveBeenCalledWith(true);
            expect(mockLoadWorkspaceMcpConfig).toHaveBeenCalledWith('/projects/my', true);
        });

        it('returns scoped global source error while keeping valid workspace servers', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                success: false,
                error: 'Failed to parse MCP config: bad global JSON',
                mcpServers: {},
            });
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                configPath: '/projects/my/.vscode/mcp.json',
                fileExists: true,
                success: true,
                mcpServers: {
                    workspace: { command: 'workspace-cmd', env: { TOKEN: 'secret' } },
                },
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers).toMatchObject([
                { name: 'workspace', type: 'stdio', command: 'workspace-cmd', source: 'workspace', effective: true, status: 'ok' },
            ]);
            expect(data.availableServers[0].env).toBeUndefined();
            expect(data.sources.global).toMatchObject({
                success: false,
                error: 'Failed to parse MCP config: bad global JSON',
                servers: [],
            });
            expect(data.sources.workspace.success).toBe(true);
            expect(data.sources.workspace.servers[0].env).toBeUndefined();
        });

        it('returns scoped workspace source error while keeping valid global servers', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                success: true,
                mcpServers: {
                    global: { command: 'global-cmd', args: ['secret-arg'] },
                },
            });
            mockLoadWorkspaceMcpConfig.mockReturnValue({
                configPath: '/projects/my/.vscode/mcp.json',
                fileExists: true,
                success: false,
                error: 'Failed to parse MCP config: bad workspace JSON',
                mcpServers: {},
            });

            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers).toMatchObject([
                { name: 'global', type: 'stdio', command: 'global-cmd', source: 'global', effective: true, status: 'ok' },
            ]);
            expect(data.availableServers[0].env).toBeUndefined();
            expect(data.availableServers[0].args).toBeUndefined();
            expect(data.sources.global.success).toBe(true);
            expect(data.sources.global.servers[0].args).toBeUndefined();
            expect(data.sources.workspace).toMatchObject({
                success: false,
                error: 'Failed to parse MCP config: bad workspace JSON',
                servers: [],
            });
        });
    });

    // ========================================================================
    // PUT /api/workspaces/:id/mcp-config
    // ========================================================================

    describe('PUT /api/workspaces/:id/mcp-config', () => {
        it('returns 404 when workspace not found', async () => {
            const res = await request(`${base()}/api/workspaces/unknown-ws/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: ['github'] }),
            });
            expect(res.status).toBe(404);
        });

        it('returns 400 with MISSING_FIELDS when enabledMcpServers field is absent', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ other: 'field' }),
            });
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.code).toBe('MISSING_FIELDS');
        });

        it('returns 400 with BAD_REQUEST when enabledMcpServers is non-array non-null', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: 'github' }),
            });
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.code).toBe('BAD_REQUEST');
        });

        it('saves enabledMcpServers array and returns 200 with updated workspace', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: ['github'] }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { enabledMcpServers: ['github'] });
            const data = res.json();
            expect(data.workspace).toBeDefined();
            expect(data.workspace.enabledMcpServers).toEqual(['github']);
        });

        it('saves enabledMcpServers: null and returns 200', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: null }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { enabledMcpServers: null });
            const data = res.json();
            expect(data.workspace).toBeDefined();
        });

        it('saves enabledMcpServers: [] (empty array) and returns 200', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: [] }),
            });
            expect(res.status).toBe(200);
            expect(mockStore.updateWorkspace).toHaveBeenCalledWith(WORKSPACE_ID, { enabledMcpServers: [] });
        });

        it('returns 400 with INVALID_JSON for invalid JSON body', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: 'not-valid-json{',
            });
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.code).toBe('INVALID_JSON');
        });

        it('returns 400 when enabledMcpServers array contains non-string items', async () => {
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
                method: 'PUT',
                body: JSON.stringify({ enabledMcpServers: ['github', 42] }),
            });
            expect(res.status).toBe(400);
            const data = res.json();
            expect(data.code).toBe('BAD_REQUEST');
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/mcp-config — status and description fields
    // ========================================================================

    describe('GET /api/workspaces/:id/mcp-config — status and description', () => {
        it('includes status:ok for stdio server that is enabled', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: { github: { command: 'npx', type: 'stdio' } },
            });
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my', enabledMcpServers: null },
            ]);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            const data = res.json();
            expect(data.availableServers[0].status).toBe('ok');
        });

        it('includes status:auth for http server that is enabled', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: { myapi: { type: 'http', url: 'http://localhost:8080' } },
            });
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my', enabledMcpServers: null },
            ]);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            const data = res.json();
            expect(data.availableServers[0].status).toBe('auth');
        });

        it('includes status:off for server that is disabled in enabledMcpServers', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: { github: { command: 'npx', type: 'stdio' } },
            });
            (mockStore.getWorkspaces as any).mockResolvedValue([
                { id: WORKSPACE_ID, name: 'My Project', rootPath: '/projects/my', enabledMcpServers: [] },
            ]);
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            const data = res.json();
            expect(data.availableServers[0].status).toBe('off');
        });

        it('includes description from readAllDescriptions when present', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: { github: { command: 'npx', type: 'stdio' } },
            });
            mockReadAllDescriptions.mockReturnValue({ github: 'GitHub MCP server' });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            const data = res.json();
            expect(data.availableServers[0].description).toBe('GitHub MCP server');
        });

        it('omits description when readAllDescriptions returns nothing for that server', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
                configPath: '~/.copilot/mcp-config.json',
                fileExists: true,
                mcpServers: { github: { command: 'npx', type: 'stdio' } },
            });
            // default mock returns {}
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            const data = res.json();
            expect(data.availableServers[0].description).toBeUndefined();
        });
    });
});
