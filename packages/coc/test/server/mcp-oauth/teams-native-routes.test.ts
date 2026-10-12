import * as http from 'node:http';
import * as path from 'node:path';
import * as os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@plusplusoneplusplus/coc-native';
import { registerMcpOauthRoutes } from '../../../src/server/mcp-oauth/mcp-oauth-routes';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import type { Route } from '../../../src/server/types';

const fixture = vi.hoisted(() => ({
    serverUrl: 'https://resource.example/tenants/11111111-1111-4111-8111-111111111111/mcp',
    getToken: vi.fn().mockResolvedValue('fixture-token'),
    legacyRead: vi.fn(),
    legacyClear: vi.fn(),
}));
vi.mock('@plusplusoneplusplus/forge', async original => ({
    ...await original<typeof import('@plusplusoneplusplus/forge')>(),
    loadDefaultMcpConfig: vi.fn(() => ({ mcpServers: {
        'Microsoft Teams': { type: 'http', url: fixture.serverUrl, tools: ['*'] },
    } })),
}));
vi.mock('../../../src/server/messaging/teams-native-auth', async original => ({
    ...await original<typeof import('../../../src/server/messaging/teams-native-auth')>(),
    getTeamsOAuthCredential: vi.fn(() => ({ getToken: fixture.getToken })),
}));
vi.mock('../../../src/server/mcp-oauth/mcp-oauth-token-cache', async original => ({
    ...await original<typeof import('../../../src/server/mcp-oauth/mcp-oauth-token-cache')>(),
    readMcpServerAuthInfo: fixture.legacyRead,
    clearMcpServerAuth: fixture.legacyClear,
}));

const servers: http.Server[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()))));
    vi.clearAllMocks();
});

async function setup() {
    const manager = new McpOauthManager();
    const startTeamsOAuth = vi.fn().mockResolvedValue({
        requestId: 'native-request', authorizationUrl: 'https://login.example/authorize',
    });
    const cancelTeamsOAuth = vi.fn();
    const isTeamsOAuthPending = vi.fn(() => false);
    const routes: Route[] = [];
    registerMcpOauthRoutes(routes, {
        manager, dataDir: path.join(os.tmpdir(), 'teams-native-routes-fixture'),
        startTeamsOAuth, cancelTeamsOAuth, isTeamsOAuthPending,
        resolveWorkspaceRoot: async id => id === 'workspace-fixture' ? os.tmpdir() : undefined,
    });
    const server = http.createServer((req, res) => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        const route = routes.find(candidate => candidate.method === req.method && candidate.pattern.test(pathname));
        if (!route) { res.writeHead(404).end(); return; }
        Promise.resolve(route.handler(req, res, pathname.match(route.pattern)!))
            .catch(() => res.writeHead(500).end());
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const post = (endpoint: string, body?: object) => fetch(`http://127.0.0.1:${address.port}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    });
    return { manager, startTeamsOAuth, cancelTeamsOAuth, isTeamsOAuthPending, post, port: address.port };
}

describe('Teams native authentication through MCP routes', () => {
    it('uses native credentials without starting a Copilot session or reading legacy cache', async () => {
        const f = await setup();
        const response = await f.post('/api/mcp-oauth/start', { serverName: 'Microsoft Teams' });
        expect(await response.json()).toMatchObject({ alreadyAuthenticated: true });
        expect(f.startTeamsOAuth).not.toHaveBeenCalled();
        expect(fixture.legacyRead).not.toHaveBeenCalled();
    });

    it('starts native sign-in for missing credentials and preserves workspace ownership', async () => {
        const f = await setup();
        fixture.getToken.mockRejectedValueOnce(new AuthError('InteractionRequired'));
        const response = await f.post('/api/mcp-oauth/start', { serverName: 'Microsoft Teams', workspaceId: 'workspace-fixture' });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ requestId: 'native-request', alreadyAuthenticated: false });
        expect(f.startTeamsOAuth).toHaveBeenCalledWith(fixture.serverUrl, { workspaceId: 'workspace-fixture' });
    });

    it('reauthenticates without deleting another owner cache', async () => {
        const f = await setup();
        const response = await f.post('/api/mcp-oauth/start', { serverName: 'Microsoft Teams', force: true });
        expect(response.status).toBe(200);
        expect(f.startTeamsOAuth).toHaveBeenCalled();
        expect(fixture.getToken).not.toHaveBeenCalled();
        expect(fixture.legacyClear).not.toHaveBeenCalled();
    });

    it('does not authenticate a global resource for an unknown workspace', async () => {
        const f = await setup();
        const response = await f.post('/api/mcp-oauth/start', {
            serverName: 'Microsoft Teams', workspaceId: 'missing-workspace',
        });
        expect(response.status).toBe(404);
        expect(f.startTeamsOAuth).not.toHaveBeenCalled();
        expect(fixture.getToken).not.toHaveBeenCalled();
    });

    it('surfaces native storage errors without starting interactive fallback', async () => {
        const f = await setup();
        fixture.getToken.mockRejectedValueOnce(new AuthError('StorageDenied'));
        const response = await f.post('/api/mcp-oauth/start', { serverName: 'Microsoft Teams' });
        expect(response.status).toBe(500);
        expect(f.startTeamsOAuth).not.toHaveBeenCalled();
    });

    it('rejects completion while native credentials require sign-in', async () => {
        const f = await setup();
        f.manager.addPending({ requestId: 'pending-native', serverName: 'Microsoft Teams', serverUrl: fixture.serverUrl });
        fixture.getToken.mockRejectedValueOnce(new AuthError('InteractionRequired'));
        const response = await f.post('/api/mcp-oauth/pending/pending-native/complete-and-retry');
        expect(response.status).toBe(409);
        expect(f.manager.getPending('pending-native')?.status).toBe('pending');
    });

    it('cancels the native handle when removing a pending request', async () => {
        const f = await setup();
        f.manager.addPending({ requestId: 'pending-native', serverName: 'Microsoft Teams', serverUrl: fixture.serverUrl });
        const response = await fetch(`http://127.0.0.1:${f.port}/api/mcp-oauth/pending/pending-native`, { method: 'DELETE' });
        expect(response.status).toBe(200);
        expect(f.cancelTeamsOAuth).toHaveBeenCalledWith('pending-native');
        expect(f.manager.getPending('pending-native')).toBeUndefined();
    });

    it('does not let old credentials complete a still-running reauthentication', async () => {
        const f = await setup();
        f.isTeamsOAuthPending.mockReturnValue(true);
        f.manager.addPending({ requestId: 'native-reauth', serverName: 'Microsoft Teams', serverUrl: fixture.serverUrl });
        const response = await f.post('/api/mcp-oauth/pending/native-reauth/resolve', { status: 'completed' });
        expect(response.status).toBe(409);
        expect(fixture.getToken).not.toHaveBeenCalled();
        expect(f.manager.getPending('native-reauth')?.status).toBe('pending');
    });
});
