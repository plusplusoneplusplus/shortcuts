/**
 * Tests for the Teams messaging handler and manager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import type { Route } from '../../../src/server/types';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { acquireMcpOAuthToken, TeamsBot } from '@plusplusoneplusplus/coc-connector/teams';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';

// Mock the teams-bot package
vi.mock('@plusplusoneplusplus/coc-connector/teams', () => ({
    TeamsBot: vi.fn().mockImplementation(function (opts: any) {
        return {
            start: vi.fn().mockImplementation(async () => {
                opts.onStatusChange?.('connected');
            }),
            stop: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockResolvedValue('msg-123'),
            setChannelId: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            getStatus: vi.fn().mockReturnValue('connected'),
        };
    }),
    GraphClient: vi.fn().mockImplementation(function () {
        return {
            resolveOrCreateTeamAndChannel: vi.fn().mockResolvedValue({
                teamId: 'team-id-resolved',
                channelId: 'channel-id-resolved',
            }),
        };
    }),
    McpClient: vi.fn().mockImplementation(function () {
        return {
            initialize: vi.fn().mockResolvedValue(undefined),
            callTool: vi.fn().mockImplementation(async (name: string) => {
                if (name === 'ListTeams') {
                    return { content: [{ type: 'text', text: JSON.stringify({ teams: [{ id: 'team-id-resolved', displayName: 'TestTeam' }] }) }] };
                }
                if (name === 'ListChannels') {
                    return { content: [{ type: 'text', text: JSON.stringify({ channels: [{ id: 'channel-id-resolved', displayName: 'TestChannel' }] }) }] };
                }
                return { content: [{ type: 'text', text: '{}' }] };
            }),
        };
    }),
    acquireMcpOAuthToken: vi.fn().mockResolvedValue('fake-mcp-token-abc'),
    acquireTokenViaAzCli: vi.fn().mockResolvedValue('fake-mcp-token-abc'),
    getOAuthConfig: vi.fn(() => ({
        clientId: 'test-public-client', scope: 'https://example.test/teams/.default offline_access',
        authorizeUrl: 'https://login.example.test/oauth2/v2.0/authorize',
    })),
}));

describe('TeamsMessagingManager', () => {
    let tmpDir: string;
    let manager: TeamsMessagingManager;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-msg-test-'));
        manager = new TeamsMessagingManager(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns default status when no config exists', () => {
        const status = manager.getStatus();
        expect(status.enabled).toBe(false);
        expect(status.status).toBe('disconnected');
        expect(status.botName).toBe('CoC');
        expect(status.teamName).toBe('Coc');
        expect(status.channelName).toBe('Coc-General');
        expect(status.error).toBeNull();
    });

    it('updateConfig persists changes', async () => {
        await manager.updateConfig({ enabled: true, botName: 'TestBot' });
        const status = manager.getStatus();
        expect(status.enabled).toBe(true);
        expect(status.botName).toBe('TestBot');

        // Verify persisted to disk
        const configPath = path.join(tmpDir, 'teams-messaging.json');
        expect(fs.existsSync(configPath)).toBe(true);
        const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(saved.enabled).toBe(true);
        expect(saved.botName).toBe('TestBot');
    });

    it('connect fails if not enabled', async () => {
        await expect(manager.connect()).rejects.toThrow('disabled');
        const status = manager.getStatus();
        expect(status.status).toBe('disconnected');
        expect(status.error).toBe('Teams integration is disabled');
    });

    it('connect resolves team/channel and starts bot', async () => {
        // Prepare a writable home dir for MCP config test
        const fakeHome = path.join(tmpDir, 'fakehome');
        fs.mkdirSync(path.join(fakeHome, '.copilot'), { recursive: true });

        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: fakeHome });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/servers/mcp_TeamsServer');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();

        const status = m2.getStatus();
        expect(status.teamId).toBe('team-id-resolved');
        expect(status.channelId).toBe('channel-id-resolved');
        expect(status.status).toBe('connected');

        // Verify MCP config was written
        const mcpConfig = path.join(fakeHome, '.copilot', 'mcp-config.json');
        expect(fs.existsSync(mcpConfig)).toBe(true);
        const mcpData = JSON.parse(fs.readFileSync(mcpConfig, 'utf-8'));
        expect(mcpData.mcpServers?.['Microsoft Teams']).toBeDefined();
        expect(mcpData.mcpServers['Microsoft Teams'].type).toBe('http');
        expect(acquireMcpOAuthToken).toHaveBeenCalledWith('https://example.test/servers/mcp_TeamsServer', fakeHome);
        const botOptions = vi.mocked(TeamsBot).mock.lastCall?.[0];
        expect(botOptions?.auth?.onTokenRefresh).toBeDefined();
        await expect(botOptions!.auth!.onTokenRefresh!()).resolves.toBe('fake-mcp-token-abc');
        botOptions?.onError?.('Polling unavailable');
        expect(m2.getStatus().error).toBe('Polling unavailable');
        botOptions?.onStatusChange?.('connected');
        expect(m2.getStatus().error).toBeNull();
    });

    it('reports connection failures and disconnects when disabled', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        vi.mocked(acquireMcpOAuthToken).mockRejectedValueOnce(new Error('OAuth required'));
        await expect(m2.connect()).rejects.toThrow('OAuth required');
        expect(m2.getStatus()).toMatchObject({ status: 'error', error: 'OAuth required' });
        await m2.connect();
        expect(m2.getStatus().status).toBe('connected');
        await m2.updateConfig({ enabled: false });
        expect(m2.getStatus()).toMatchObject({ enabled: false, status: 'disconnected' });
    });

    it('does not fabricate a Teams endpoint and rejects invalid URLs', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        m2.setMessageHandler(async () => {});
        await m2.updateConfig({ enabled: true });
        await expect(m2.connect()).rejects.toThrow('Configure a global HTTP');
        expect(m2.getStatus().status).toBe('error');
        await expect(m2.configureServer('http://example.test/teams')).rejects.toThrow('HTTPS');
        expect(fs.existsSync(path.join(tmpDir, 'home', '.copilot', 'mcp-config.json'))).toBe(false);
    });

    it('keeps other MCP entries when configuring Teams', async () => {
        const homeDir = path.join(tmpDir, 'home');
        fs.mkdirSync(path.join(homeDir, '.copilot'), { recursive: true });
        const configFile = path.join(homeDir, '.copilot', 'mcp-config.json');
        fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { other: { type: 'stdio', command: 'tool' } } }));
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir });
        await m2.configureServer('https://example.test/teams');
        expect(JSON.parse(fs.readFileSync(configFile, 'utf-8')).mcpServers.other.command).toBe('tool');
    });

    it('does not reconnect after disabling while OAuth is still pending', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true });
        let release!: (token: string) => void;
        vi.mocked(acquireMcpOAuthToken).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const connecting = m2.connect();
        await vi.waitFor(() => expect(release).toBeDefined());
        await m2.updateConfig({ enabled: false });
        release('unused-token');
        await expect(connecting).rejects.toThrow('cancelled');
        expect(m2.getStatus()).toMatchObject({ enabled: false, status: 'disconnected' });
    });

    it('reports corrupt global MCP config without crashing the status endpoint', () => {
        const homeDir = path.join(tmpDir, 'home');
        fs.mkdirSync(path.join(homeDir, '.copilot'), { recursive: true });
        fs.writeFileSync(path.join(homeDir, '.copilot', 'mcp-config.json'), '{invalid');
        expect(new TeamsMessagingManager(tmpDir, { homeDir }).getStatus()).toMatchObject({
            status: 'error', serverUrl: null, error: expect.stringContaining('Cannot read Teams MCP configuration'),
        });
    });

    it('disconnect sets status to disconnected', async () => {
        await manager.disconnect();
        expect(manager.getStatus().status).toBe('disconnected');
    });

    it('loads config from disk on construction', async () => {
        const configPath = path.join(tmpDir, 'teams-messaging.json');
        fs.writeFileSync(configPath, JSON.stringify({
            enabled: true,
            botName: 'DiskBot',
            teamName: 'DiskTeam',
            channelName: 'DiskChannel',
            teamId: 'tid-from-disk',
            channelId: 'cid-from-disk',
        }));

        const m2 = new TeamsMessagingManager(tmpDir);
        const s = m2.getStatus();
        expect(s.enabled).toBe(true);
        expect(s.botName).toBe('DiskBot');
        expect(s.teamName).toBe('DiskTeam');
        expect(s.channelName).toBe('DiskChannel');
        expect(s.teamId).toBe('tid-from-disk');
        expect(s.channelId).toBe('cid-from-disk');
    });

    it('setMessageHandler registers a callback', () => {
        const handler = vi.fn();
        manager.setMessageHandler(handler);
        // No assertion needed beyond no throw — callback is internal
    });
});

describe('Teams messaging routes (integration)', () => {
    // Lightweight route test — we simulate the handler functions directly
    it('registerTeamsMessagingRoutes exports a function', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        expect(typeof registerTeamsMessagingRoutes).toBe('function');
    });

    it('registers normal-CoC routes separately from the container endpoints', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-routes-test-'));
        try {
            const routes: any[] = [];
            registerTeamsMessagingRoutes(routes, { dataDir: tmpDir });
            expect(routes.length).toBe(4);
            expect(routes[0].method).toBe('GET');
            expect(routes[0].pattern).toEqual(/^\/api\/messaging\/teams\/status$/);
            expect(routes[1].method).toBe('POST');
            expect(routes[1].pattern).toEqual(/^\/api\/messaging\/teams\/server$/);
            expect(routes[2].pattern).toEqual(/^\/api\/messaging\/teams\/config$/);
            expect(routes[3].pattern).toEqual(/^\/api\/messaging\/teams\/reconnect$/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('exposes the Teams sign-in flow only when the OAuth manager is available', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-auth-routes-'));
        try {
            const routes: Route[] = [];
            const manager = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
            const oauthManager = new McpOauthManager();
            registerTeamsMessagingRoutes(routes, { dataDir: tmpDir, manager, oauthManager });
            const start = routes.find(r => r.method === 'POST' && r.pattern.test('/api/messaging/teams/auth/start'));
            expect(start).toBeDefined();
            const server = http.createServer((req, res) => {
                const pathname = new URL(req.url!, 'http://localhost').pathname;
                const route = routes.find(r => r.method === req.method && r.pattern.test(pathname));
                if (route) void Promise.resolve(route.handler(req, res, pathname.match(route.pattern)!));
                else { res.writeHead(404); res.end(); }
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            try {
                const addr = server.address();
                if (!addr || typeof addr === 'string') throw new Error('Expected TCP address');
                const base = `http://127.0.0.1:${addr.port}`;
                expect((await fetch(`${base}/api/messaging/teams/auth/start`, { method: 'POST' })).status).toBe(400);
                await manager.configureServer('https://example.test/teams');
                const response = await fetch(`${base}/api/messaging/teams/auth/start`, { method: 'POST' });
                expect(response.status).toBe(200);
                const body = await response.json();
                const signIn = new URL(body.authorizationUrl);
                expect(signIn.protocol).toBe('https:');
                expect(signIn.searchParams.get('code_challenge_method')).toBe('S256');
                expect(oauthManager.getPending(body.requestId)?.status).toBe('pending');
                const url = new URL(body.authorizationUrl);
                const callback = new URL(url.searchParams.get('redirect_uri')!.replace('localhost', '127.0.0.1'));
                callback.searchParams.set('state', url.searchParams.get('state')!);
                callback.searchParams.set('error', 'access_denied');
                await fetch(callback);
            } finally {
                await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
            }
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('saves the endpoint and channel, exposes OAuth availability, and rejects disabled reconnect', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-api-test-'));
        const manager = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        const routes: Route[] = [];
        registerTeamsMessagingRoutes(routes, { dataDir: tmpDir, manager, oauthAvailable: false });
        const server = http.createServer((req, res) => {
            const pathname = new URL(req.url!, 'http://localhost').pathname;
            const route = routes.find(r => r.method === req.method && r.pattern.test(pathname));
            if (route) void Promise.resolve(route.handler(req, res, pathname.match(route.pattern)!));
            else { res.writeHead(404); res.end(); }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const address = server.address();
            if (!address || typeof address === 'string') throw new Error('Expected TCP address');
            const base = `http://127.0.0.1:${address.port}/api/messaging/teams`;
            const post = (path: string, body: object) => fetch(base + path, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            expect((await post('/server', { url: 'http://example.test/teams' })).status).toBe(400);
            expect((await post('/server', { url: 'https://example.test/teams' })).status).toBe(200);
            expect((await post('/config', { teamName: 'Team', channelName: 'General', enabled: true })).status).toBe(200);
            const status = await (await fetch(base + '/status')).json();
            expect(status).toMatchObject({
                enabled: true, teamName: 'Team', channelName: 'General', oauthAvailable: false,
                serverUrl: 'https://example.test/teams', authStatus: 'required',
            });
            const reconnect = await post('/reconnect', {});
            expect(reconnect.status).toBe(500);
            expect((await (await fetch(base + '/status')).json()).status).toBe('error');
            expect((await post('/config', { enabled: false })).status).toBe(200);
            expect((await (await fetch(base + '/status')).json()).status).toBe('disconnected');
        } finally {
            await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
