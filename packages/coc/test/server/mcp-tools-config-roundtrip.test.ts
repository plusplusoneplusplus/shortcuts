/**
 * MCP enabled-tools allow-list round-trip (AC-03).
 *
 * Verifies that `PUT /api/workspaces/:id/mcp-config` with an `enabledMcpTools`
 * allow-list persists to the per-repo preference file and is echoed back by
 * `GET /api/workspaces/:id/mcp-config` (so a UI reload reflects the toggle).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import { readRepoPreferences } from '../../src/server/preferences-handler';

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

const mockReadAllDescriptions = vi.hoisted(() => vi.fn().mockReturnValue({}));
vi.mock('../../src/server/routes/mcp-config-writer', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return { ...actual, readAllDescriptions: mockReadAllDescriptions };
});

// Avoid live network probes when the tools-discovery endpoint resolves.
vi.mock('../../src/server/routes/mcp-connection-tester', () => ({
    testMcpConnection: vi.fn(),
    listMcpTools: vi.fn().mockResolvedValue({ success: true, message: 'ok', tools: [] }),
}));

function request(
    url: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({ status: res.statusCode || 0, json: () => JSON.parse(bodyStr) });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

describe('MCP enabled-tools allow-list round-trip', () => {
    let server: http.Server;
    let port: number;
    let dataDir: string;
    let mockStore: ReturnType<typeof createMockProcessStore>;

    const WORKSPACE_ID = 'ws-tools';

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-roundtrip-'));
        mockStore = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'Proj', rootPath: '/projects/proj' }],
        });
        const routes: Route[] = [];
        registerApiRoutes(routes, mockStore, undefined, dataDir);
        const handleRequest = createRouter({ routes, spaHtml: '<html></html>' });
        server = http.createServer(handleRequest);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        mockReadAllDescriptions.mockReturnValue({});
        mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: { github: { command: 'npx', type: 'stdio' } }, configPath: '~/.copilot/mcp-config.json', fileExists: true });
        mockLoadWorkspaceMcpConfig.mockReturnValue({ mcpServers: {}, configPath: '/projects/proj/.vscode/mcp.json', fileExists: false });
        (mockStore.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'Proj', rootPath: '/projects/proj' },
        ]);
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => ({
            id, name: 'Proj', rootPath: '/projects/proj', ...updates,
        }));
    });

    const base = () => `http://127.0.0.1:${port}`;

    it('GET returns enabledMcpTools: null when none persisted', async () => {
        const res = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
        expect(res.status).toBe(200);
        expect(res.json().enabledMcpTools).toBeNull();
    });

    it('PUT persists enabledMcpTools and GET echoes it back', async () => {
        const put = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({
                enabledMcpServers: null,
                enabledMcpTools: { github: ['create_issue'] },
            }),
        });
        expect(put.status).toBe(200);

        // Preference file round-trips on disk.
        expect(readRepoPreferences(dataDir, WORKSPACE_ID).enabledMcpTools).toEqual({ github: ['create_issue'] });

        // GET reflects the persisted allow-list (survives a "reload").
        const get = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
        expect(get.json().enabledMcpTools).toEqual({ github: ['create_issue'] });
    });

    it('PUT with enabledMcpTools: null clears the allow-list', async () => {
        await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: null, enabledMcpTools: { github: ['x'] } }),
        });
        await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: null, enabledMcpTools: null }),
        });
        const get = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
        expect(get.json().enabledMcpTools).toBeNull();
    });

    it('persists an empty allow-list (disable-all) for a server', async () => {
        const put = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: null, enabledMcpTools: { github: [] } }),
        });
        expect(put.status).toBe(200);
        const get = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
        expect(get.json().enabledMcpTools).toEqual({ github: [] });
    });
});
