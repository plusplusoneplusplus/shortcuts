/**
 * Tests for the Teams messaging handler and manager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';

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
        await manager.connect();
        const status = manager.getStatus();
        expect(status.status).toBe('disconnected');
        expect(status.error).toBe('Teams integration is disabled');
    });

    it('connect resolves team/channel and starts bot', async () => {
        // Prepare a writable home dir for MCP config test
        const fakeHome = path.join(tmpDir, 'fakehome');
        fs.mkdirSync(path.join(fakeHome, '.copilot'), { recursive: true });

        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: fakeHome });
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

    it('registers 3 routes', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-routes-test-'));
        try {
            const routes: any[] = [];
            registerTeamsMessagingRoutes(routes, { dataDir: tmpDir });
            expect(routes.length).toBe(3);
            expect(routes[0].method).toBe('GET');
            expect(routes[0].pattern).toEqual(/^\/container\/messaging\/teams\/status$/);
            expect(routes[1].method).toBe('POST');
            expect(routes[1].pattern).toEqual(/^\/container\/messaging\/teams\/config$/);
            expect(routes[2].method).toBe('POST');
            expect(routes[2].pattern).toEqual(/^\/container\/messaging\/teams\/reconnect$/);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
