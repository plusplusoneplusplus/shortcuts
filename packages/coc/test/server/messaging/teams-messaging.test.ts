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
import { acquireMcpOAuthToken, McpClient, TeamsBot } from '@plusplusoneplusplus/coc-connector/teams';
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
            reactToChannelMessage: vi.fn().mockResolvedValue(undefined),
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
            expect.stringMatching(/^AI: <p><strong>Agents \/ Repos<\/strong> \(1\):<\/p><ol><li><strong>Alpha<\/strong> — <code>C:\\repo\\alpha<\/code><\/li><\/ol>$/),
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
        expect(bot.send.mock.lastCall[1]).toMatch(/^AI: <p>❌ Repo/);
        getWorkspaces.mockRejectedValueOnce(new Error('offline'));
        await options.onMessage({ ...inbound, messageId: 'error' });
        expect(bot.send.mock.lastCall[1]).toMatch(/^AI: <p>❌ Error: offline<\/p>$/);
        bot.send.mockRejectedValueOnce(new Error('channel rejected message'));
        await expect(m2.sendMessage('**Retry**', 'user-msg')).rejects.toThrow('channel rejected message');
        expect(bot.send.mock.lastCall[1]).toBe('AI: <p><strong>Retry</strong></p>');

        const parts = formatTeamsAnswerChunks('👩‍💻 <unsafe> & '.repeat(4000), 'opaque-1');
        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) await m2.sendMessage(part, 'user-msg', 'html');
        for (const [index, call] of bot.send.mock.calls.slice(-parts.length).entries()) {
            const html = call[1] as string;
            expect(html).toMatch(new RegExp(`^AI: <p><strong>Request opaque-1 · Part ${index + 1}/${parts.length}</strong></p>`));
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
    it('routes initialization replies without Likes and persists their receipt watermark', async () => {
        const { registerTeamsMessagingRoutes } = await import('../../../src/server/messaging/teams-messaging-handler');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-replay-test-'));
        const manager = new TeamsMessagingManager(dir, { homeDir: path.join(dir, 'home') });
        const tasks = new Map<string, QueuedTask>();
        const queue = Object.assign(new EventEmitter(), { getTask: (id: string) => tasks.get(id) });
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'workspace-a', name: 'A', rootPath: dir }]),
            getProcess: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProcessStore;
        const enqueueFollowUp = vi.fn().mockResolvedValue('follow-up-task');
        try {
            registerTeamsMessagingRoutes([], {
                dataDir: dir, manager, store, relayQueue: queue,
                getAnswerRelayEnabled: () => true, getMessageReactionEnabled: () => true,
                enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
                enqueueRelayChat: async (workspaceId, _text, taskId) => {
                    tasks.set(taskId, {
                        id: taskId, repoId: workspaceId, processId: toQueueProcessId(taskId), status: 'queued',
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
            const root = { channelId: 'channel-id-resolved', messageId: 'root', text: 'new request', senderAadId: 'human' };
            await opts.onMessage(root);
            const historical = {
                ...root, messageId: 'historical', replyToMessageId: 'root', text: 'old follow-up',
                createdDateTime: '2026-01-01T00:00:00Z', initializationReplay: true,
            };
            await opts.onMessage(historical);
            expect(enqueueFollowUp).toHaveBeenCalledOnce();
            expect(bot.reactToChannelMessage.mock.calls.map(([msg]: [typeof root]) => msg.messageId)).toEqual(['root']);
            const folder = getRepoDataPath(dir, 'workspace-a', 'teams-answer-relay');
            const receipts = () => fs.readdirSync(folder)
                .map(name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')));
            expect(receipts().find(receipt => receipt.messageId === 'root')).toMatchObject({
                lastReplyAt: '2026-01-01T00:00:00.000Z', lastReplyIds: ['historical'],
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
            expect(routes.length).toBe(6);
            expect(routes[0].method).toBe('GET');
            expect(routes[0].pattern).toEqual(/^\/api\/messaging\/teams\/status$/);
            expect(routes[1].pattern).toEqual(/^\/api\/messaging\/teams\/attempts$/);
            expect(routes[2].pattern).toEqual(/^\/api\/messaging\/teams\/attempts\/([^/]+)$/);
            expect(routes[3].method).toBe('POST');
            expect(routes[3].pattern).toEqual(/^\/api\/messaging\/teams\/server$/);
            expect(routes[4].pattern).toEqual(/^\/api\/messaging\/teams\/config$/);
            expect(routes[5].pattern).toEqual(/^\/api\/messaging\/teams\/reconnect$/);
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
