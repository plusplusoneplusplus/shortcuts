import path from 'node:path';
import { EventEmitter } from 'node:events';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLogger, toQueueProcessId, type AIProcess, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { NativeTeamsError } from '@plusplusoneplusplus/coc-native';
import { Ic3DirectMessageClient, Ic3ReactionClient, TeamsOperationError, type Ic3DirectMessageOptions, type TrouterClient } from '@plusplusoneplusplus/coc-connector/teams';
import type { TeamsIc3Chat, TeamsIc3Message, TeamsIc3Page } from '@plusplusoneplusplus/coc-native';
import { DEFAULT_CONFIG, mergeConfig, type CLIConfig } from '../../../src/config';
import { createTeamsIc3OwnCommandsRuntime } from '../../../src/server/messaging/teams-ic3-own-commands-runtime';
import type { ScheduleQueueEventBus } from '../../../src/server/schedule/schedule-queue-await';
import type { Route } from '../../../src/server/types';
import { createDecisionService } from '../../../src/server/decisions/decision-service';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { sendTeamsIc3OwnCommandReply } from '../../../src/server/messaging/teams-ic3-own-command-reply';

const account = { tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
const workspaceId = 'workspace-alpha';
const region = 'amer' as const;

describe('basic IC3 own-command launcher', () => {
    let config: ReturnType<typeof mergeConfig>;
    let change: () => void;
    let sharedRegion: 'amer' | 'emea' | 'apac' | null;
    let regionChanged: () => void;
    const unsubscribeRegion = vi.fn();
    let service: ReturnType<typeof createTeamsIc3OwnCommandsRuntime>;
    let histories: Map<string, TeamsIc3Message[]>;
    let routes: Route[];
    let decisionService: ReturnType<typeof createDecisionService> | undefined;
    const launch = vi.fn<(...args: [string, string, string, AbortSignal, string]) => Promise<void>>();
    const reader = {
        connect: vi.fn(async () => account),
        readChats: vi.fn(async (): Promise<TeamsIc3Page<TeamsIc3Chat>> => ({ items: [
            { chatId: 'direct', kind: 'oneOnOne' }, { chatId: 'group', kind: 'group' },
            { chatId: 'channel', kind: 'channel' },
        ], rawCount: 3 })),
        readHistory: vi.fn(async (chatId: string) => ({ items: histories.get(chatId) ?? [], rawCount: 0 })),
        dispose: vi.fn(),
    };
    const createSession = vi.fn(() => reader);
    const notification = { start: vi.fn(), stop: vi.fn(async () => {}),
        getStatus: vi.fn(() => ({ state: 'registered' as const, error: null })) };
    const createTrouter = vi.fn((_options: ConstructorParameters<typeof TrouterClient>[0]) => notification);
    const reactions = {
        acknowledgeSourceMessage: vi.fn<(...args: [string, string, AbortSignal?]) => Promise<void>>(),
        dispose: vi.fn(),
    };
    const createReactions = vi.fn((_options: Ic3DirectMessageOptions) => reactions);
    const events = new EventEmitter();
    const queue: ScheduleQueueEventBus = {
        on: (event, listener) => { events.on(event, listener); },
        off: (event, listener) => { events.off(event, listener); },
        getTask: vi.fn(),
    };
    const sendReply = vi.fn().mockResolvedValue(undefined);
    const store = { getProcess: vi.fn<ProcessStore['getProcess']>(), getWorkspaces: vi.fn(async () => [
        { id: workspaceId, name: 'Alpha', rootPath: path.resolve('alpha') },
        { id: 'workspace-beta', name: 'Beta', rootPath: path.resolve('beta') },
        { id: 'virtual', name: 'Virtual', rootPath: path.resolve('virtual'), virtual: true },
    ]) };

    function message(messageId: string, chatId = 'direct', patch: Partial<TeamsIc3Message> = {}): TeamsIc3Message {
        const createdAt = new Date(Date.now() + 1000).toISOString();
        return {
            messageId, chatId, createdAt, modifiedAt: createdAt, authorKind: 'user',
            authorId: account.userId, text: '@coc explain this', textTruncated: false,
            htmlTruncated: false, deleted: false, ...patch,
        };
    }
    function start() {
        service = createTeamsIc3OwnCommandsRuntime({
            teams: { getIc3Region: () => sharedRegion, onIc3RegionChange: listener => {
                regionChanged = listener;
                return unsubscribeRegion;
            } },
            config: { get config() { return config; }, onChange: listener => {
                change = () => listener(config, 1);
                return vi.fn();
            } },
            store, queue, launch, createSession, createTrouter, createReactions, sendReply, routes, decisionService,
        });
    }
    async function update(patch: CLIConfig) {
        config = mergeConfig(config, patch);
        change();
        await vi.advanceTimersByTimeAsync(0);
    }
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.clearAllMocks();
        vi.mocked(queue.getTask).mockReset();
        store.getProcess.mockReset();
        sendReply.mockReset().mockResolvedValue(undefined);
        reactions.acknowledgeSourceMessage.mockReset().mockResolvedValue(undefined);
        launch.mockResolvedValue(undefined);
        histories = new Map();
        decisionService = undefined;
        routes = [];
        config = mergeConfig(DEFAULT_CONFIG, {
            features: { teamsIc3OwnCommands: true }, teamsIc3OwnCommands: { workspaceId },
        });
        sharedRegion = region;
        vi.spyOn(getLogger(), 'warn').mockImplementation(() => {});
        vi.spyOn(getLogger(), 'info').mockImplementation(() => {});
    });
    afterEach(async () => {
        await service?.dispose();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('does nothing while disabled, including no workspace reads or authentication', async () => {
        config = DEFAULT_CONFIG;
        start();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(createSession).not.toHaveBeenCalled();
        expect(store.getWorkspaces).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
        expect(createTrouter).not.toHaveBeenCalled();
        expect(createReactions).not.toHaveBeenCalled();
        expect(service.getStatus()).toEqual({ state: 'disabled', trouter: { state: 'disabled', error: null } });
    });

    it('treats a partial live config without features as disabled', async () => {
        config = { teamsIc3OwnCommands: { workspaceId } } as typeof config;
        expect(() => start()).not.toThrow();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(createSession).not.toHaveBeenCalled();
        expect(service.getStatus()).toEqual({ state: 'disabled', trouter: { state: 'disabled', error: null } });
    });

    it('requires the shared Teams region before connecting', async () => {
        sharedRegion = null;
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(createSession).not.toHaveBeenCalled();
        expect(service.getStatus().state).toBe('error');
    });

    it('restarts on shared region changes and stops when the region is cleared', async () => {
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(createSession).toHaveBeenLastCalledWith('amer');
        sharedRegion = 'emea';
        regionChanged();
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.dispose).toHaveBeenCalledOnce();
        expect(notification.stop).toHaveBeenCalledOnce();
        expect(createSession).toHaveBeenLastCalledWith('emea');
        sharedRegion = null;
        regionChanged();
        await vi.advanceTimersByTimeAsync(0);
        expect(createSession).toHaveBeenCalledTimes(2);
        expect(service.getStatus().state).toBe('error');
        await service.dispose();
        expect(unsubscribeRegion).toHaveBeenCalledOnce();
    });

    const notifiedChat = '19:fixture@thread.v2';
    async function startNotifications() {
        start();
        await vi.advanceTimersByTimeAsync(0);
        return createTrouter.mock.lastCall![0];
    }

    it('starts notifications by default and pins a separate listener to the native reader account', async () => {
        const listener = await startNotifications();
        expect(listener.expectedAccount).toEqual({ tenantId: account.tenantId, objectId: account.userId });
        const policy = listener.target();
        expect(typeof policy).toBe('function');
        if (typeof policy !== 'function') throw new Error('Expected chat source policy');
        expect(policy('48:notes')).toBe(true);
        expect(policy('19:fixture@unq.gbl.spaces')).toBe(true);
        expect(policy('19:channel@thread.tacv2')).toBe(false);
        expect(policy('48:notifications')).toBe(false);
        expect(notification.start).toHaveBeenCalledOnce();
        expect(service.getStatus().trouter).toEqual({ state: 'registered', error: null });
    });

    it('coalesces notifications and reads only the changed chat without trusting notification content', async () => {
        const listener = await startNotifications();
        const discovery = reader.readChats.mock.calls.length;
        const reads = reader.readHistory.mock.calls.length;
        histories.set(notifiedChat, [message('own', notifiedChat),
            message('foreign', notifiedChat, { authorId: 'another-user' })]);
        for (let i = 0; i < 10; i++) listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory.mock.calls.slice(reads).map(([id]) => id)).toEqual([notifiedChat]);
        expect(reader.readChats).toHaveBeenCalledTimes(discovery);
        expect(launch).toHaveBeenCalledOnce();
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).toHaveBeenCalledOnce();
        expect(reactions.acknowledgeSourceMessage).toHaveBeenCalledOnce();
    });

    it.each(['48:notes', 'direct', 'group'])('acknowledges each new %s mention before initial and follow-up admission', async chatId => {
        histories.set(chatId, [message('first', chatId)]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(createReactions).toHaveBeenCalledExactlyOnceWith({
            region, expectedAccount: { tenantId: account.tenantId, objectId: account.userId },
        });
        expect(reactions.acknowledgeSourceMessage).toHaveBeenNthCalledWith(1, chatId, 'first', expect.any(AbortSignal));
        expect(reactions.acknowledgeSourceMessage.mock.invocationCallOrder[0]).toBeLessThan(launch.mock.invocationCallOrder[0]);
        histories.set(chatId, [message('follow-up', chatId), message('first', chatId)]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(reactions.acknowledgeSourceMessage).toHaveBeenNthCalledWith(2, chatId, 'follow-up', expect.any(AbortSignal));
        expect(reactions.acknowledgeSourceMessage.mock.invocationCallOrder[1]).toBeLessThan(launch.mock.invocationCallOrder[1]);
        expect(launch).toHaveBeenCalledTimes(2);
        expect(launch.mock.calls[0][4]).toBe(launch.mock.calls[1][4]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(reactions.acknowledgeSourceMessage).toHaveBeenCalledTimes(2);
    });

    it('waits for acknowledgement settlement but admits the mention after a safe logged failure', async () => {
        let fail!: () => void;
        reactions.acknowledgeSourceMessage.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
            fail = () => reject(new TeamsOperationError('private payload', 'ic3', 'network', 'unknown'));
        }));
        histories.set('direct', [message('first')]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).not.toHaveBeenCalled();
        fail();
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).toHaveBeenCalledOnce();
        expect(service.getStatus().state).toBe('connected');
        const log = JSON.stringify(vi.mocked(getLogger().warn).mock.calls);
        expect(log).toContain('acknowledgement failed (network/unknown)');
        expect(log).not.toContain('private payload');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(reactions.acknowledgeSourceMessage).toHaveBeenCalledOnce();
        expect(launch).toHaveBeenCalledOnce();
    });

    it('does not acknowledge ignored or historical messages', async () => {
        histories.set('direct', [
            message('old', 'direct', { createdAt: '2025-01-01T00:00:00Z' }),
            message('foreign', 'direct', { authorId: 'foreign-user' }),
            message('plain', 'direct', { text: 'not a mention' }),
            message('edited', 'direct', { modifiedAt: '2026-01-01T00:00:02Z' }),
        ]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(createReactions).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it.each(['shutdown', 'reconfiguration'])('cancels acknowledgement on %s and rejects its late admission', async action => {
        let finish!: () => void;
        reactions.acknowledgeSourceMessage.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        histories.set('48:notes', [message('first', '48:notes')]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        const signal = reactions.acknowledgeSourceMessage.mock.calls[0][2]!;
        let disposal: Promise<void> | undefined;
        if (action === 'shutdown') disposal = service.dispose();
        else {
            histories.clear();
            await update({ teamsIc3OwnCommands: { workspaceId: 'workspace-beta' } });
        }
        expect(signal.aborted).toBe(true);
        expect(reactions.dispose).toHaveBeenCalledOnce();
        finish();
        await disposal;
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).not.toHaveBeenCalled();
    });

    it.each(['19:fixture@thread.v2', '48:notes'])('reads notified %s before continuing a slow fallback sweep', async chatId => {
        let finish!: (page: Awaited<ReturnType<typeof reader.readHistory>>) => void;
        reader.readHistory.mockResolvedValueOnce({ items: [], rawCount: 0 })
            .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const listener = await startNotifications();
        histories.set(chatId, [message('during-sweep', chatId)]);
        listener.onWake({ cause: 'message', conversationId: chatId });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory.mock.calls.map(([id]) => id)).toEqual(['48:notes', 'direct']);
        expect(launch).not.toHaveBeenCalled();
        finish({ items: [], rawCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory.mock.calls.map(([id]) => id)).toEqual(['48:notes', 'direct', chatId, 'group']);
        expect(launch).toHaveBeenCalledOnce();
    });

    it('preserves wakes arriving during a targeted read for a subsequent read', async () => {
        const listener = await startNotifications();
        let finish!: (page: Awaited<ReturnType<typeof reader.readHistory>>) => void;
        reader.readHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        const reads = reader.readHistory.mock.calls.length;
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        finish({ items: [], rawCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory.mock.calls.slice(reads).map(([id]) => id)).toEqual([notifiedChat, notifiedChat]);
    });

    it('honors rate limits for notifications and retains failed hints', async () => {
        const listener = await startNotifications();
        const reads = reader.readHistory.mock.calls.length;
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('RateLimited', 'NotAttempted', 429, 90_000));
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(89_999);
        expect(reader.readHistory).toHaveBeenCalledTimes(reads + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(reader.readHistory.mock.calls.filter(([id]) => id === notifiedChat)).toHaveLength(2);
    });

    it('retries a failed authoritative targeted read without admitting notification data', async () => {
        const listener = await startNotifications();
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('Network'));
        histories.set(notifiedChat, [message('after-recovery', notifiedChat)]);
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(29_999);
        expect(launch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(launch).toHaveBeenCalledOnce();
    });

    it('discards unsupported notification targets without degrading health or blocking eligible wakes', async () => {
        const listener = await startNotifications();
        const unsupported = '19:meeting@thread.v2';
        const reads = reader.readHistory.mock.calls.length;
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('Unsupported'));
        histories.set(notifiedChat, [message('eligible', notifiedChat)]);
        listener.onWake({ cause: 'message', conversationId: unsupported });
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory.mock.calls.slice(reads).map(([id]) => id)).toEqual([unsupported, notifiedChat]);
        expect(launch).toHaveBeenCalledOnce();
        expect(service.getStatus()).toMatchObject({ state: 'connected' });
        expect(service.getStatus().error).toBeUndefined();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(reader.readHistory.mock.calls.slice(reads).map(([id]) => id)).toEqual([unsupported, notifiedChat]);
    });

    it('does not count unsupported notifications as successful reads and retains fallback scans', async () => {
        const listener = await startNotifications();
        const previous = service.getStatus();
        const discovery = reader.readChats.mock.calls.length;
        await vi.advanceTimersByTimeAsync(1000);
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('Unsupported'));
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toEqual(previous);
        expect(launch).not.toHaveBeenCalled();
        expect(getLogger().warn).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(59_000);
        expect(reader.readChats).toHaveBeenCalledTimes(discovery + 1);
        expect(reader.readHistory.mock.calls.filter(([id]) => id === notifiedChat)).toHaveLength(1);
    });

    it.each(['Permission', 'Protocol'] as const)('keeps %s notification failures visible and retryable', async code => {
        const listener = await startNotifications();
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError(code));
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toMatchObject({ state: 'degraded', error: code });
        expect(getLogger().warn).toHaveBeenCalled();
        const reads = reader.readHistory.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30_000);
        expect(reader.readHistory).toHaveBeenCalledTimes(reads + 1);
    });

    it.each(['self notification', 'discovered chat'])('reports Unsupported for a supported %s', async source => {
        const listener = await startNotifications();
        if (source === 'self notification') {
            reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('Unsupported'));
            listener.onWake({ cause: 'message', conversationId: '48:notes' });
            await vi.advanceTimersByTimeAsync(0);
        } else {
            reader.readHistory.mockResolvedValueOnce({ items: [], rawCount: 0 })
                .mockRejectedValueOnce(new NativeTeamsError('Unsupported'));
            await vi.advanceTimersByTimeAsync(60_000);
        }
        expect(service.getStatus()).toMatchObject({ state: 'degraded', error: 'Unsupported' });
        expect(getLogger().warn).toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it('cancels a pending notified read and rejects its late command on shutdown', async () => {
        const listener = await startNotifications();
        let finish!: (page: Awaited<ReturnType<typeof reader.readHistory>>) => void;
        reader.readHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        const disposal = service.dispose();
        finish({ items: [message('late-notification', notifiedChat)], rawCount: 1 });
        await disposal;
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).not.toHaveBeenCalled();
        expect(notification.stop).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reconciles after loss, disconnect and mailbox overflow, with a fallback even during ongoing targeted reads', async () => {
        const listener = await startNotifications();
        let discoveries = reader.readChats.mock.calls.length;
        for (const cause of ['message-loss', 'disconnect'] as const) {
            listener.onWake({ cause });
            await vi.advanceTimersByTimeAsync(0);
            expect(reader.readChats).toHaveBeenCalledTimes(++discoveries);
        }
        for (let i = 0; i < 65; i++) listener.onWake({ cause: 'message', conversationId: `19:chat-${i}@thread.v2` });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readChats).toHaveBeenCalledTimes(++discoveries);
        for (let i = 0; i < 6; i++) {
            await vi.advanceTimersByTimeAsync(10_000);
            listener.onWake({ cause: 'message', conversationId: notifiedChat });
            await vi.advanceTimersByTimeAsync(0);
        }
        expect(reader.readChats.mock.calls.length).toBeGreaterThan(discoveries);
    });

    it('rejects unsafe wakes and stops old listeners on configuration changes and shutdown', async () => {
        const listener = await startNotifications();
        const reads = reader.readHistory.mock.calls.length;
        for (const conversationId of ['48:notifications', '19:channel@thread.tacv2', '../bad', undefined]) {
            listener.onWake({ cause: 'message', conversationId });
        }
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory).toHaveBeenCalledTimes(reads);
        await update({ teamsIc3OwnCommands: { workspaceId: 'workspace-beta' } });
        expect(notification.stop).toHaveBeenCalledOnce();
        const after = reader.readHistory.mock.calls.length;
        listener.onWake({ cause: 'message', conversationId: notifiedChat });
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readHistory).toHaveBeenCalledTimes(after);
        await service.dispose();
        expect(notification.stop).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports connecting until real history reads succeed, then connected with timestamps', async () => {
        start();
        expect(service.getStatus()).toEqual({ state: 'connecting', trouter: { state: 'connecting', error: null } });
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toEqual({
            state: 'connected', lastCheckedAt: '2026-01-01T00:00:00.000Z', lastConnectedAt: '2026-01-01T00:00:00.000Z',
            trouter: { state: 'registered', error: null },
        });
        const snapshot = service.getStatus();
        snapshot.state = 'error';
        expect(service.getStatus().state).toBe('connected');
    });

    it('exposes read-only, uncached status without authentication, bodies or account identity', async () => {
        config = DEFAULT_CONFIG;
        start();
        const req = new IncomingMessage(new Socket());
        const res = new ServerResponse(req);
        const end = vi.spyOn(res, 'end').mockReturnValue(res);
        const route = routes.find(route => route.pattern === '/api/messaging/teams/ic3-own-commands/status')!;
        expect(route.method).toBe('GET');
        await route.handler(req, res);
        expect(res.getHeader('Cache-Control')).toBe('no-store');
        expect(JSON.parse(String(end.mock.calls[0][0]))).toEqual({ state: 'disabled', trouter: { state: 'disabled', error: null } });
        expect(createSession).not.toHaveBeenCalled();
    });

    it('shows sanitized partial read failures and recovers on the next successful poll', async () => {
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('Permission'));
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toMatchObject({ state: 'degraded', error: 'Permission' });
        expect(service.getStatus().lastConnectedAt).toBe('2026-01-01T00:00:00.000Z');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(service.getStatus()).toMatchObject({ state: 'connected' });
        expect(service.getStatus().error).toBeUndefined();
        reader.readHistory.mockRejectedValueOnce(new Error('private token and provider body'));
        await vi.advanceTimersByTimeAsync(60_000);
        expect(service.getStatus()).toMatchObject({ state: 'degraded', error: 'ConfigurationOrConnection',
            lastConnectedAt: '2026-01-01T00:02:00.000Z' });
        expect(JSON.stringify(service.getStatus())).not.toContain('private');
    });

    it('clears a recovered authentication error before slow chat discovery finishes', async () => {
        reader.connect.mockRejectedValueOnce(new NativeTeamsError('Authentication'));
        let finish!: (page: TeamsIc3Page<TeamsIc3Chat>) => void;
        reader.readChats.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toMatchObject({ state: 'error', error: 'Authentication' });
        histories.set('48:notes', [message('self-command', '48:notes')]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(launch).toHaveBeenCalledOnce();
        expect(reader.readChats).toHaveBeenCalledOnce();
        expect(service.getStatus()).toEqual({
            state: 'connected', lastCheckedAt: '2026-01-01T00:01:00.000Z', lastConnectedAt: '2026-01-01T00:01:00.000Z',
            trouter: { state: 'registered', error: null },
        });
        finish({ items: [], rawCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
    });

    it('processes discovered commands and publishes read progress before later pages finish', async () => {
        const next = {};
        let finish!: (page: TeamsIc3Page<TeamsIc3Chat>) => void;
        reader.readChats.mockResolvedValueOnce({
            items: [{ chatId: 'direct', kind: 'oneOnOne' }], rawCount: 1, next,
        }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        reader.readHistory.mockImplementationOnce(async () => {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return { items: [], rawCount: 0 };
        });
        histories.set('direct', [message('command')]);
        start();
        await vi.advanceTimersByTimeAsync(1000);
        expect(launch).toHaveBeenCalledOnce();
        expect(reader.readHistory.mock.calls.map(([id]) => id)).toEqual(['48:notes', 'direct']);
        expect(service.getStatus()).toEqual({
            state: 'connected', lastCheckedAt: '2026-01-01T00:00:01.000Z', lastConnectedAt: '2026-01-01T00:00:01.000Z',
            trouter: { state: 'registered', error: null },
        });
        finish({ items: [], rawCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
    });

    it('publishes partial failures immediately and keeps them visible during later successful reads', async () => {
        let finish!: (page: Awaited<ReturnType<typeof reader.readHistory>>) => void;
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('Authentication'))
            .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toMatchObject({ state: 'degraded', error: 'Authentication',
            lastCheckedAt: '2026-01-01T00:00:00.000Z' });
        finish({ items: [], rawCount: 0 });
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toMatchObject({ state: 'degraded', error: 'Authentication' });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(service.getStatus().state).toBe('connected');
        expect(service.getStatus().error).toBeUndefined();
    });

    it('reports authentication failure without claiming a connected session and clears stale errors on disable', async () => {
        reader.connect.mockRejectedValueOnce(new NativeTeamsError('Authentication'));
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus()).toMatchObject({ state: 'error', error: 'Authentication' });
        await update({ features: { teamsIc3OwnCommands: false } });
        expect(service.getStatus()).toEqual({ state: 'disabled', trouter: { state: 'disabled', error: null } });
        await service.dispose();
        expect(service.getStatus().state).toBe('stopped');
    });

    it('does not misreport a launch or reply failure as a connectivity failure', async () => {
        const id = await launched();
        store.getProcess.mockResolvedValue(result(id));
        sendReply.mockRejectedValueOnce(new Error('Private send failure'));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        expect(service.getStatus().state).toBe('connected');
        launch.mockRejectedValueOnce(new Error('Private queue failure'));
        histories.set('direct', [message('next')]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(service.getStatus().state).toBe('connected');
        expect(service.getStatus().error).toBeUndefined();
    });

    it('uses one conversation per Teams chat and separate request identities for later mentions', async () => {
        for (const chatId of ['48:notes', 'direct', 'group']) histories.set(chatId, [message('one', chatId)]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).toHaveBeenCalledTimes(3);
        expect(createSession).toHaveBeenCalledWith(region);
        for (const [workspace, id, prompt, signal] of launch.mock.calls) {
            expect(workspace).toBe(workspaceId);
            expect(id).toMatch(/^ic3-command-[a-f0-9]{64}$/);
            expect(prompt).toBe('explain this');
            expect(signal.aborted).toBe(false);
        }
        expect(new Set(launch.mock.calls.map(call => call[1])).size).toBe(3);
        expect(new Set(launch.mock.calls.map(call => call[4])).size).toBe(3);
        const directConversation = launch.mock.calls[1][4];
        await vi.advanceTimersByTimeAsync(30_000);
        expect(launch).toHaveBeenCalledTimes(3);
        expect(reader.readHistory).not.toHaveBeenCalledWith('channel', expect.anything());
        histories.set('direct', [message('two'), message('one')]);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(launch).toHaveBeenCalledTimes(4);
        expect(launch.mock.lastCall![4]).toBe(directConversation);
        expect(launch.mock.lastCall![1]).not.toBe(launch.mock.calls[1][1]);
    });

    it('ignores pre-start messages, foreign users, edits and empty commands', async () => {
        const old = new Date(Date.now() - 1).toISOString();
        histories.set('direct', [
            message('old', 'direct', { createdAt: old, modifiedAt: old }),
            message('foreign', 'direct', { authorId: 'other-user' }),
            message('edit', 'direct', { modifiedAt: new Date(Date.now() + 2000).toISOString() }),
            message('empty', 'direct', { text: '@coc' }),
        ]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).not.toHaveBeenCalled();
    });

    it.each(['region', 'workspace', 'tenant', 'user'])('uses account/workspace identity when %s changes', async field => {
        await launched();
        const original = launch.mock.calls[0][4];
        const nextAccount = {
            tenantId: field === 'tenant' ? 'other-tenant' : account.tenantId,
            userId: field === 'user' ? 'other-user' : account.userId,
        };
        histories.set('direct', [message('second', 'direct', { authorId: nextAccount.userId })]);
        reader.connect.mockResolvedValueOnce(nextAccount);
        if (field === 'workspace') config = mergeConfig(config, { teamsIc3OwnCommands: { workspaceId: 'workspace-beta' } });
        sharedRegion = 'emea';
        regionChanged();
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).toHaveBeenCalledTimes(2);
        expect(launch.mock.lastCall![4] === original).toBe(field === 'region');
    });

    it('reads only the newest 30 messages and never walks older history', async () => {
        histories.set('direct', Array.from({ length: 31 }, (_, index) => message(String(index))));
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(launch).toHaveBeenCalledTimes(30);
        expect(reader.readHistory.mock.calls.filter(([id]) => id === 'direct')).toHaveLength(1);
    });

    it('runs a slow fallback after scan completion without the short polling loop', async () => {
        reader.readChats.mockImplementationOnce(async () => {
            await new Promise(resolve => setTimeout(resolve, 20_000));
            return { items: [], rawCount: 0 };
        });
        start();
        await vi.advanceTimersByTimeAsync(20_000);
        histories.set('48:notes', [message('after-sweep', '48:notes')]);
        await vi.advanceTimersByTimeAsync(59_999);
        expect(launch).not.toHaveBeenCalled();
        expect(reader.readHistory).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(launch).toHaveBeenCalledOnce();
    });

    it('does not continue fallback reads after shutdown cancels slow discovery', async () => {
        let finish!: (page: TeamsIc3Page<TeamsIc3Chat>) => void;
        reader.readChats.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        start();
        await vi.advanceTimersByTimeAsync(30_000);
        const disposal = service.dispose();
        finish({ items: [], rawCount: 0 });
        await disposal;
        expect(reader.readHistory).toHaveBeenCalledOnce();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not replay an uncertain admission and continues other commands', async () => {
        launch.mockRejectedValueOnce(new Error('private provider detail'));
        histories.set('direct', [message('second'), message('first')]);
        start();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(launch).toHaveBeenCalledTimes(2);
        expect(getLogger().warn).toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(getLogger().warn).mock.calls)).not.toContain('private provider detail');
    });

    it.each(['missing', 'virtual'])('does not connect for %s targets or fall back to another workspace', async target => {
        config = mergeConfig(config, { teamsIc3OwnCommands: { workspaceId: target } });
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(createSession).not.toHaveBeenCalled();
        expect(getLogger().warn).toHaveBeenCalled();
    });

    it('follows discovery pages without scanning an ordinary chat twice', async () => {
        const next = {};
        reader.readChats.mockResolvedValueOnce({
            items: [{ chatId: 'direct', kind: 'oneOnOne' }], rawCount: 1, next,
        }).mockResolvedValueOnce({
            items: [{ chatId: 'direct', kind: 'oneOnOne' }, { chatId: 'group', kind: 'group' }], rawCount: 2,
        });
        histories.set('group', [message('first', 'group')]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        expect(reader.readChats).toHaveBeenCalledTimes(2);
        expect(reader.readChats).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: next }));
        expect(reader.readHistory.mock.calls.map(([id]) => id)).toEqual(['48:notes', 'direct', 'group']);
        expect(launch).toHaveBeenCalledOnce();
    });

    it('reconnects after initialization failure', async () => {
        reader.connect.mockRejectedValueOnce(new Error('private auth detail'));
        start();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(reader.connect).toHaveBeenCalledTimes(2);
        expect(reader.readChats).toHaveBeenCalledOnce();
    });

    it('stops the sweep on throttling and honors the native retry delay', async () => {
        reader.readHistory.mockRejectedValueOnce(new NativeTeamsError('RateLimited', 'NotAttempted', 429, 90_000));
        start();
        await vi.advanceTimersByTimeAsync(89_999);
        expect(reader.readHistory).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(reader.readHistory).toHaveBeenCalledTimes(4);
    });

    it('aborts old admission on target changes and keeps unrelated configuration changes inert', async () => {
        histories.set('direct', [message('first')]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        const signal = launch.mock.calls[0][3];
        await update({ teamsIc3OwnCommands: { workspaceId: 'workspace-beta' } });
        expect(signal.aborted).toBe(true);
        histories.set('direct', [message('second')]);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(launch.mock.lastCall?.[0]).toBe('workspace-beta');
        const connects = reader.connect.mock.calls.length;
        await update({ timeout: 99 });
        expect(reader.connect).toHaveBeenCalledTimes(connects);
        await update({ features: { teamsIc3OwnCommands: false } });
        const reads = reader.readHistory.mock.calls.length;
        await vi.advanceTimersByTimeAsync(60_000);
        expect(reader.readHistory).toHaveBeenCalledTimes(reads);
    });

    it('rejects late reads after shutdown and releases timers and session', async () => {
        let finish!: (value: Awaited<ReturnType<typeof reader.readHistory>>) => void;
        reader.readHistory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        start();
        await vi.advanceTimersByTimeAsync(0);
        const disposal = service.dispose();
        finish({ items: [message('late', '48:notes')], rawCount: 1 });
        await disposal;
        expect(launch).not.toHaveBeenCalled();
        expect(reader.dispose).toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    function terminal(id: string, status: QueuedTask['status'] = 'completed'): QueuedTask {
        const conversationId = launch.mock.calls.find(call => call[1] === id)?.[4] ?? id;
        return { id: conversationId, repoId: workspaceId, type: 'chat', priority: 'normal', status,
            createdAt: Date.now(), payload: { mode: 'ask', workspaceId, relayRequestId: id }, config: {} };
    }

    function result(id: string, patch: Partial<AIProcess> = {}): AIProcess {
        const conversationId = terminal(id).id;
        return {
            id: toQueueProcessId(conversationId), type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'explain this', metadata: { workspaceId, queueTaskId: conversationId, mode: 'ask' },
            conversationTurns: [
                { role: 'user', content: 'explain this', relayRequestId: id, timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'The initial answer', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ], ...patch,
        };
    }

    async function launched(chatId = 'direct') {
        histories.set(chatId, [message('command', chatId)]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        return launch.mock.calls[0][1];
    }

    it.each(['answer', 'multipart', 'empty', 'failed', 'cancelled'] as const)(
        'gates production mention %s with the shared service and delivery-time policy', async category => {
            const sdk = createMockSDKService().service;
            vi.spyOn(sdk, 'isTransformAvailable').mockResolvedValue({ available: true });
            const transform = vi.spyOn(sdk, 'transform').mockResolvedValue({
                success: true, text: JSON.stringify({ answers: {
                    compliance: { type: 'choice', probabilities: { block: 0, allow: 1 } },
                } }),
            });
            decisionService = createDecisionService(sdk);
            const evaluate = vi.spyOn(decisionService, 'evaluate');
            const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockResolvedValue('sent');
            sendReply.mockImplementation(sendTeamsIc3OwnCommandReply);
            const original = message('command', '48:notes', { untrustedHtml: '<p>@coc explain this</p>' });
            histories.set('48:notes', [original]);
            start();
            await vi.advanceTimersByTimeAsync(0);
            const id = launch.mock.calls[0][1];
            const proc = result(id);
            proc.conversationTurns![1].content = category === 'empty' ? ''
                : category === 'multipart' ? 'Safe **answer**\n'.repeat(3000) : 'Safe answer';
            store.getProcess.mockResolvedValue(proc);
            // Policy-only saves must not cancel requests admitted while the gate was off.
            await update({ features: { teamsOutboundCompliance: true },
                teamsOutboundCompliance: { prompt: 'Permit safe text.' } });
            expect(reader.dispose).not.toHaveBeenCalled();
            const status = category === 'failed' || category === 'cancelled' ? category : 'completed';
            events.emit(status === 'failed' ? 'taskFailed' : status === 'cancelled' ? 'taskCancelled' : 'taskCompleted',
                terminal(id, status));
            await vi.advanceTimersByTimeAsync(0);
            await expect(sendReply.mock.results[0].value).resolves.toBeUndefined();
            expect(evaluate).toHaveBeenCalledOnce();
            expect(transform).toHaveBeenCalledOnce();
            expect(evaluate.mock.calls[0]).toEqual([
                expect.objectContaining({
                    backend: 'copilot',
                    state: expect.objectContaining({
                        trigger: { type: 'mention', messageId: 'command', text: original.text,
                            untrustedHtml: original.untrustedHtml },
                        chunks: send.mock.calls.map(call => call[1]),
                        destination: { ...account, chatId: '48:notes', region },
                    }),
                    questions: { compliance: expect.objectContaining({
                        instructions: expect.objectContaining({ administratorPolicy: 'Permit safe text.' }),
                    }) },
                }),
                expect.objectContaining({ workspaceId, workingDirectory: path.resolve('alpha'), allowOutputRepair: false }),
            ]);
            if (category === 'multipart') expect(send.mock.calls.length).toBeGreaterThan(1);
            else expect(send).toHaveBeenCalledOnce();
        },
    );

    it.each(['block', 'malformed', 'unavailable', 'disabled'] as const)(
        'production mention %s cannot bypass the server gate or retry a consumed request', async outcome => {
            const sdk = createMockSDKService().service;
            vi.spyOn(sdk, 'isTransformAvailable').mockResolvedValue({ available: true });
            const transform = vi.spyOn(sdk, 'transform').mockResolvedValue({
                success: true, text: outcome === 'malformed' ? 'not JSON' : JSON.stringify({ answers: {
                    compliance: { type: 'choice', probabilities: { block: 1, allow: 0 } },
                } }),
            });
            if (outcome !== 'unavailable') decisionService = createDecisionService(sdk);
            const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockResolvedValue('sent');
            const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage').mockResolvedValue(undefined);
            sendReply.mockImplementation(sendTeamsIc3OwnCommandReply);
            const id = await launched('48:notes');
            store.getProcess.mockResolvedValue(result(id));
            if (outcome !== 'disabled') await update({ features: { teamsOutboundCompliance: true },
                teamsOutboundCompliance: { prompt: 'Block this text.' } });
            events.emit('taskCompleted', terminal(id));
            await vi.advanceTimersByTimeAsync(0);
            expect(sendReply).toHaveBeenCalledOnce();
            if (outcome === 'block') await expect(sendReply.mock.results[0].value)
                .rejects.toMatchObject({ name: 'TeamsOutboundComplianceRejected' });
            if (outcome === 'malformed') await expect(sendReply.mock.results[0].value)
                .rejects.toMatchObject({ code: 'DECISION_INVALID_OUTPUT' });
            events.emit('taskCompleted', terminal(id));
            await vi.advanceTimersByTimeAsync(60_000);
            expect(send).toHaveBeenCalledTimes(outcome === 'disabled' ? 1 : 0);
            expect(transform).toHaveBeenCalledTimes(outcome === 'disabled' || outcome === 'unavailable' ? 0 : 1);
            expect(sendReply).toHaveBeenCalledOnce();
            expect(react).toHaveBeenCalledTimes(outcome === 'block' ? 1 : 0);
            if (outcome === 'block') {
                expect(react).toHaveBeenCalledExactlyOnceWith('48:notes', 'command', 'crossmark', expect.any(AbortSignal));
            }
            expect(vi.mocked(getLogger().info).mock.calls.some(([, text]) =>
                text.includes('"stage":"delivered"'))).toBe(outcome === 'disabled');
        },
    );

    it.each(['48:notes', 'direct', 'group'])('returns the final initial answer to the exact %s source once', async chatId => {
        const id = await launched(chatId);
        const proc = result(id);
        proc.conversationTurns!.push(
            { role: 'user', content: 'Later prompt', timestamp: new Date(), turnIndex: 2, timeline: [] },
            { role: 'assistant', content: 'Private later answer', timestamp: new Date(), turnIndex: 3, timeline: [] },
        );
        store.getProcess.mockResolvedValue(proc);
        events.emit('taskCompleted', terminal(id));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        expect(sendReply).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ account, chatId, region, verifyAccess: expect.any(Function) }),
            id, 'The initial answer', expect.any(AbortSignal));
        const readCount = reader.readHistory.mock.calls.length;
        const source = sendReply.mock.calls[0][0];
        await source.verifyAccess(sendReply.mock.calls[0][3]);
        expect(reader.readHistory).toHaveBeenCalledTimes(readCount + 1);
        expect(reader.readHistory).toHaveBeenLastCalledWith(chatId, expect.objectContaining({ signal: sendReply.mock.calls[0][3] }));
        expect(store.getProcess).toHaveBeenCalledWith(toQueueProcessId(terminal(id).id), workspaceId);
    });

    it('replies with only the matching follow-up answer in the shared conversation', async () => {
        const first = await launched();
        histories.set('direct', [message('second')]);
        await vi.advanceTimersByTimeAsync(60_000);
        const id = launch.mock.lastCall![1];
        const task = { ...terminal(id), id, payload: {
            ...terminal(id).payload, processId: toQueueProcessId(terminal(first).id),
        } };
        const proc = result(first);
        proc.conversationTurns!.push(
            { role: 'user', content: 'Next', relayRequestId: id, timestamp: new Date(), turnIndex: 2, timeline: [] },
            { role: 'assistant', content: 'Follow-up answer', timestamp: new Date(), turnIndex: 3, timeline: [] },
            { role: 'user', content: 'Private prompt', timestamp: new Date(), turnIndex: 4, timeline: [] },
            { role: 'assistant', content: 'Private answer', timestamp: new Date(), turnIndex: 5, timeline: [] },
        );
        store.getProcess.mockResolvedValue(proc);
        events.emit('taskCompleted', task);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendReply).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ chatId: 'direct' }), id, 'Follow-up answer', expect.any(AbortSignal));
    });

    it.each(['delivered', 'failed'])('keeps same-chat reply order without blocking another chat when the first reply is %s', async outcome => {
        histories.set('direct', [message('first')]);
        histories.set('group', [message('other-chat', 'group')]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        const first = launch.mock.calls[0][1];
        const other = launch.mock.calls[1][1];
        histories.set('direct', [message('second')]);
        await vi.advanceTimersByTimeAsync(60_000);
        const second = launch.mock.lastCall![1];
        store.getProcess.mockImplementation(async processId => {
            if (processId === result(other).id) return result(other);
            const proc = result(first);
            proc.conversationTurns!.push(
                { role: 'user', content: 'Next', relayRequestId: second, timestamp: new Date(), turnIndex: 2, timeline: [] },
                { role: 'assistant', content: 'Next answer', timestamp: new Date(), turnIndex: 3, timeline: [] },
            );
            return proc;
        });
        let finish!: () => void;
        sendReply.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
            finish = () => outcome === 'delivered' ? resolve() : reject(new Error('private transport diagnostic'));
        }));
        events.emit('taskCompleted', terminal(first));
        await vi.advanceTimersByTimeAsync(0);
        events.emit('taskCompleted', { ...terminal(second), id: second,
            payload: { ...terminal(second).payload, processId: result(first).id } });
        events.emit('taskCompleted', terminal(other));
        await vi.advanceTimersByTimeAsync(0);
        const startedBeforeFirstSettled = sendReply.mock.calls.map(call => call[1]);
        await vi.advanceTimersByTimeAsync(1000);
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(startedBeforeFirstSettled).toEqual([first, other]);
        expect(sendReply.mock.calls.map(call => call[1])).toEqual([first, other, second]);
        expect(sendReply.mock.lastCall![2]).toBe('Next answer');
        expect(vi.mocked(getLogger().info).mock.calls.some(([, text]) => text.includes('"replyWaitMs":1000'))).toBe(true);
        expect(JSON.stringify(vi.mocked(getLogger().warn).mock.calls)).not.toContain('private transport diagnostic');
    });

    it('logs correlated stage durations without message bodies or source identities', async () => {
        launch.mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 200)); });
        reader.readHistory.mockImplementationOnce(async chatId => {
            await new Promise(resolve => setTimeout(resolve, 300));
            return { items: histories.get(chatId) ?? [], rawCount: 1 };
        });
        histories.set('48:notes', [message('timed', '48:notes', {
            createdAt: new Date(Date.now() + 100).toISOString(),
            modifiedAt: new Date(Date.now() + 100).toISOString(),
        })]);
        start();
        await vi.advanceTimersByTimeAsync(500);
        const id = launch.mock.calls[0][1];
        await vi.advanceTimersByTimeAsync(1000);
        store.getProcess.mockResolvedValue(result(id));
        sendReply.mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
        events.emit('taskCompleted', { ...terminal(id), createdAt: Date.now() - 1000,
            startedAt: Date.now() - 800, completedAt: Date.now() });
        await vi.advanceTimersByTimeAsync(400);
        const logs = vi.mocked(getLogger().info).mock.calls.map(([, text]) => JSON.parse(text.split('timing ')[1]));
        expect(logs).toEqual([
            { requestId: id, stage: 'detected', detectionLagMs: 200, readMs: 300 },
            { requestId: id, stage: 'acknowledged', acknowledgementMs: 0 },
            { requestId: id, stage: 'admitted', admissionMs: 200 },
            { requestId: id, stage: 'completed', sinceDetectionMs: 1200, queueMs: 200, executionMs: 800 },
            { requestId: id, stage: 'reply-start', replyWaitMs: 0 },
            { requestId: id, stage: 'delivered', replyMs: 400, sinceDetectionMs: 1600 },
        ]);
        const output = JSON.stringify(logs);
        for (const privateValue of [account.tenantId, account.userId, '48:notes', 'explain this', 'The initial answer']) {
            expect(output).not.toContain(privateValue);
        }
    });

    it('cancels and drains simultaneous replies in different chats on shutdown', async () => {
        histories.set('direct', [message('first')]);
        histories.set('group', [message('second', 'group')]);
        start();
        await vi.advanceTimersByTimeAsync(0);
        store.getProcess.mockImplementation(async processId => {
            const id = launch.mock.calls.find(call => toQueueProcessId(call[4]) === processId)![1];
            return result(id);
        });
        sendReply.mockImplementation((_source, _id, _text, signal: AbortSignal) =>
            new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
        for (const call of launch.mock.calls) events.emit('taskCompleted', terminal(call[1]));
        await vi.advanceTimersByTimeAsync(0);
        const active = sendReply.mock.calls.length;
        await service.dispose();
        expect(active).toBe(2);
        expect(sendReply.mock.calls.every(call => call[3].aborted)).toBe(true);
        expect(vi.mocked(getLogger().info).mock.calls.some(([, text]) => text.includes('"stage":"delivered"'))).toBe(false);
    });

    it('does not let an aborted reply block the same chat after reconfiguration', async () => {
        const first = await launched('48:notes');
        store.getProcess.mockResolvedValue(result(first));
        let finish!: () => void;
        sendReply.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        events.emit('taskCompleted', terminal(first));
        await vi.advanceTimersByTimeAsync(0);
        histories.clear();
        sharedRegion = 'emea';
        regionChanged();
        await vi.advanceTimersByTimeAsync(0);
        histories.set('48:notes', [message('new-generation', '48:notes')]);
        createTrouter.mock.lastCall![0].onWake({ cause: 'message', conversationId: '48:notes' });
        await vi.advanceTimersByTimeAsync(0);
        const second = launch.mock.lastCall![1];
        store.getProcess.mockResolvedValue(result(second));
        events.emit('taskCompleted', terminal(second));
        await vi.advanceTimersByTimeAsync(0);
        const startedBeforeOldReplySettled = sendReply.mock.calls.map(call => call[1]);
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(startedBeforeOldReplySettled).toEqual([first, second]);
        expect(sendReply.mock.calls[0][3].aborted).toBe(true);
        const deliveries = vi.mocked(getLogger().info).mock.calls.map(([, text]) => JSON.parse(text.split('timing ')[1]))
            .filter(entry => entry.stage === 'delivered');
        expect(deliveries.map(entry => entry.requestId)).toEqual([second]);
    });

    it.each(['missing request turn', 'foreign conversation'])('rejects reply evidence with %s', async mismatch => {
        const id = await launched();
        const proc = result(id);
        const task = terminal(id);
        if (mismatch === 'missing request turn') delete proc.conversationTurns![0].relayRequestId;
        else task.payload.processId = 'queue_unrelated';
        store.getProcess.mockResolvedValue(proc);
        events.emit('taskCompleted', task);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendReply).not.toHaveBeenCalled();
        expect(getLogger().warn).toHaveBeenCalled();
    });

    it.each(['event', 'snapshot'])('handles completion during admission from the queue %s', async evidence => {
        launch.mockImplementationOnce(async (_workspace, id) => {
            store.getProcess.mockResolvedValue(result(id));
            if (evidence === 'event') events.emit('taskCompleted', terminal(id));
            else vi.mocked(queue.getTask).mockReturnValue(terminal(id));
        });
        await launched();
        expect(sendReply).toHaveBeenCalledOnce();
    });

    it.each(['failed', 'cancelled'] as const)('sends a fixed %s notice without task errors or partial output', async status => {
        const id = await launched();
        const task = terminal(id, status);
        task.error = 'Private provider diagnostic';
        task.result = 'Partial confidential result';
        events.emit(status === 'failed' ? 'taskFailed' : 'taskCancelled', task);
        await vi.advanceTimersByTimeAsync(0);
        expect(sendReply).toHaveBeenCalledOnce();
        expect(sendReply.mock.calls[0][2]).toBe(status === 'failed'
            ? 'This request could not be completed.' : 'This request was cancelled.');
    });

    it.each([{ streaming: true }, { interrupted: true }, { historical: true }, { displayOnly: true }])(
        'never forwards an unsettled or non-current answer as success: %j', async patch => {
            const id = await launched();
            const proc = result(id);
            Object.assign(proc.conversationTurns![1], patch);
            store.getProcess.mockResolvedValue(proc);
            events.emit('taskCompleted', terminal(id));
            await vi.advanceTimersByTimeAsync(0);
            expect(sendReply.mock.calls[0][2]).toBe('This request completed without a text answer.');
        },
    );

    it('does not reply for another workspace or unrelated task', async () => {
        const id = await launched();
        store.getProcess.mockResolvedValue(result(id, { metadata: { workspaceId: 'other', queueTaskId: id } }));
        events.emit('taskCompleted', terminal('unrelated'));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        expect(sendReply).not.toHaveBeenCalled();
        expect(getLogger().warn).toHaveBeenCalled();
    });

    it('never retries an uncertain send even if the command leaves and re-enters the recent window', async () => {
        const id = await launched();
        const original = histories.get('direct')!;
        store.getProcess.mockResolvedValue(result(id));
        sendReply.mockRejectedValueOnce(new Error('private send error'));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(60_000);
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        histories.set('direct', []);
        await vi.advanceTimersByTimeAsync(60_000);
        histories.set('direct', original);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(sendReply).toHaveBeenCalledOnce();
        expect(launch).toHaveBeenCalledOnce();
        expect(JSON.stringify(vi.mocked(getLogger().warn).mock.calls)).not.toContain('private send error');
    });

    it('logs the safe reply failure code and delivery outcome without private error details', async () => {
        const id = await launched('48:notes');
        store.getProcess.mockResolvedValue(result(id));
        sendReply.mockRejectedValueOnce(new TeamsOperationError(
            'Private transport diagnostic', 'ic3', 'timeout', 'not-attempted'));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        const log = JSON.stringify(vi.mocked(getLogger().warn).mock.calls);
        expect(log).toContain('timeout/not-attempted');
        expect(log).not.toContain('Private transport diagnostic');
    });

    it('revokes pending result delivery when the target changes', async () => {
        const id = await launched();
        await update({ teamsIc3OwnCommands: { workspaceId: 'workspace-beta' } });
        store.getProcess.mockResolvedValue(result(id));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        expect(sendReply).not.toHaveBeenCalled();
    });

    it('cancels an active reply on shutdown and removes all terminal listeners', async () => {
        const id = await launched();
        store.getProcess.mockResolvedValue(result(id));
        sendReply.mockImplementationOnce((_source, _id, _text, signal: AbortSignal) =>
            new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })));
        events.emit('taskCompleted', terminal(id));
        await vi.advanceTimersByTimeAsync(0);
        await service.dispose();
        expect(sendReply.mock.calls[0][3].aborted).toBe(true);
        for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled']) expect(events.listenerCount(event)).toBe(0);
    });
});
