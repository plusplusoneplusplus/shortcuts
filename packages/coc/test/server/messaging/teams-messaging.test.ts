/**
 * Tests for the Teams messaging handler and manager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import { EventEmitter } from 'node:events';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { Route } from '../../../src/server/types';
import { TeamsMessagingManager, defaultTeamsChannelName } from '../../../src/server/messaging/teams-messaging-manager';
import { TeamsCommandRouter } from '../../../src/server/messaging/teams-command-router';
import { formatTeamsAnswerChunks, TEAMS_ANSWER_MAX_BYTES } from '../../../src/server/messaging/teams-answer-format';
import { getRepoDataPath } from '../../../src/server/paths';
import { acquireMcpOAuthToken, McpClient, TeamsBot, TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import { TeamsBindingReleaseError, type TeamsAnswerRelay } from '../../../src/server/messaging/teams-answer-relay';

// Mock the teams-bot package
vi.mock('@plusplusoneplusplus/coc-connector/teams', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-connector/teams')>(),
    TeamsBot: vi.fn().mockImplementation(function (opts: any) {
        return {
            start: vi.fn().mockImplementation(async () => {
                opts.onStatusChange?.('connected');
            }),
            stop: vi.fn().mockResolvedValue(undefined),
            send: vi.fn().mockResolvedValue('msg-123'),
            getConnectionId: vi.fn().mockReturnValue('test-connection'),
            sendMessage: vi.fn().mockResolvedValue({ outcome: 'accepted', message: {
                backend: 'ic3', connectionId: 'test-connection', messageId: '123',
                destination: { kind: 'chat', chatId: '19:direct@thread.v2' },
            } }),
            reactToChannelMessage: vi.fn().mockResolvedValue(undefined),
            setChannelId: vi.fn(),
            isConnected: vi.fn().mockReturnValue(true),
            getStatus: vi.fn().mockReturnValue('connected'),
            getNotificationStatus: vi.fn().mockReturnValue({
                state: opts.enableTrouter ? 'registered' : 'disabled', error: null,
            }),
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
        expect(status.ic3Region).toBeNull();
        expect(status.enableTrouter).toBe(false);
        expect(status.connectionId).toBeNull();
        expect(status.outboundBackend).toBe('graph');
        expect(status.notificationStatus).toEqual({ state: 'disabled', error: null });
        expect(status.status).toBe('disconnected');
        expect(status.botName).toBe('CoC');
        expect(status.teamName).toBe('Coc');
        expect(status.channelName).toBe(defaultTeamsChannelName(os.hostname()));
        expect(status.error).toBeNull();
        expect(fs.existsSync(path.join(tmpDir, 'teams-messaging.json'))).toBe(false);
    });

    it.each([
        ['Workstation-01', 'CoC-Workstation-01'],
        ['  host.name_01  ', 'CoC-host-name-01'],
        ['.. / :? % #', 'CoC-Machine'],
        ['', 'CoC-Machine'],
        ['  ---  ', 'CoC-Machine'],
        ['üñîçødé', 'CoC-d'],
        ['a'.repeat(60), `CoC-${'a'.repeat(46)}`],
        [`${'a'.repeat(45)}-bad`, `CoC-${'a'.repeat(45)}`],
    ])('generates a valid channel name for hostname %s', (hostname, expected) => {
        expect(defaultTeamsChannelName(hostname)).toBe(expected);
        expect(expected.length).toBeLessThanOrEqual(50);
        expect(expected).toMatch(/^CoC-[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);
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

    it('excludes removed settings from status and subsequent saves', async () => {
        const configPath = path.join(tmpDir, 'teams-messaging.json');
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false, enableIc3ChatSend: false }));
        const restored = new TeamsMessagingManager(tmpDir);
        expect(restored.getStatus()).not.toHaveProperty('enableIc3ChatSend');
        await restored.updateConfig({ botName: 'TestBot' });
        expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).not.toHaveProperty('enableIc3ChatSend');
    });

    it('routes ordinary DMs to IC3 without a send flag and reconnects when region changes', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        m2.setMessageHandler(async () => {});
        const destination = {
            kind: 'chat' as const, chatId: '19:direct@thread.v2',
            recipientId: '00000000-0000-0000-0000-000000000003', connectionId: 'test-connection',
        };
        const body = { content: 'plain <text>', contentType: 'text' as const };
        await expect(m2.sendDirectMessage(destination, body)).rejects.toMatchObject({ outcome: 'not-attempted' });
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].operationRoutes?.chatSend).toBe('ic3');
        await m2.updateConfig({ ic3Region: 'emea' });
        expect(m2.getStatus().status).toBe('disconnected');
        expect(m2.getStatus().connectionId).toBeNull();
        await m2.connect();
        const options = vi.mocked(TeamsBot).mock.lastCall![0];
        expect(options.ic3DirectMessageOptions).toEqual({ region: 'emea' });
        expect(options.operationRoutes).toEqual({ chatSend: 'ic3', channelSend: 'graph', channelReply: 'graph' });
        const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
        const cancellation = new AbortController();
        await expect(m2.sendDirectMessage(destination, body, { signal: cancellation.signal }))
            .resolves.toMatchObject({ outcome: 'accepted', message: { backend: 'ic3' } });
        expect(bot.sendMessage).toHaveBeenCalledExactlyOnceWith(destination, {
            content: '<p>CoC \u00b7 plain &lt;text&gt;</p>', contentType: 'html',
        }, { signal: cancellation.signal });
        expect(bot.send).not.toHaveBeenCalled();
        bot.getConnectionId.mockReturnValue('replacement-connection');
        await expect(m2.sendDirectMessage(destination, body)).rejects.toMatchObject({ code: 'invalid-target', outcome: 'not-attempted' });
        expect(bot.sendMessage).toHaveBeenCalledOnce();
        await m2.updateConfig({ enabled: false });
        expect(bot.stop).toHaveBeenCalledOnce();
        await expect(m2.sendDirectMessage(destination, body)).rejects.toMatchObject({ outcome: 'not-attempted' });
    });

    it.each([false, true])('defaults channel roots, enabled replies and writes to Graph with saved settings present: %s', async savedSettings => {
        if (savedSettings) {
            fs.writeFileSync(path.join(tmpDir, 'teams-messaging.json'), JSON.stringify({
                enabled: true, teamName: 'TestTeam', channelName: 'TestChannel',
            }));
        }
        const restored = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        restored.setMessageHandler(async () => {});
        expect(restored.getStatus().outboundBackend).toBe('graph');
        expect(restored.getStatus().channelReadBackend).toBe('graph');
        await restored.configureServer('https://example.test/teams');
        await restored.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        expect(new TeamsMessagingManager(tmpDir).getStatus().outboundBackend).toBe('graph');
        await restored.connect();
        const options = vi.mocked(TeamsBot).mock.lastCall![0];
        expect(options.mode).toBe('mcp');
        expect(options.channelReadBackend).toBe('graph');
        expect(options.graphReadOptions).toEqual({});
        expect(options.pollChannelReplies?.()).toBe(false);
        expect(options.operationRoutes).toEqual({ chatSend: 'ic3', channelSend: 'graph', channelReply: 'graph' });
        expect(options.graphOutboundOptions).toEqual({});
        expect(options.enableTrouter).toBe(false);
        await restored.disconnect();
    });

    it('preserves explicit MCP outbound, keeps Graph reads, and disconnects on backend changes', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel', outboundBackend: 'mcp' });
        expect(new TeamsMessagingManager(tmpDir).getStatus().outboundBackend).toBe('mcp');
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].operationRoutes).toEqual({ chatSend: 'ic3' });
        expect(vi.mocked(TeamsBot).mock.lastCall![0].channelReadBackend).toBe('graph');
        expect(vi.mocked(TeamsBot).mock.lastCall![0].graphReadOptions).toEqual({});
        await m2.updateConfig({ outboundBackend: 'graph' });
        expect(m2.getStatus().status).toBe('disconnected');
        expect(new TeamsMessagingManager(tmpDir).getStatus().outboundBackend).toBe('graph');
        await m2.connect();
        const options = vi.mocked(TeamsBot).mock.lastCall![0];
        expect(options.mode).toBe('mcp');
        expect(options.operationRoutes).toEqual({ chatSend: 'ic3', channelSend: 'graph', channelReply: 'graph' });
        expect(options.graphOutboundOptions).toEqual({});
        await m2.updateConfig({ outboundBackend: 'mcp' });
        expect(m2.getStatus().status).toBe('disconnected');
        expect(m2.getStatus().teamId).toBe('team-id-resolved');
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].graphOutboundOptions).toBeUndefined();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].channelReadBackend).toBe('graph');
        await m2.disconnect();
    });

    it.each(['auto', 'ic3', '', null, true, 1])('rejects invalid outbound backend %j atomically', async outboundBackend => {
        await manager.updateConfig({ outboundBackend: 'graph' });
        await expect(manager.updateConfig({ outboundBackend, botName: 'Invalid patch' } as any))
            .rejects.toThrow('outboundBackend must be');
        expect(new TeamsMessagingManager(tmpDir).getStatus().outboundBackend).toBe('graph');
        expect(manager.getStatus().botName).toBe('CoC');
    });

    it('fails closed until malformed saved outbound settings are explicitly corrected', async () => {
        fs.writeFileSync(path.join(tmpDir, 'teams-messaging.json'), JSON.stringify({ enabled: true, outboundBackend: 'auto' }));
        const restored = new TeamsMessagingManager(tmpDir);
        expect(restored.getStatus().outboundBackend).toBe('graph');
        expect(restored.getStatus().error).toContain('Invalid saved outbound backend');
        await expect(restored.connect()).rejects.toThrow('Invalid saved outbound backend');
        await expect(restored.updateConfig({ botName: 'New name' })).rejects.toThrow('valid outboundBackend');
        expect(new TeamsMessagingManager(tmpDir).getStatus().error).toContain('Invalid saved outbound backend');
        await restored.updateConfig({ outboundBackend: 'mcp' });
        expect(new TeamsMessagingManager(tmpDir).getStatus().outboundBackend).toBe('mcp');
        expect(new TeamsMessagingManager(tmpDir).getStatus().error).toBeNull();
    });

    it.each(['amer', 'emea', 'apac', null] as const)('persists, reloads, and propagates IC3 region %s', async ic3Region => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel', ic3Region });
        expect(JSON.parse(fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8')).ic3Region).toBe(ic3Region);
        expect(new TeamsMessagingManager(tmpDir).getStatus().ic3Region).toBe(ic3Region);
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].ic3DirectMessageOptions).toEqual({ region: ic3Region ?? undefined });
        expect(m2.getStatus().status).toBe('connected');
        await m2.updateConfig({ ic3Region: ic3Region === 'apac' ? null : 'apac' });
        expect(m2.getStatus().status).toBe('disconnected');
        expect(m2.getStatus().teamId).toBe('team-id-resolved');
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].ic3DirectMessageOptions?.region)
            .toBe(ic3Region === 'apac' ? undefined : 'apac');
        await m2.disconnect();
    });

    it('persists opt-in, passes it to the consumer, and requires reconnect on changes', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].enableTrouter).toBe(false);
        await m2.updateConfig({ enableTrouter: true });
        expect(m2.getStatus().status).toBe('disconnected');
        expect(new TeamsMessagingManager(tmpDir).getStatus().enableTrouter).toBe(true);
        await m2.connect();
        expect(vi.mocked(TeamsBot).mock.lastCall![0].enableTrouter).toBe(true);
        expect(m2.getStatus().notificationStatus).toEqual({ state: 'registered', error: null });
        (m2 as any).bot.getNotificationStatus.mockReturnValue({
            state: 'retrying', error: { code: 'authentication', message: 'Trouter authentication rejected' },
        });
        expect(m2.getStatus()).toMatchObject({
            status: 'connected', notificationStatus: { state: 'retrying', error: { code: 'authentication' } },
        });
        expect(vi.mocked(TeamsBot).mock.lastCall![0].pollChannelReplies?.()).toBe(false);
        await m2.updateConfig({ enableTrouter: false });
        expect(m2.getStatus().status).toBe('disconnected');
        expect(new TeamsMessagingManager(tmpDir).getStatus().enableTrouter).toBe(false);
    });

    it.each(['true', 1, null, {}, []])('rejects malformed notification opt-in %j atomically', async enableTrouter => {
        await manager.updateConfig({ enableTrouter: true });
        const before = fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8');
        await expect(manager.updateConfig({ enableTrouter } as any)).rejects.toThrow('must be a boolean');
        expect(fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8')).toBe(before);
    });

    it('malformed saved notification settings stay disabled', () => {
        fs.writeFileSync(path.join(tmpDir, 'teams-messaging.json'), JSON.stringify({ enableTrouter: 'true' }));
        expect(new TeamsMessagingManager(tmpDir).getStatus().enableTrouter).toBe(false);
    });

    it.each(['', 'AMER', 'auto', '../amer', 'https://example.test', 1, {}])(
        'rejects invalid IC3 region %j without changing persisted settings', async ic3Region => {
            await manager.updateConfig({ ic3Region: 'emea' });
            const before = fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8');
            await expect(manager.updateConfig({ ic3Region } as any)).rejects.toThrow('IC3 region must be');
            expect(fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8')).toBe(before);
        },
    );

    it('treats an invalid saved region as unconfigured without selecting a fallback', () => {
        fs.writeFileSync(path.join(tmpDir, 'teams-messaging.json'), JSON.stringify({ ic3Region: 'auto' }));
        const m2 = new TeamsMessagingManager(tmpDir);
        expect(m2.getStatus().ic3Region).toBeNull();
        expect(m2.getStatus().error).toMatch(/Invalid saved IC3 region/);
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
        expect(status.ic3Region).toBeNull();

        // Verify MCP config was written
        const mcpConfig = path.join(fakeHome, '.copilot', 'mcp-config.json');
        expect(fs.existsSync(mcpConfig)).toBe(true);
        const mcpData = JSON.parse(fs.readFileSync(mcpConfig, 'utf-8'));
        expect(mcpData.mcpServers?.['Microsoft Teams']).toBeDefined();
        expect(mcpData.mcpServers['Microsoft Teams'].type).toBe('http');
        expect(acquireMcpOAuthToken).toHaveBeenCalledWith('https://example.test/servers/mcp_TeamsServer', fakeHome);
        const botOptions = vi.mocked(TeamsBot).mock.lastCall?.[0];
        expect(botOptions?.ic3DirectMessageOptions).toEqual({ region: undefined });
        expect(botOptions?.auth?.onTokenRefresh).toBeDefined();
        await expect(botOptions!.auth!.onTokenRefresh!()).resolves.toBe('fake-mcp-token-abc');
        botOptions?.onError?.('Polling unavailable');
        expect(m2.getStatus().error).toBe('Polling unavailable');
        botOptions?.onStatusChange?.('connected');
        expect(m2.getStatus().error).toBeNull();
    });

    it.each([true, false])('keeps a connected bot only for typed binding reconciliation failures (%s)', async typed => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'release-home') });
        m2.setMessageHandler(async () => {});
        const error = typed ? new TeamsBindingReleaseError([
            { workspaceId: 'ws-a', processId: 'queue_origin', error: new Error('release persistence rejected') },
        ]) : new Error('Invalid Teams answer binding');
        m2.setAnswerRelay({
            reconnected: vi.fn().mockRejectedValue(error), dispose: vi.fn(),
        } as unknown as TeamsAnswerRelay);
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await m2.configureServer('https://example.test/teams');
            await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
            if (typed) {
                await expect(m2.connect()).resolves.toBeUndefined();
                expect(m2.getStatus().status).toBe('connected');
                expect(log).toHaveBeenCalledWith('[teams-answer-relay] Binding release reconciliation failed');
            } else {
                await expect(m2.connect()).rejects.toBe(error);
                expect(m2.getStatus().status).toBe('error');
            }
        } finally {
            m2.dispose();
            log.mockRestore();
        }
    });

    it('prefixes command, status, error, and every formatted relay part at the channel send boundary', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home') });
        const inbound = { channelId: 'channel-id-resolved', messageId: 'user-msg', text: '/list repos', senderAadId: 'user-id' };
        const getWorkspaces = vi.fn().mockResolvedValue([
            { id: 'ws-a', name: 'Alpha', rootPath: 'C:\\repo\\alpha' },
        ]);
        const router = new TeamsCommandRouter({
            store: { getWorkspaces } as ProcessStore,
            enqueueChat: vi.fn().mockResolvedValue('task-1'),
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            sendReply: async (text, replyToId) => { await m2.sendMessage(text, replyToId); },
            dataDir: tmpDir,
        });
        m2.setMessageHandler(msg => router.handle(msg));
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
        const options = vi.mocked(TeamsBot).mock.lastCall![0];

        await options.onMessage(inbound);
        expect(inbound.text).toBe('/list repos');
        expect(bot.send).toHaveBeenLastCalledWith('channel-id-resolved',
            expect.stringMatching(/^<p>CoC · Repos \(1\):<\/p><ol><li><strong>Alpha<\/strong> — <code>C:\\repo\\alpha<\/code><\/li><\/ol>$/),
            { replyToId: 'user-msg' });

        getWorkspaces.mockResolvedValueOnce([
            { id: 'ws-a', name: '<img src=x onerror=bad()> **[bad](javascript:alert(1))',
                rootPath: 'C:\\repo\\`<script>`' },
        ]);
        await options.onMessage({ ...inbound, messageId: 'hostile' });
        const hostile = bot.send.mock.lastCall[1] as string;
        expect(hostile).toContain('&lt;img src=x onerror=bad()&gt;');
        expect(hostile).toContain('<code>C:\\repo\\`&lt;script&gt;`</code>');
        expect(hostile).not.toMatch(/<(?:img|script)\b|href="javascript:/i);

        await options.onMessage({ ...inbound, messageId: 'missing', text: '/select repo Missing' });
        expect(bot.send.mock.lastCall[1]).toMatch(/^<p>CoC · ❌ Repo/);
        getWorkspaces.mockRejectedValueOnce(new Error('offline'));
        await options.onMessage({ ...inbound, messageId: 'error' });
        expect(bot.send.mock.lastCall[1]).toMatch(/^<p>CoC · ❌ Error: offline<\/p>$/);
        bot.send.mockRejectedValueOnce(new Error('channel rejected message'));
        await expect(m2.sendMessage('**Retry**', 'user-msg')).rejects.toThrow('channel rejected message');
        expect(bot.send.mock.lastCall[1]).toBe('<p>CoC · <strong>Retry</strong></p>');

        const parts = formatTeamsAnswerChunks('👩‍💻 <unsafe> & '.repeat(4000), 'opaque-1');
        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) await m2.sendMessage(part, 'user-msg', 'html');
        for (const [index, call] of bot.send.mock.calls.slice(-parts.length).entries()) {
            const html = call[1] as string;
            expect(html).toMatch(new RegExp(`^<p>CoC · <strong>Request opaque-1 · Part ${index + 1}/${parts.length}</strong></p>`));
            expect(Buffer.byteLength(html, 'utf8')).toBeLessThanOrEqual(TEAMS_ANSWER_MAX_BYTES);
            expect(html).not.toContain('<unsafe>');
            expect(call[2]).toEqual({ replyToId: 'user-msg' });
        }
    });

    it('forwards a channel Like target without treating direct-message targets as channels', async () => {
        const fakeHome = path.join(tmpDir, 'reaction-home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: fakeHome });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
        const msg = { channelId: 'channel-id-resolved', messageId: 'reply', replyToMessageId: 'root', text: 'ask' };
        await m2.reactToChannelMessage(msg);
        expect(bot.reactToChannelMessage).toHaveBeenCalledExactlyOnceWith(msg);
        await expect(m2.reactToChannelMessage({ ...msg, channelId: 'dm-chat' }))
            .rejects.toThrow('Teams channel is unavailable');
        expect(bot.reactToChannelMessage).toHaveBeenCalledTimes(1);
        await m2.disconnect();
    });

    it('records separate manual, reconnect and startup attempts only with observability enabled', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const makeManager = () => new TeamsMessagingManager(tmpDir, {
            homeDir, getObservabilityEnabled: () => true,
        });

        const first = makeManager();
        first.setMessageHandler(async () => {});
        await first.configureServer('https://example.test/teams');
        await first.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await first.connect();
        expect(first.getAttemptHistory()).toMatchObject([{
            phases: [
                { stage: 'started' }, { stage: 'authenticating' }, { stage: 'resolving' },
                { stage: 'starting-polling' }, { stage: 'connected' },
            ],
        }]);
        await first.connect();
        expect(first.getAttemptHistory()?.[0].result).toBeUndefined();
        expect(first.getAttemptHistory()?.[1].result).toBe('superseded');
        const startup = makeManager();
        startup.setMessageHandler(async () => {});
        expect(startup.getAttemptHistory()?.[0].result).toBe('interrupted');
        await startup.connect();
        expect(new Set(startup.getAttemptHistory()?.map(a => a.id)).size).toBe(3);
        await startup.disconnect();
        expect(startup.getAttemptHistory()?.[0].result).toBe('disconnected');
        expect(fs.readFileSync(path.join(tmpDir, 'teams-attempts.json'), 'utf8'))
            .not.toMatch(/example\.test|team-id-resolved|channel-id-resolved|fake-mcp-token/);
    });

    it('tracks poll recovery, reply rejection and dispatch without leaking provider data', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home'), getObservabilityEnabled: () => true });
        m2.setMessageHandler(async (_msg, observe) => {
            observe('dispatch-queued');
            m2.recordEvent('reply-attempt');
        });
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        const opts = vi.mocked(TeamsBot).mock.lastCall![0];
        const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
        opts.onPoll?.('failure');
        opts.onError?.('private URL and message');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({ pollDegraded: true });
        for (let i = 0; i < 200; i++) opts.onPoll?.('success');
        for (let i = 0; i < 200; i++) opts.onInbound?.('skipped', 'unchanged');
        opts.onStatusChange?.('connected');
        expect(m2.getStatus().error).toBeNull();
        opts.onInbound?.('skipped', 'empty');
        opts.onInbound?.('observed');
        await opts.onMessage({ channelId: 'private-channel', messageId: 'private-message', text: 'secret text' });
        bot.send.mockRejectedValueOnce(new Error('private MCP response'));
        await expect(m2.sendMessage('private text')).rejects.toThrow('private MCP response');
        expect(m2.getStatus().status).toBe('connected');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({
            pollSuccessCount: 200, pollDegraded: false, sendDegraded: true,
        });
        await m2.sendMessage('private text');
        expect(m2.getAttemptHistory()?.[0].sendDegraded).toBe(false);
        expect(m2.getAttemptHistory()?.[0].events.map(e => e.type)).toEqual([
            'poll-failed', 'inbound-skipped', 'inbound-observed', 'dispatch-queued',
            'reply-attempt', 'reply-rejected', 'reply-accepted',
        ]);
        expect(fs.readFileSync(path.join(tmpDir, 'teams-attempts.json'), 'utf8'))
            .not.toMatch(/private|example\.test|TestTeam|TestChannel/);
    });

    it('closes unexpected bot lifecycle failures but keeps ordinary poll failures active', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home'), getObservabilityEnabled: () => true });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        const first = vi.mocked(TeamsBot).mock.lastCall![0];
        first.onPoll?.('failure');
        first.onError?.('private exception and message ID');
        expect(m2.getStatus().status).toBe('connected');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({ pollDegraded: true, events: [{ type: 'poll-failed' }] });
        expect(m2.getAttemptHistory()?.[0].endedAt).toBeUndefined();

        first.onStatusChange?.('error');
        expect(m2.getStatus().status).toBe('error');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({
            result: 'failed', failureCategory: 'polling', pollDegraded: true,
        });
        const closed = m2.getAttemptHistory()?.[0];
        first.onPoll?.('success');
        first.onStatusChange?.('connected');
        expect(m2.getAttemptHistory()?.[0]).toEqual(closed);
        expect(m2.getStatus().status).toBe('error');

        await m2.connect();
        const second = vi.mocked(TeamsBot).mock.lastCall![0];
        second.onStatusChange?.('disconnected');
        expect(m2.getStatus().status).toBe('disconnected');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({ result: 'disconnected' });
        expect(m2.getAttemptHistory()?.[0].failureCategory).toBeUndefined();
        second.onStatusChange?.('connected');
        expect(m2.getStatus().status).toBe('disconnected');
        expect(fs.readFileSync(path.join(tmpDir, 'teams-attempts.json'), 'utf8'))
            .not.toMatch(/private|example\.test|TestTeam|TestChannel/);
    });

    it('ignores late poll and inbound callbacks from superseded bots and in-flight dispatch', async () => {
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir: path.join(tmpDir, 'home'), getObservabilityEnabled: () => true });
        let release!: () => void;
        m2.setMessageHandler(async (_msg, observe) => {
            await new Promise<void>(resolve => { release = resolve; });
            observe('dispatch-queued');
            m2.recordEvent('reply-attempt');
        });
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        const old = vi.mocked(TeamsBot).mock.lastCall![0];
        const oldBot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
        let finishSend!: (id: string) => void;
        oldBot.send.mockImplementationOnce(() => new Promise<string>(resolve => { finishSend = resolve; }));
        const sending = m2.sendMessage('private text');
        const pending = old.onMessage({ channelId: 'c', messageId: 'm', text: 'request' });
        await vi.waitFor(() => expect(release).toBeDefined());
        expect(finishSend).toBeDefined();
        await m2.connect();
        const current = vi.mocked(TeamsBot).mock.lastCall![0];
        old.onPoll?.('failure');
        old.onInbound?.('observed');
        old.onStatusChange?.('error');
        await old.onMessage({ channelId: 'c', messageId: 'm', text: 'late' });
        release();
        await pending;
        finishSend('private-id');
        await sending;
        current.onPoll?.('success');
        expect(m2.getStatus().status).toBe('connected');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({ pollSuccessCount: 1, pollDegraded: false, events: [] });
        expect(m2.getAttemptHistory()?.[1].events).toEqual([]);
    });

    it('records safe categories for early and authentication failures without storing their details', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir, getObservabilityEnabled: () => true });
        m2.setMessageHandler(async () => {});
        await m2.updateConfig({ enabled: true });
        await expect(m2.connect()).rejects.toThrow('Configure a global HTTP');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({
            result: 'failed', failureCategory: 'configuration', phases: [{ stage: 'started' }],
        });
        await m2.configureServer('https://example.test/teams');
        vi.mocked(acquireMcpOAuthToken).mockRejectedValueOnce(new Error('secret-token /private/path'));
        await expect(m2.connect()).rejects.toThrow('secret-token');
        expect(m2.getStatus().status).toBe('error');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({
            result: 'failed', failureCategory: 'authentication',
            phases: [{ stage: 'started' }, { stage: 'authenticating' }],
        });
        expect(fs.readFileSync(path.join(tmpDir, 'teams-attempts.json'), 'utf8'))
            .not.toMatch(/secret-token|private\/path|example\.test/);
    });

    it('does not create attempt history while the flag is off', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        await m2.connect();
        await m2.disconnect();
        expect(m2.getAttemptHistory()).toBeNull();
        expect(fs.existsSync(path.join(tmpDir, 'teams-attempts.json'))).toBe(false);
    });

    it('closes an OAuth-pending attempt on disable without reopening it after cancellation', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir, getObservabilityEnabled: () => true });
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
        expect(m2.getAttemptHistory()).toMatchObject([{ result: 'disconnected' }]);
    });

    it('supersedes a pending connection without attaching its late result to the new attempt', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir, getObservabilityEnabled: () => true });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        let release!: (token: string) => void;
        vi.mocked(acquireMcpOAuthToken).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const pending = m2.connect();
        await vi.waitFor(() => expect(release).toBeDefined());
        await m2.connect();
        release('unused-token');
        await expect(pending).rejects.toThrow('cancelled');
        expect(m2.getStatus().status).toBe('connected');
        expect(m2.getAttemptHistory()?.map(a => a.result)).toEqual([undefined, 'superseded']);
        expect(m2.getAttemptHistory()?.[0].phases.slice(-1)[0]?.stage).toBe('connected');
        expect(m2.getAttemptHistory()?.[1].phases.map(p => p.stage)).toEqual(['started', 'authenticating']);
    });

    it('classifies resolution and bot startup failures without persisting provider details', async () => {
        const homeDir = path.join(tmpDir, 'home');
        const m2 = new TeamsMessagingManager(tmpDir, { homeDir, getObservabilityEnabled: () => true });
        m2.setMessageHandler(async () => {});
        await m2.configureServer('https://example.test/teams');
        await m2.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
        vi.mocked(McpClient).mockImplementationOnce(function () {
            throw new Error('private URL https://example.test/token');
        });
        await expect(m2.connect()).rejects.toThrow('private URL');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({ result: 'failed', failureCategory: 'resolution' });
        vi.mocked(TeamsBot).mockImplementationOnce(function () {
            throw new Error('private message content');
        });
        await expect(m2.connect()).rejects.toThrow('private message');
        expect(m2.getAttemptHistory()?.[0]).toMatchObject({ result: 'failed', failureCategory: 'polling' });
        expect(fs.readFileSync(path.join(tmpDir, 'teams-attempts.json'), 'utf8'))
            .not.toMatch(/private|example\.test|team-id-resolved/);
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
        expect(fs.readFileSync(configPath, 'utf-8')).toContain('"channelName":"DiskChannel"');
    });

    it('keeps the original channel fallback for an existing partial config without migrating it', async () => {
        const configPath = path.join(tmpDir, 'teams-messaging.json');
        const original = JSON.stringify({ enabled: true, teamId: 'existing-team', channelId: 'existing-channel' });
        fs.writeFileSync(configPath, original);
        const restored = new TeamsMessagingManager(tmpDir);
        expect(restored.getStatus()).toMatchObject({
            enabled: true, channelName: 'Coc-General', teamId: 'existing-team', channelId: 'existing-channel',
        });
        expect(fs.readFileSync(configPath, 'utf-8')).toBe(original);
    });

    it('setMessageHandler registers a callback', () => {
        const handler = vi.fn();
        manager.setMessageHandler(handler);
        // No assertion needed beyond no throw — callback is internal
    });
});

describe('Teams messaging routes (integration)', () => {
    it('exposes explicit 1:1 sends with typed outcomes, no fallback/replay, and strict options', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-direct-api-'));
        const manager = new TeamsMessagingManager(dir, { homeDir: path.join(dir, 'home') });
        const routes: Route[] = [];
        registerTeamsMessagingRoutes(routes, { dataDir: dir, manager });
        manager.setMessageHandler(async () => {});
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
            const post = (suffix: string, body: object) => fetch(base + suffix, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
            });
            const payload = {
                chatId: '19:direct@thread.v2', recipientId: '00000000-0000-0000-0000-000000000003',
                connectionId: 'test-connection', content: 'plain <text>', contentType: 'text',
            };
            expect((await post('/direct-message', payload)).status).toBe(409);
            expect((await post('/server', { url: 'https://example.test/teams' })).status).toBe(200);
            expect((await post('/config', {
                enabled: true, teamName: 'TestTeam', channelName: 'TestChannel',
                ic3Region: 'amer',
            })).status).toBe(200);
            expect((await post('/reconnect', {})).status).toBe(200);
            const status = await (await fetch(base + '/status')).json();
            expect(status.connectionId).toBe('test-connection');
            const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
            for (const patch of [{ mentions: [] }, { replyToId: 'root' }, { contentType: 'markdown' },
                { recipientId: '' }, { connectionId: '' }, { chatId: '' }, { content: ' ' }]) {
                expect((await post('/direct-message', { ...payload, ...patch })).status).toBe(400);
            }
            expect(bot.sendMessage).not.toHaveBeenCalled();
            const response = await post('/direct-message', payload);
            expect(response.status).toBe(201);
            expect(await response.json()).toMatchObject({ outcome: 'accepted', message: { backend: 'ic3', messageId: '123' } });
            expect(bot.sendMessage).toHaveBeenCalledExactlyOnceWith({
                kind: 'chat', chatId: payload.chatId, recipientId: payload.recipientId, connectionId: payload.connectionId,
            }, { content: '<p>CoC \u00b7 plain &lt;text&gt;</p>', contentType: 'html' }, { signal: expect.any(AbortSignal) });
            for (const outcome of ['rejected', 'unknown'] as const) {
                bot.sendMessage.mockRejectedValueOnce(new TeamsOperationError('Safe IC3 error', 'ic3', 'network', outcome));
                const failure = await post('/direct-message', payload);
                expect(failure.status).toBe(outcome === 'unknown' ? 502 : 409);
                expect(await failure.json()).toMatchObject({ outcome, backend: 'ic3', code: 'network' });
            }
            expect(bot.sendMessage).toHaveBeenCalledTimes(3);
            expect(bot.send).not.toHaveBeenCalled();
            let sendSignal: AbortSignal | undefined;
            bot.sendMessage.mockImplementationOnce((_destination: unknown, _body: unknown, context: { signal: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    sendSignal = context.signal;
                    context.signal.addEventListener('abort', () => reject(
                        new TeamsOperationError('Cancelled IC3 write', 'ic3', 'unavailable', 'unknown'),
                    ), { once: true });
                }));
            const cancelled = new AbortController();
            const pending = fetch(base + '/direct-message', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload), signal: cancelled.signal,
            });
            await vi.waitFor(() => expect(sendSignal).toBeInstanceOf(AbortSignal));
            cancelled.abort();
            await expect(pending).rejects.toThrow();
            await vi.waitFor(() => expect(sendSignal?.aborted).toBe(true));
            expect((await post('/config', { enabled: false })).status).toBe(200);
            expect((await post('/direct-message', payload)).status).toBe(409);
            expect(bot.sendMessage).toHaveBeenCalledTimes(4);
        } finally {
            await manager.disconnect();
            await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    it('honors a live relay opt-out for thread polling, admission and terminal delivery without reconnect', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-opt-out-test-'));
        const manager = new TeamsMessagingManager(dir, { homeDir: path.join(dir, 'home') });
        const tasks = new Map<string, QueuedTask>();
        const queue = Object.assign(new EventEmitter(), { getTask: (id: string) => tasks.get(id) });
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'workspace-a', name: 'A', rootPath: dir }]),
            getProcess: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProcessStore;
        let enabled = false;
        const enqueueChat = vi.fn().mockResolvedValue('opt-out-task');
        const enqueueRelayChat = vi.fn(async (workspaceId: string, _text: string, taskId: string) => {
            const receipts = fs.readdirSync(getRepoDataPath(dir, workspaceId, 'teams-answer-relay'));
            expect(receipts).toHaveLength(1);
            tasks.set(taskId, {
                id: taskId, repoId: workspaceId, processId: toQueueProcessId(taskId), status: 'queued',
            } as QueuedTask);
            return taskId;
        });
        try {
            registerTeamsMessagingRoutes([], {
                dataDir: dir, manager, store, relayQueue: queue, enqueueChat, enqueueRelayChat,
                executeFollowUp: vi.fn(), getAnswerRelayEnabled: () => enabled,
            });
            await manager.configureServer('https://example.test/teams');
            await manager.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
            await manager.connect();
            const opts = vi.mocked(TeamsBot).mock.lastCall![0];
            const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
            const root = { channelId: 'channel-id-resolved', messageId: 'disabled-root', text: 'question', senderAadId: 'human' };
            expect(opts.pollChannelReplies?.()).toBe(false);
            await opts.onMessage(root);
            expect(enqueueChat).toHaveBeenCalledOnce();
            expect(enqueueRelayChat).not.toHaveBeenCalled();
            expect(fs.existsSync(getRepoDataPath(dir, 'workspace-a', 'teams-answer-relay'))).toBe(false);

            enabled = true;
            expect(opts.pollChannelReplies?.()).toBe(true);
            await opts.onMessage({ ...root, messageId: 'enabled-root', senderAadId: 'another-human' });
            expect(enqueueRelayChat).toHaveBeenCalledOnce();
            const taskId = enqueueRelayChat.mock.calls[0][2];
            enabled = false;
            expect(opts.pollChannelReplies?.()).toBe(false);
            expect(manager.getStatus().status).toBe('connected');
            bot.send.mockClear();
            await opts.onMessage({ ...root, messageId: 'disabled-reply', replyToMessageId: 'enabled-root' });
            expect(enqueueRelayChat).toHaveBeenCalledOnce();
            expect(enqueueChat).toHaveBeenCalledOnce();
            expect(bot.send.mock.calls[0][1]).toContain('thread follow-ups are unavailable');
            bot.send.mockClear();
            const task = tasks.get(taskId)!;
            task.status = 'completed';
            vi.mocked(store.getProcess).mockResolvedValue({
                id: toQueueProcessId(taskId), type: 'chat', status: 'completed',
                startTime: new Date(), promptPreview: 'question', fullPrompt: 'question',
                metadata: { workspaceId: 'workspace-a' },
                conversationTurns: [
                    { role: 'user', content: 'question', turnIndex: 0, timestamp: new Date(), timeline: [] },
                    { role: 'assistant', content: 'Answer withheld', turnIndex: 1, timestamp: new Date(), timeline: [] },
                ],
            });
            queue.emit('taskCompleted', task);
            await vi.waitFor(() => {
                const folder = getRepoDataPath(dir, 'workspace-a', 'teams-answer-relay');
                const receipt = JSON.parse(fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), 'utf8'));
                expect(receipt.terminalStatus).toBe('completed');
            });
            expect(bot.send).not.toHaveBeenCalled();
            expect(bot.reactToChannelMessage).not.toHaveBeenCalled();
            expect(opts.enableTrouter).toBe(false);
        } finally {
            manager.dispose();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('silently acknowledges thread follow-ups while preserving Likes, replay suppression and final answers', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-replay-test-'));
        const manager = new TeamsMessagingManager(dir, { homeDir: path.join(dir, 'home') });
        const tasks = new Map<string, QueuedTask>();
        const queue = Object.assign(new EventEmitter(), { getTask: (id: string) => tasks.get(id) });
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'global-workspace-00', name: 'A', rootPath: dir }]),
            getProcess: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProcessStore;
        const enqueueFollowUp = vi.fn(async (_ws, _process, _text, _request, _mode, taskId) => taskId);
        const questionRelay = {
            register: vi.fn(),
            tryAnswer: vi.fn().mockResolvedValue(false),
        };
        try {
            registerTeamsMessagingRoutes([], {
                dataDir: dir, manager, store, relayQueue: queue, questionRelay,
                getMessageReactionEnabled: () => true,
                enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
                admitRelayFollowUp: vi.fn().mockResolvedValue({}),
                enqueueRelayChat: async (workspaceId, _text, taskId) => {
                    tasks.set(taskId, {
                        id: taskId, repoId: workspaceId, processId: toQueueProcessId(taskId), status: 'queued',
                        type: 'chat', payload: { kind: 'chat', workspaceId },
                    } as QueuedTask);
                    return taskId;
                },
                enqueuePendingRelayFollowUp: enqueueFollowUp,
            });
            await manager.configureServer('https://example.test/teams');
            await manager.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
            await manager.connect();
            const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
            const opts = vi.mocked(TeamsBot).mock.lastCall![0];
            expect(opts.pollChannelReplies?.()).toBe(true);
            const root = { channelId: 'channel-id-resolved', messageId: 'root', text: 'new request', senderAadId: 'human' };
            await opts.onMessage(root);
            expect(questionRelay.register).toHaveBeenCalledOnce();
            expect(questionRelay.tryAnswer).toHaveBeenCalledWith('teams', expect.objectContaining({
                messageId: 'root', text: 'new request',
            }));
            expect(bot.send).toHaveBeenCalledOnce();
            expect(bot.send.mock.calls[0][1]).toContain('New topic created');
            bot.send.mockClear();
            const historical = {
                ...root, messageId: 'historical', replyToMessageId: 'root', text: 'old follow-up',
                createdDateTime: '2026-01-01T00:00:00Z', initializationReplay: true,
            };
            await opts.onMessage(historical);
            expect(enqueueFollowUp).toHaveBeenCalledOnce();
            expect(bot.reactToChannelMessage.mock.calls.map(([msg]: [typeof root]) => msg.messageId)).toEqual(['root']);
            const folder = getRepoDataPath(dir, 'global-workspace-00', 'teams-answer-relay');
            const receipts = () => fs.readdirSync(folder)
                .map(name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')));
            expect(receipts().find(receipt => receipt.messageId === 'root')).toMatchObject({
                lastReplyAt: '2026-01-01T00:00:00.000Z', lastReplyIds: ['historical'],
            });
            expect(receipts().find(receipt => receipt.messageId === 'historical')).toMatchObject({
                status: 'awaiting', rootId: 'root', workspaceId: 'workspace-a',
            });
            await opts.onMessage(historical);
            expect(enqueueFollowUp).toHaveBeenCalledOnce();
            await opts.onMessage({
                ...historical, messageId: 'fresh', text: 'fresh follow-up',
                createdDateTime: '2026-01-01T00:01:00Z', initializationReplay: false,
            });
            expect(bot.reactToChannelMessage.mock.calls.map(([msg]: [typeof root]) => msg.messageId))
                .toEqual(['root', 'fresh']);
            expect(enqueueFollowUp).toHaveBeenCalledTimes(2);
            expect(receipts().find(receipt => receipt.messageId === 'root')).toMatchObject({
                lastReplyAt: '2026-01-01T00:01:00.000Z', lastReplyIds: ['fresh'],
            });
            const receipt = receipts().find(receipt => receipt.messageId === 'fresh');
            expect(receipt).toMatchObject({ status: 'awaiting', rootId: 'root', workspaceId: 'workspace-a' });
            expect(bot.send).not.toHaveBeenCalled();

            await opts.onMessage({
                ...historical, messageId: 'fresh', initializationReplay: false,
            });
            expect(enqueueFollowUp).toHaveBeenCalledTimes(2);
            expect(bot.reactToChannelMessage).toHaveBeenCalledTimes(2);
            expect(bot.send).not.toHaveBeenCalled();

            vi.mocked(store.getProcess).mockResolvedValue({
                id: receipt.processId, type: 'chat', status: 'completed',
                startTime: new Date('2026-01-01T00:01:00Z'),
                promptPreview: 'fresh follow-up', fullPrompt: 'fresh follow-up',
                metadata: { workspaceId: 'workspace-a' },
                conversationTurns: [
                    { role: 'user', content: 'fresh follow-up', turnIndex: 0, relayRequestId: receipt.requestId,
                        timestamp: new Date('2026-01-01T00:01:00Z'), timeline: [] },
                    { role: 'assistant', content: 'Final follow-up answer', turnIndex: 1,
                        timestamp: new Date('2026-01-01T00:02:00Z'), timeline: [] },
                ],
            });
            const completed = {
                id: receipt.taskId, repoId: 'workspace-a', processId: receipt.processId,
                status: 'completed', payload: { relayRequestId: receipt.requestId },
            } as QueuedTask;
            tasks.set(completed.id, completed);
            queue.emit('taskCompleted', completed);
            await vi.waitFor(() => {
                expect(receipts().find(value => value.messageId === 'fresh').status).toBe('delivered');
            });
            expect(bot.send).toHaveBeenCalledOnce();
            expect(bot.send.mock.calls[0][1]).toContain('Final follow-up answer');
            expect(bot.send.mock.calls[0][2]).toMatchObject({ replyToId: 'root' });
            expect(bot.reactToChannelMessage).toHaveBeenCalledTimes(2);
            questionRelay.tryAnswer.mockResolvedValueOnce(true);
            await opts.onMessage({
                ...root, messageId: 'question-answer', replyToMessageId: 'root', text: 'yes',
            });
            expect(questionRelay.tryAnswer).toHaveBeenLastCalledWith('teams', expect.objectContaining({
                messageId: 'question-answer', replyToId: 'root', text: 'yes',
            }));
            expect(enqueueFollowUp).toHaveBeenCalledTimes(2);
            expect(bot.send).toHaveBeenCalledOnce();
        } finally {
            await manager.disconnect();
            manager.dispose();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('records rejected replies without interrupting command routing or disconnecting', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-reply-test-'));
        try {
            const manager = new TeamsMessagingManager(dir, {
                homeDir: path.join(dir, 'home'), getObservabilityEnabled: () => true,
            });
            registerTeamsMessagingRoutes([], {
                dataDir: dir, manager,
                store: { getWorkspaces: vi.fn().mockResolvedValue([]) } as any,
                enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
            });
            await manager.configureServer('https://example.test/teams');
            await manager.updateConfig({ enabled: true, teamName: 'TestTeam', channelName: 'TestChannel' });
            await manager.connect();
            const bot = vi.mocked(TeamsBot).mock.results.at(-1)!.value;
            bot.send.mockRejectedValueOnce(new Error('private MCP response'));
            const opts = vi.mocked(TeamsBot).mock.lastCall![0];
            await opts.onMessage({ channelId: 'private-channel', messageId: 'private-id', text: '/list agents' });
            expect(manager.getStatus().status).toBe('connected');
            expect(manager.getAttemptHistory()?.[0]).toMatchObject({ sendDegraded: true });
            expect(manager.getAttemptHistory()?.[0].events.map(e => e.type)).toEqual([
                'dispatch-command', 'reply-attempt', 'reply-rejected',
            ]);
            expect(fs.readFileSync(path.join(dir, 'teams-attempts.json'), 'utf8')).not.toMatch(/private|example\.test/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
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
            expect(routes.length).toBe(7);
            expect(routes[0].method).toBe('GET');
            expect(routes[0].pattern).toEqual(/^\/api\/messaging\/teams\/status$/);
            expect(routes[1].pattern).toEqual(/^\/api\/messaging\/teams\/attempts$/);
            expect(routes[2].pattern).toEqual(/^\/api\/messaging\/teams\/attempts\/([^/]+)$/);
            expect(routes[3].method).toBe('POST');
            expect(routes[3].pattern).toEqual(/^\/api\/messaging\/teams\/server$/);
            expect(routes[4].pattern).toEqual(/^\/api\/messaging\/teams\/config$/);
            expect(routes[5].pattern).toEqual(/^\/api\/messaging\/teams\/direct-message$/);
            expect(routes[6].pattern).toEqual(/^\/api\/messaging\/teams\/reconnect$/);
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
            expect((await (await fetch(base + '/status')).json()).channelName).toBe(defaultTeamsChannelName(os.hostname()));
            expect((await post('/server', { url: 'http://example.test/teams' })).status).toBe(400);
            expect((await post('/server', { url: 'https://example.test/teams' })).status).toBe(200);
            expect((await post('/config', { teamName: 'Team', channelName: 'General', enabled: true })).status).toBe(200);
            for (const outboundBackend of ['graph', 'mcp']) {
                expect((await post('/config', { outboundBackend })).status).toBe(200);
                expect((await (await fetch(base + '/status')).json()).outboundBackend).toBe(outboundBackend);
                expect(new TeamsMessagingManager(tmpDir).getStatus().outboundBackend).toBe(outboundBackend);
            }
            for (const enableTrouter of [true, false]) {
                expect((await post('/config', { enableTrouter })).status).toBe(200);
                expect((await (await fetch(base + '/status')).json()).enableTrouter).toBe(enableTrouter);
                expect(new TeamsMessagingManager(tmpDir).getStatus().enableTrouter).toBe(enableTrouter);
            }
            for (const ic3Region of ['amer', 'emea', 'apac', null]) {
                expect((await post('/config', { ic3Region })).status).toBe(200);
                expect((await (await fetch(base + '/status')).json()).ic3Region).toBe(ic3Region);
                expect(new TeamsMessagingManager(tmpDir).getStatus().ic3Region).toBe(ic3Region);
                expect((await post('/config', { botName: 'CoC' })).status).toBe(200);
                expect((await (await fetch(base + '/status')).json()).ic3Region).toBe(ic3Region);
            }
            const before = fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8');
            for (const outboundBackend of ['auto', null, 1, true, {}, []]) {
                expect((await post('/config', { botName: 'Invalid patch', outboundBackend })).status).toBe(400);
                expect(fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8')).toBe(before);
            }
            for (const enableTrouter of ['true', 1, null, {}, []]) {
                expect((await post('/config', { botName: 'Invalid patch', enableTrouter })).status).toBe(400);
                expect(fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8')).toBe(before);
            }
            for (const ic3Region of ['', 'AMER', 'auto', '../amer', 'https://example.test', 1, {}, []]) {
                const response = await post('/config', { botName: 'Invalid patch', ic3Region });
                expect(response.status).toBe(400);
                expect(fs.readFileSync(path.join(tmpDir, 'teams-messaging.json'), 'utf8')).toBe(before);
            }
            expect((await post('/config', { botName: 'CoC' })).status).toBe(200);
            expect((await (await fetch(base + '/status')).json()).ic3Region).toBeNull();
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
