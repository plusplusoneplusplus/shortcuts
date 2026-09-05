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
    // AC-02: a repo group is an ordinary registry workspace with a `group-` id and no
    // git checkout, so it must ride these same routes with no `group-` branch anywhere.
    const GROUP_ID = 'group-mcp-demo';

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-roundtrip-'));
        mockStore = createMockProcessStore({
            initialWorkspaces: [
                { id: WORKSPACE_ID, name: 'Proj', rootPath: '/projects/proj' },
                { id: GROUP_ID, name: 'Demo Group', rootPath: path.join(dataDir, 'repos', GROUP_ID) },
            ],
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
        // The store MUST persist across requests: partial-patch semantics are only
        // observable if a field a later request omits keeps its earlier value.
        const records: Record<string, Record<string, unknown>> = {
            [WORKSPACE_ID]: { id: WORKSPACE_ID, name: 'Proj', rootPath: '/projects/proj' },
            [GROUP_ID]: { id: GROUP_ID, name: 'Demo Group', rootPath: path.join(dataDir, 'repos', GROUP_ID) },
        };
        (mockStore.getWorkspaces as any).mockImplementation(async () => Object.values(records).map(w => ({ ...w })));
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            Object.assign(records[id], updates);
            return { ...records[id] };
        });
        // Each test starts from an empty preference file for both workspaces.
        for (const id of [WORKSPACE_ID, GROUP_ID]) {
            const prefsPath = path.join(dataDir, 'repos', id, 'preferences.json');
            if (fs.existsSync(prefsPath)) fs.unlinkSync(prefsPath);
        }
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

    // ── Partial-patch semantics ─────────────────────────────────────────────
    // The two fields have separate persistence owners, so each is patched by
    // property PRESENCE: omitted = untouched, null = cleared. A tools-only
    // caller must never have to send a server-list snapshot, because a stale
    // snapshot is exactly what used to revert a newer server toggle.

    it('a tools-only PUT leaves enabledMcpServers untouched', async () => {
        await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: ['github'] }),
        });
        (mockStore.updateWorkspace as any).mockClear();

        const put = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpTools: { github: ['create_issue'] } }),
        });
        expect(put.status).toBe(200);
        // The server record was never rewritten, so no snapshot could revert it.
        expect(mockStore.updateWorkspace).not.toHaveBeenCalled();
        expect(readRepoPreferences(dataDir, WORKSPACE_ID).enabledMcpTools).toEqual({ github: ['create_issue'] });
    });

    it('a servers-only PUT leaves the enabledMcpTools allow-list untouched', async () => {
        await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpTools: { github: ['create_issue'] } }),
        });

        const put = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: ['github'] }),
        });
        expect(put.status).toBe(200);
        expect(readRepoPreferences(dataDir, WORKSPACE_ID).enabledMcpTools).toEqual({ github: ['create_issue'] });
        const get = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`);
        expect(get.json().enabledMcpTools).toEqual({ github: ['create_issue'] });
    });

    it('returns the canonical resulting policy for a partial patch', async () => {
        await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: ['github'] }),
        });
        const put = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpTools: { github: [] } }),
        });
        const body = put.json();
        // Both fields come back, including the one this request did not patch.
        expect(body.enabledMcpServers).toEqual(['github']);
        expect(body.enabledMcpTools).toEqual({ github: [] });
    });

    it('rejects a PUT that patches neither field', async () => {
        const put = await request(`${base()}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({}),
        });
        expect(put.status).toBe(400);
        expect(put.json().code).toBe('MISSING_FIELDS');
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

/**
 * AC-02 — the same route with a `group-` workspace id. The group's enablement lands
 * on its workspace record and its allow-list under `~/.coc/repos/<groupId>/preferences.json`,
 * and neither touches a member repo.
 */
describe('MCP config round-trip for a repo group', () => {
    let server: http.Server;
    let port: number;
    let dataDir: string;
    let mockStore: ReturnType<typeof createMockProcessStore>;

    const GROUP_ID = 'group-mcp-roundtrip';
    const MEMBER_ID = 'ws-member';

    beforeAll(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-group-roundtrip-'));
        fs.mkdirSync(path.join(dataDir, 'repos', GROUP_ID), { recursive: true });
        fs.mkdirSync(path.join(dataDir, 'repos', MEMBER_ID), { recursive: true });
        mockStore = createMockProcessStore({
            initialWorkspaces: [
                { id: GROUP_ID, name: 'Group', rootPath: path.join(dataDir, 'repos', GROUP_ID) },
                { id: MEMBER_ID, name: 'Member', rootPath: '/projects/member' },
            ],
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
        mockLoadWorkspaceMcpConfig.mockReturnValue({ mcpServers: {}, configPath: '', fileExists: false });
        const records: Record<string, Record<string, unknown>> = {
            [GROUP_ID]: { id: GROUP_ID, name: 'Group', rootPath: path.join(dataDir, 'repos', GROUP_ID) },
            [MEMBER_ID]: { id: MEMBER_ID, name: 'Member', rootPath: '/projects/member' },
        };
        (mockStore.getWorkspaces as any).mockImplementation(async () => Object.values(records).map(w => ({ ...w })));
        (mockStore.updateWorkspace as any).mockImplementation(async (id: string, updates: any) => {
            Object.assign(records[id], updates);
            return { ...records[id] };
        });
        for (const id of [GROUP_ID, MEMBER_ID]) {
            const prefsPath = path.join(dataDir, 'repos', id, 'preferences.json');
            if (fs.existsSync(prefsPath)) fs.unlinkSync(prefsPath);
        }
    });

    const base = () => `http://127.0.0.1:${port}`;

    it('PUT round-trips enablement and the allow-list for a group id', async () => {
        const put = await request(`${base()}/api/workspaces/${GROUP_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({
                enabledMcpServers: ['github'],
                enabledMcpTools: { github: ['create_issue'] },
            }),
        });
        expect(put.status).toBe(200);

        // Enablement on the group's workspace record…
        expect(mockStore.updateWorkspace).toHaveBeenCalledWith(GROUP_ID, expect.objectContaining({ enabledMcpServers: ['github'] }));
        // …and the allow-list under ~/.coc/repos/<groupId>/preferences.json.
        const prefsPath = path.join(dataDir, 'repos', GROUP_ID, 'preferences.json');
        expect(fs.existsSync(prefsPath)).toBe(true);
        expect(readRepoPreferences(dataDir, GROUP_ID).enabledMcpTools).toEqual({ github: ['create_issue'] });

        const get = await request(`${base()}/api/workspaces/${GROUP_ID}/mcp-config`);
        expect(get.status).toBe(200);
        expect(get.json().enabledMcpServers).toEqual(['github']);
        expect(get.json().enabledMcpTools).toEqual({ github: ['create_issue'] });
    });

    it('a group write leaves a member repo\'s own MCP settings untouched', async () => {
        await request(`${base()}/api/workspaces/${MEMBER_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: [], enabledMcpTools: { github: ['list_issues'] } }),
        });
        await request(`${base()}/api/workspaces/${GROUP_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: ['github'], enabledMcpTools: { github: ['create_issue'] } }),
        });

        // Group settings apply only to the group's own chats.
        expect(readRepoPreferences(dataDir, MEMBER_ID).enabledMcpTools).toEqual({ github: ['list_issues'] });
        const member = await request(`${base()}/api/workspaces/${MEMBER_ID}/mcp-config`);
        expect(member.json().enabledMcpServers).toEqual([]);
    });

    it('toggling off a server that vanished from the global config still works', async () => {
        await request(`${base()}/api/workspaces/${GROUP_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: ['github', 'ghost'] }),
        });
        mockLoadDefaultMcpConfig.mockReturnValue({ mcpServers: { github: { command: 'npx', type: 'stdio' } }, configPath: '~/.copilot/mcp-config.json', fileExists: true });

        const put = await request(`${base()}/api/workspaces/${GROUP_ID}/mcp-config`, {
            method: 'PUT',
            body: JSON.stringify({ enabledMcpServers: ['github'] }),
        });
        expect(put.status).toBe(200);
        const get = await request(`${base()}/api/workspaces/${GROUP_ID}/mcp-config`);
        expect(get.json().enabledMcpServers).toEqual(['github']);
    });
});
