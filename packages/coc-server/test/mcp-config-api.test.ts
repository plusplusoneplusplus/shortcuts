/**
 * MCP Config API Endpoint Tests
 *
 * Tests for the MCP config API routes:
 * - GET /api/workspaces/:id/mcp-config
 * - PUT /api/workspaces/:id/mcp-config
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerApiRoutes } from '../src/api-handler';
import type { Route } from '../src/types';
import { createMockProcessStore } from './helpers/mock-process-store';

// ============================================================================
// Mock loadDefaultMcpConfig
// ============================================================================

const mockLoadDefaultMcpConfig = vi.hoisted(() => vi.fn());
vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, loadDefaultMcpConfig: mockLoadDefaultMcpConfig };
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
        mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: {} });
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

        it('returns availableServers array from loadDefaultMcpConfig', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
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
        });

        it('returns availableServers: [] when loadDefaultMcpConfig returns empty map', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: {} });
            const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
            expect(res.status).toBe(200);
            const data = res.json();
            expect(data.availableServers).toEqual([]);
        });

        it('includes url for SSE servers and omits headers', async () => {
            mockLoadDefaultMcpConfig.mockReturnValue({
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
});
