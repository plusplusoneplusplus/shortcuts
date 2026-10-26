import path from 'node:path';
import { getLogger } from '@plusplusoneplusplus/forge';
import type { TeamsIc3Session } from '@plusplusoneplusplus/coc-native';
import type { Ic3DirectMessageOptions, TrouterClient, TrouterMessageUpdate } from '@plusplusoneplusplus/coc-connector/teams';
import { Ic3DirectMessageClient, Ic3ReactionClient } from '@plusplusoneplusplus/coc-connector/teams';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG, mergeConfig } from '../../../src/config';
import { createTeamsReactionRuntime } from '../../../src/server/messaging/teams-reaction-runtime';
import * as dispatcher from '../../../src/server/messaging/teams-reaction-dispatcher';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createDecisionService } from '../../../src/server/decisions/decision-service';
import { sendTeamsReactionResult } from '../../../src/server/messaging/teams-reaction-reply';

const account = {
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
};
const binding = {
    workspaceId: 'workspace-a', workingDirectory: path.resolve('workspace-a'),
    dispatcherSkill: 'dispatcher', dispatcherSkillPath: path.resolve('workspace-a', 'SKILL.md'),
};
const epoch = Date.parse('2026-01-01T00:00:00Z');
type Notifications = ConstructorParameters<typeof TrouterClient>[0];

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

describe('Teams reaction notification lifecycle', () => {
    let config: ReturnType<typeof mergeConfig>;
    let change: () => void;
    let regionChanged: () => void;
    let region: 'amer' | 'emea' | 'apac' | null;
    let runtime: ReturnType<typeof createTeamsReactionRuntime>;
    let readers: ReturnType<typeof makeReader>[];
    let notifications: { options: Notifications; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[];
    let writers: { options: Ic3DirectMessageOptions; acknowledgeSourceMessage: ReturnType<typeof vi.fn>;
        dispose: ReturnType<typeof vi.fn> }[];
    let resolveDispatcher: ReturnType<typeof vi.spyOn<typeof dispatcher, 'resolveTeamsReactionDispatcher'>>;
    let decisionService: ReturnType<typeof createDecisionService> | undefined;
    const store = createMockProcessStore();
    const unsubscribe = vi.fn();
    const unsubscribeRegion = vi.fn();
    const onResult = vi.fn<Parameters<typeof createTeamsReactionRuntime>[0]['onResult']>();
    const run = vi.fn<Parameters<typeof createTeamsReactionRuntime>[0]['execution']['run']>();
    const createSession = vi.fn((_region: 'amer' | 'emea' | 'apac') => {
        const reader = makeReader();
        readers.push(reader);
        return reader;
    });
    const createTrouter = vi.fn((options: Notifications) => {
        const notification = {
            options, start: vi.fn(), stop: vi.fn(async () => {}),
            getStatus: vi.fn(() => ({ state: 'registered' as const, error: null })),
        };
        notifications.push(notification);
        return notification;
    });
    const createReactions = vi.fn((options: Ic3DirectMessageOptions) => {
        const writer = { options, acknowledgeSourceMessage: vi.fn(async () => {}), dispose: vi.fn() };
        writers.push(writer);
        return writer;
    });

    function makeReader() {
        return {
            connect: vi.fn(async (_signal: AbortSignal) => ({ ...account })),
            readHistory: vi.fn<TeamsIc3Session['readHistory']>(async chatId => ({
                items: [{
                    chatId, messageId: 'target', createdAt: new Date(epoch - 1000).toISOString(),
                    modifiedAt: new Date(epoch - 1000).toISOString(), authorKind: 'user',
                    authorId: 'another-user', text: 'Please review this task.',
                    textTruncated: false, htmlTruncated: false, deleted: false,
                }],
                rawCount: 1,
            })),
            dispose: vi.fn(),
        };
    }
    function start() {
        runtime = createTeamsReactionRuntime({
            config: { get config() { return config; }, onChange: listener => {
                change = () => listener(config, 1);
                return unsubscribe;
            } },
            teams: { getIc3Region: () => region, onIc3RegionChange: listener => {
                regionChanged = listener;
                return unsubscribeRegion;
            } },
            store, dataDir: path.resolve('data'), execution: { run }, onResult,
            createSession, createTrouter, createReactions, decisionService,
        });
    }
    async function flush() { await vi.advanceTimersByTimeAsync(0); }
    async function registered() {
        start();
        await flush();
        const notification = notifications[0].options;
        notification.onState?.('registered');
        vi.setSystemTime(epoch + 1000);
        return notification;
    }
    function update(chatId = '48:notes', time = Date.now()): TrouterMessageUpdate {
        return { conversationId: chatId, messageId: 'target', eventTime: time,
            emotions: [{ key: 'smilerobot', users: [{ mri: `8:orgid:${account.userId}`, time }] }] };
    }
    function emit(notification: Notifications, event = update()) {
        notification.onMessageUpdate?.(event);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(epoch);
        vi.clearAllMocks();
        readers = [];
        notifications = [];
        decisionService = undefined;
        writers = [];
        createSession.mockReset().mockImplementation(() => {
            const reader = makeReader();
            readers.push(reader);
            return reader;
        });
        config = mergeConfig(DEFAULT_CONFIG, {
            features: { teamsReactionDelegation: true },
            teamsReactionDelegation: { workspaceId: binding.workspaceId, dispatcherSkill: binding.dispatcherSkill },
        });
        region = 'amer';
        resolveDispatcher = vi.spyOn(dispatcher, 'resolveTeamsReactionDispatcher').mockResolvedValue({ ...binding });
        onResult.mockReset().mockResolvedValue(undefined);
        run.mockReset().mockImplementation(async (_source, requestId) => ({
            workspaceId: binding.workspaceId, processId: `queue_${requestId}`, status: 'completed',
        }));
        vi.spyOn(getLogger(), 'warn').mockImplementation(() => {});
        vi.spyOn(getLogger(), 'debug').mockImplementation(() => {});
        vi.spyOn(getLogger(), 'info').mockImplementation(() => {});
    });
    afterEach(async () => {
        await runtime?.dispose();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it.each([false, undefined])('has no native or policy activity when enablement is %s', async enabled => {
        config = { ...config, features: { teamsReactionDelegation: enabled } };
        start();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(resolveDispatcher).not.toHaveBeenCalled();
        expect(createSession).not.toHaveBeenCalled();
        expect(createTrouter).not.toHaveBeenCalled();
        expect(createReactions).not.toHaveBeenCalled();
        expect(runtime.getStatus()).toEqual({ state: 'disabled', trouter: { state: 'disabled', error: null } });
    });

    it.each(['allow', 'block', 'malformed', 'unavailable', 'disabled', 'done'] as const)(
        'production reaction %s uses original context and the shared delivery gate', async outcome => {
            const sdk = createMockSDKService().service;
            vi.spyOn(sdk, 'isTransformAvailable').mockResolvedValue({ available: true });
            const transform = vi.spyOn(sdk, 'transform').mockResolvedValue({
                success: true, text: outcome === 'malformed' ? 'not JSON' : JSON.stringify({ answers: {
                    compliance: { type: 'choice', probabilities: {
                        block: outcome === 'allow' ? 0 : 1, allow: outcome === 'allow' ? 1 : 0,
                    } },
                } }),
            });
            if (outcome !== 'unavailable') decisionService = createDecisionService(sdk);
            const evaluate = decisionService && vi.spyOn(decisionService, 'evaluate');
            const send = vi.spyOn(Ic3DirectMessageClient.prototype, 'sendToSourceChat').mockResolvedValue('sent');
            const react = vi.spyOn(Ic3ReactionClient.prototype, 'reactToSourceMessage').mockResolvedValue(undefined);
            const finished = deferred<Awaited<ReturnType<typeof run>>>();
            run.mockReturnValue(finished.promise);
            onResult.mockImplementation(async (job, source, signal) => {
                await sendTeamsReactionResult(source, { sourceText: job.sourceText,
                    result: { kind: 'task', outcome: outcome === 'done' ? 'done' : 'rejected' } }, signal);
            });
            const notification = await registered();
            readers[0].readHistory.mockResolvedValue({
                items: [{
                    chatId: '48:notes', messageId: 'target', createdAt: new Date(epoch - 1000).toISOString(),
                    modifiedAt: new Date(epoch - 1000).toISOString(), authorKind: 'user',
                    authorId: 'another-user', text: 'Complete original request '.repeat(20),
                    untrustedHtml: '<p>Original request</p>', textTruncated: false, htmlTruncated: false, deleted: false,
                }, {
                    chatId: '48:notes', messageId: 'earlier', createdAt: new Date(epoch - 2000).toISOString(),
                    modifiedAt: new Date(epoch - 2000).toISOString(), authorKind: 'user',
                    text: 'Unrelated prior history', textTruncated: false, htmlTruncated: false, deleted: false,
                }], rawCount: 2,
            });
            emit(notification);
            await flush();
            expect(run).toHaveBeenCalledOnce();
            if (outcome !== 'disabled') {
                config = mergeConfig(config, { features: { teamsOutboundCompliance: true },
                    teamsOutboundCompliance: { prompt: 'Permit safe text.' } });
                change();
            }
            expect(readers[0].dispose).not.toHaveBeenCalled();
            finished.resolve({ workspaceId: binding.workspaceId,
                processId: `queue_${run.mock.calls[0][1]}`, status: 'completed' });
            await flush();
            const permitsText = outcome === 'allow' || outcome === 'disabled';
            expect(send).toHaveBeenCalledTimes(permitsText ? 1 : 0);
            expect(transform).toHaveBeenCalledTimes(['allow', 'block', 'malformed'].includes(outcome) ? 1 : 0);
            if (outcome === 'allow' || outcome === 'block') {
                expect(evaluate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
                    backend: 'copilot',
                    state: expect.objectContaining({
                        trigger: { type: 'reaction', messageId: 'target',
                            text: 'Complete original request '.repeat(20), untrustedHtml: '<p>Original request</p>' },
                        destination: { ...account, chatId: '48:notes', region: 'amer' },
                    }),
                }), expect.objectContaining({
                    workspaceId: binding.workspaceId, workingDirectory: binding.workingDirectory, allowOutputRepair: false,
                }));
                expect(JSON.stringify(vi.mocked(decisionService!.evaluate).mock.calls)).not.toContain('Unrelated prior history');
            }
            expect(react).toHaveBeenCalledTimes(permitsText || outcome === 'done' ? 1 : 0);
            emit(notification);
            await flush();
            expect(onResult).toHaveBeenCalledOnce();
        },
    );

    it('refuses delivery when the execution workspace differs from the captured dispatcher binding', async () => {
        run.mockResolvedValue({ workspaceId: 'foreign-workspace', processId: 'queue_foreign', status: 'completed' });
        const notification = await registered();
        emit(notification);
        await flush();
        expect(onResult).not.toHaveBeenCalled();
        expect(runtime.getStatus()).toMatchObject({ state: 'degraded', error: 'pickup' });
    });

    it('requires an explicit IC3 region before reading policy or credentials', async () => {
        region = null;
        start();
        await flush();
        expect(runtime.getStatus()).toMatchObject({ state: 'error', error: 'configuration' });
        expect(resolveDispatcher).not.toHaveBeenCalled();
        expect(createSession).not.toHaveBeenCalled();
        expect(getLogger().warn).toHaveBeenCalledOnce();
    });

    it('reports missing policy without unrestricted execution or native fallback', async () => {
        resolveDispatcher.mockRejectedValue(new Error('Private policy detail.'));
        start();
        await flush();
        expect(createSession).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
        expect(runtime.getStatus()).toMatchObject({ error: 'configuration' });
        expect(JSON.stringify(vi.mocked(getLogger().warn).mock.calls)).not.toContain('Private policy detail');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(resolveDispatcher).toHaveBeenCalledTimes(2);
    });

    it('starts a separate account-pinned listener without scanning any chat', async () => {
        start();
        await flush();
        const options = notifications[0].options;
        expect(options.expectedAccount).toEqual({ tenantId: account.tenantId, objectId: account.userId });
        expect(createSession).toHaveBeenCalledExactlyOnceWith('amer');
        expect(notifications[0].start).toHaveBeenCalledOnce();
        expect(readers[0].readHistory).not.toHaveBeenCalled();
        expect(createReactions).not.toHaveBeenCalled();
        const target = options.target()!;
        expect(['48:notes', '19:direct@thread.v2', '19:group@unq.gbl.spaces'].map(target)).toEqual([true, true, true]);
        expect(['48:notifications', '19:channel@thread.tacv2', 'invalid'].map(target)).toEqual([false, false, false]);
        options.onWake({ cause: 'message', conversationId: '48:notes' });
        options.onWake({ cause: 'message-loss' });
        emit(options);
        await flush();
        expect(readers[0].readHistory).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
    });

    it.each(['48:notes', '19:direct@thread.v2', '19:group@unq.gbl.spaces'])(
        'routes live foreign-authored %s targets through real normalization and pickup', async chatId => {
            const notification = await registered();
            emit(notification, update(chatId));
            await flush();
            expect(readers[0].readHistory).toHaveBeenCalledExactlyOnceWith(chatId, {
                cursor: undefined, signal: expect.any(AbortSignal),
            });
            expect(writers[0].options).toMatchObject({
                region: 'amer', expectedAccount: { tenantId: account.tenantId, objectId: account.userId },
            });
            expect(writers[0].acknowledgeSourceMessage).toHaveBeenCalledExactlyOnceWith(
                chatId, 'target', expect.any(AbortSignal),
            );
            expect(run).toHaveBeenCalledOnce();
            expect(JSON.parse(run.mock.calls[0][2]).target.authorId).toBe('another-user');
            expect(onResult).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ admitted: true, conversationId: chatId, messageId: 'target',
                    workspaceId: binding.workspaceId, status: 'completed' }),
                expect.objectContaining({ account, chatId, messageId: 'target', region: 'amer' }),
                expect.any(AbortSignal),
            );
            expect(writers[0].acknowledgeSourceMessage.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
            await onResult.mock.calls[0][1].verifyAccess(new AbortController().signal);
            expect(readers[0].readHistory).toHaveBeenLastCalledWith(chatId, { signal: expect.any(AbortSignal) });
        },
    );

    it.each([
        { eventTime: undefined },
        { emotions: [] },
        { eventTime: epoch },
        { eventTime: epoch + 10_000 },
        { conversationId: '19:channel@thread.tacv2' },
        { emotions: [{ key: 'smilerobot', users: [{ mri: '8:orgid:cccccccc-cccc-cccc-cccc-cccccccccccc', time: epoch + 1000 }] }] },
    ])('never reads, writes or launches rejected native evidence %j', async patch => {
        const notification = await registered();
        emit(notification, { ...update(), ...patch });
        await flush();
        expect(readers[0].readHistory).not.toHaveBeenCalled();
        expect(writers[0].acknowledgeSourceMessage).not.toHaveBeenCalled();
        expect(run).not.toHaveBeenCalled();
        expect(onResult).not.toHaveBeenCalled();
    });

    it('consumes duplicates before asynchronous policy work, but accepts removal and live re-add', async () => {
        const notification = await registered();
        const event = update();
        for (let i = 0; i < 10; i++) emit(notification, event);
        await flush();
        expect(run).toHaveBeenCalledOnce();
        vi.setSystemTime(epoch + 2000);
        emit(notification, { ...update(), emotions: [] });
        vi.setSystemTime(epoch + 3000);
        emit(notification);
        await flush();
        expect(run).toHaveBeenCalledTimes(2);
        expect(run.mock.calls[0][1]).not.toEqual(run.mock.calls[1][1]);
        expect(onResult).toHaveBeenCalledTimes(2);
    });

    it('uses registration time, not connection start, as the live cutoff', async () => {
        start();
        await flush();
        vi.setSystemTime(epoch + 2000);
        const notification = notifications[0].options;
        notification.onState?.('registered');
        emit(notification, update('48:notes', epoch + 1000));
        emit(notification);
        await flush();
        expect(run).not.toHaveBeenCalled();
        vi.setSystemTime(epoch + 2001);
        emit(notification);
        await flush();
        expect(run).toHaveBeenCalledOnce();
    });

    it.each(['retrying', 'connecting', 'stopped'] as const)(
        'revokes pickup on %s and rejects catch-up after re-registration', async state => {
            const notification = await registered();
            notification.onState?.(state);
            emit(notification);
            await flush();
            expect(writers[0].dispose).toHaveBeenCalledOnce();
            expect(run).not.toHaveBeenCalled();
            vi.setSystemTime(epoch + 2000);
            notification.onState?.('registered');
            emit(notification, update('48:notes', epoch + 1000));
            await flush();
            expect(run).not.toHaveBeenCalled();
            vi.setSystemTime(epoch + 2001);
            emit(notification);
            await flush();
            expect(writers).toHaveLength(2);
            expect(run).toHaveBeenCalledOnce();
        },
    );

    it.each(['message-loss', 'overflow'] as const)('establishes a new cutoff on %s without scanning', async cause => {
        const notification = await registered();
        const old = update();
        vi.setSystemTime(epoch + 2000);
        notification.onWake({ cause });
        emit(notification, old);
        await flush();
        expect(writers[0].dispose).toHaveBeenCalledOnce();
        expect(readers[0].readHistory).not.toHaveBeenCalled();
        vi.setSystemTime(epoch + 2001);
        emit(notification);
        await flush();
        expect(run).toHaveBeenCalledOnce();
    });

    it('does not resume after disconnect until a registered state arrives', async () => {
        const notification = await registered();
        notification.onWake({ cause: 'disconnect' });
        emit(notification);
        await flush();
        expect(run).not.toHaveBeenCalled();
        expect(writers).toHaveLength(1);
        expect(runtime.getStatus().state).toBe('connecting');
    });

    it.each(['workspace', 'dispatcher', 'skills', 'region', 'disabled'] as const)(
        'revokes old callbacks and native resources on %s changes, retaining the shared coordinator', async changeKind => {
            const notification = await registered();
            if (changeKind === 'workspace') config.teamsReactionDelegation.workspaceId = 'workspace-b';
            if (changeKind === 'dispatcher') config.teamsReactionDelegation.dispatcherSkill = 'dispatcher-b';
            if (changeKind === 'skills') config.skills = { ...config.skills, globalExtraFolders: [path.resolve('extra-skills')] };
            if (changeKind === 'region') region = 'emea';
            if (changeKind === 'disabled') config.features.teamsReactionDelegation = false;
            if (changeKind === 'region') regionChanged(); else change();
            await flush();
            expect(readers[0].dispose).toHaveBeenCalledOnce();
            expect(writers[0].dispose).toHaveBeenCalledOnce();
            expect(notifications[0].stop).toHaveBeenCalledOnce();
            expect(notification.target()).toBeNull();
            notification.onState?.('registered');
            emit(notification);
            await flush();
            expect(run).not.toHaveBeenCalled();
            if (changeKind !== 'disabled') {
                notifications[1].options.onState?.('registered');
                vi.setSystemTime(epoch + 2000);
                emit(notifications[1].options);
                await flush();
                expect(run).toHaveBeenCalledOnce();
            } else expect(createSession).toHaveBeenCalledOnce();
        },
    );

    it('ignores unrelated configuration changes', async () => {
        await registered();
        config.features.teamsIc3OwnCommands = !config.features.teamsIc3OwnCommands;
        change();
        await flush();
        expect(createSession).toHaveBeenCalledOnce();
        expect(writers[0].dispose).not.toHaveBeenCalled();
    });

    it('discards late account connection after configuration change without blocking the new connection', async () => {
        const waiting = deferred<typeof account>();
        const old = makeReader();
        old.connect.mockReturnValue(waiting.promise);
        createSession.mockReturnValueOnce(old);
        start();
        await flush();
        region = 'emea';
        regionChanged();
        await flush();
        expect(createTrouter).toHaveBeenCalledOnce();
        expect(old.dispose).toHaveBeenCalledOnce();
        waiting.resolve(account);
        await flush();
        expect(createTrouter).toHaveBeenCalledOnce();
        expect(createSession).toHaveBeenLastCalledWith('emea');
    });

    it('reconnects native credentials after an account error without notification replay', async () => {
        const notification = await registered();
        notification.onError?.({ code: 'credentials', message: 'Private detail.' });
        expect(notification.target()).toBeNull();
        expect(runtime.getStatus()).toMatchObject({ state: 'degraded', error: 'notification' });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(createSession).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        expect(createSession).toHaveBeenCalledTimes(2);
        expect(readers[0].dispose).toHaveBeenCalledOnce();
        expect(run).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(getLogger().warn).mock.calls)).not.toContain('Private detail');
    });

    it('retries failed native connects with bounded cadence and no history scans', async () => {
        const reader = makeReader();
        reader.connect.mockRejectedValue(new Error('Credential unavailable.'));
        createSession.mockReturnValueOnce(reader);
        start();
        await flush();
        expect(runtime.getStatus()).toMatchObject({ state: 'error', error: 'connection' });
        expect(reader.dispose).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(createSession).toHaveBeenCalledTimes(2);
        expect(createTrouter).toHaveBeenCalledOnce();
        expect(reader.readHistory).not.toHaveBeenCalled();
    });

    it('revokes a pending context read on registration loss, even if native read ignores abort', async () => {
        const notification = await registered();
        const waiting = deferred<Awaited<ReturnType<TeamsIc3Session['readHistory']>>>();
        readers[0].readHistory.mockReturnValueOnce(waiting.promise);
        emit(notification);
        await flush();
        const readSignal = readers[0].readHistory.mock.calls[0][1]!.signal!;
        notification.onState?.('retrying');
        expect(readSignal.aborted).toBe(true);
        waiting.resolve({ items: [], rawCount: 0 });
        await flush();
        expect(run).not.toHaveBeenCalled();
        expect(getLogger().warn).not.toHaveBeenCalled();
    });

    it.each(['retrying', 'disconnect', 'message-loss', 'overflow', 'socket-error'] as const)(
        'delivers the terminal result across notification boundary %s without relaunching', async boundary => {
        const waiting = deferred<Awaited<ReturnType<typeof run>>>();
        run.mockReturnValueOnce(waiting.promise);
        const notification = await registered();
        emit(notification);
        await flush();
        expect(run).toHaveBeenCalledOnce();
        const jobSignal = run.mock.calls[0][3];
        if (boundary === 'retrying') notification.onState?.('retrying');
        else if (boundary === 'socket-error') notification.onError?.({ code: 'socket', message: 'Socket failed.' });
        else notification.onWake({ cause: boundary });
        expect(jobSignal.aborted).toBe(false);
        notification.onState?.('registered');
        waiting.resolve({ workspaceId: binding.workspaceId, processId: 'queue_old', status: 'completed' });
        await flush();
        expect(onResult).toHaveBeenCalledOnce();
        await onResult.mock.calls[0][1].verifyAccess(new AbortController().signal);
        expect(run).toHaveBeenCalledOnce();
        expect(writers[0].acknowledgeSourceMessage).toHaveBeenCalledOnce();
        expect(getLogger().info).toHaveBeenCalledWith(expect.any(String),
            expect.stringContaining('Delivery completed.'));
    });

    it.each(['config', 'shutdown', 'credentials'] as const)(
        'revokes acknowledged result observation on %s changes', async boundary => {
            const waiting = deferred<Awaited<ReturnType<typeof run>>>();
            run.mockReturnValueOnce(waiting.promise);
            const notification = await registered();
            emit(notification);
            await flush();
            const jobSignal = run.mock.calls[0][3];
            let disposal: Promise<void> | undefined;
            if (boundary === 'config') {
                config.features.teamsReactionDelegation = false;
                change();
            } else if (boundary === 'credentials') {
                notification.onError?.({ code: 'credentials', message: 'Credential changed.' });
            } else disposal = runtime.dispose();
            expect(jobSignal.aborted).toBe(true);
            waiting.resolve({ workspaceId: binding.workspaceId, processId: 'queue_old', status: 'completed' });
            await flush();
            await disposal;
            expect(onResult).not.toHaveBeenCalled();
            expect(getLogger().info).toHaveBeenCalledWith(expect.any(String),
                expect.stringContaining('Observer cancelled.'));
        },
    );

    it('delivers while the notification socket is disconnected using a fresh pinned access read', async () => {
        const waiting = deferred<Awaited<ReturnType<typeof run>>>();
        run.mockReturnValueOnce(waiting.promise);
        const notification = await registered();
        emit(notification);
        await flush();
        notification.onWake({ cause: 'disconnect' });
        expect(runtime.getStatus().state).toBe('connecting');
        waiting.resolve({ workspaceId: binding.workspaceId, processId: 'queue_job', status: 'completed' });
        await flush();
        expect(onResult).toHaveBeenCalledOnce();
        await onResult.mock.calls[0][1].verifyAccess(new AbortController().signal);
        expect(readers[0].readHistory).toHaveBeenLastCalledWith('48:notes', { signal: expect.any(AbortSignal) });
    });

    it('does not launch when registration ends during acknowledgment', async () => {
        const notification = await registered();
        const waiting = deferred<void>();
        writers[0].acknowledgeSourceMessage.mockReturnValueOnce(waiting.promise);
        emit(notification);
        await flush();
        notification.onState?.('retrying');
        waiting.resolve();
        await flush();
        expect(run).not.toHaveBeenCalled();
        expect(onResult).not.toHaveBeenCalled();
    });

    it('reports execution failures even after notification registration ends', async () => {
        const waiting = deferred<Awaited<ReturnType<typeof run>>>();
        run.mockReturnValueOnce(waiting.promise);
        const notification = await registered();
        emit(notification);
        await flush();
        notification.onState?.('retrying');
        waiting.reject(new Error('Execution evidence unavailable.'));
        await flush();
        expect(getLogger().warn).toHaveBeenCalledOnce();
        expect(onResult).not.toHaveBeenCalled();
    });

    it('correlates pickup and successful delivery without logging source content or identities', async () => {
        const notification = await registered();
        emit(notification, update('19:private-source@thread.v2'));
        await flush();
        const messages = vi.mocked(getLogger().info).mock.calls.map(([, message]) => message);
        const pickup = messages.find(message => message.includes('Pickup started.'))!;
        const terminal = messages.find(message => message.includes('Job terminal; delivery started.'))!;
        const delivered = messages.find(message => message.includes('Delivery completed.'))!;
        const details = (message: string) => JSON.parse(message.slice(message.indexOf('{')));
        expect(details(pickup).trace).toMatch(/^[0-9a-f]{16}$/);
        expect(details(terminal)).toMatchObject({ trace: details(pickup).trace, status: 'completed' });
        expect(details(delivered)).toMatchObject({ trace: details(pickup).trace });
        expect(messages.join('\n')).not.toContain('private-source');
        expect(messages.join('\n')).not.toContain(account.userId);
        expect(messages.join('\n')).not.toContain('Please review this task');
    });

    it('logs typed delivery errors without private messages or stacks', async () => {
        const notification = await registered();
        onResult.mockRejectedValueOnce(Object.assign(new Error('Private credential and source text'), {
            code: 'ECONNRESET', status: 502,
        }));
        emit(notification);
        await flush();
        const messages = JSON.stringify(vi.mocked(getLogger().warn).mock.calls);
        expect(messages).toContain('ECONNRESET');
        expect(messages).toContain('502');
        expect(messages).toContain('trace');
        expect(messages).not.toContain('Private credential');
    });

    it('records notification error codes and admission rejection reasons', async () => {
        const notification = await registered();
        emit(notification, { ...update(), emotions: [] });
        await flush();
        expect(getLogger().info).toHaveBeenCalledWith(expect.any(String),
            expect.stringContaining('"reason":"absent"'));
        notification.onError?.({ code: 'heartbeat-timeout', message: 'Private transport detail' });
        const messages = JSON.stringify(vi.mocked(getLogger().warn).mock.calls);
        expect(messages).toContain('heartbeat-timeout');
        expect(messages).not.toContain('Private transport detail');
    });

    it.each(['pickup', 'delivery'] as const)('reports %s failures without replaying the addition or exposing details', async stage => {
        const notification = await registered();
        if (stage === 'pickup') writers[0].acknowledgeSourceMessage.mockRejectedValueOnce(new Error('Private detail.'));
        else onResult.mockRejectedValueOnce(new Error('Private detail.'));
        const event = update();
        emit(notification, event);
        await flush();
        expect(runtime.getStatus()).toMatchObject({ state: 'degraded', error: stage });
        expect(getLogger().warn).toHaveBeenCalledOnce();
        emit(notification, event);
        await flush();
        expect(writers[0].acknowledgeSourceMessage).toHaveBeenCalledOnce();
        expect(onResult).toHaveBeenCalledTimes(stage === 'pickup' ? 0 : 1);
        expect(JSON.stringify(vi.mocked(getLogger().warn).mock.calls)).not.toContain('Private detail');
    });

    it('binds result access checks to the original exact chat and account/config lifetime', async () => {
        const notification = await registered();
        emit(notification, update('19:direct@thread.v2'));
        await flush();
        const source = onResult.mock.calls[0][1];
        source.chatId = '19:other@thread.v2';
        await source.verifyAccess(new AbortController().signal);
        expect(readers[0].readHistory).toHaveBeenLastCalledWith('19:direct@thread.v2', { signal: expect.any(AbortSignal) });
        notification.onState?.('retrying');
        await source.verifyAccess(new AbortController().signal);
        expect(readers[0].readHistory).toHaveBeenCalledTimes(3);
        region = 'emea';
        regionChanged();
        await expect(source.verifyAccess(new AbortController().signal)).rejects.toThrow('connection ended');
    });

    it('rejects caller cancellation before access reads and discards late verification', async () => {
        const notification = await registered();
        emit(notification);
        await flush();
        const source = onResult.mock.calls[0][1];
        const controller = new AbortController();
        controller.abort(new Error('Access cancelled.'));
        await expect(source.verifyAccess(controller.signal)).rejects.toThrow('Access cancelled');
        expect(readers[0].readHistory).toHaveBeenCalledOnce();
        const waiting = deferred<Awaited<ReturnType<TeamsIc3Session['readHistory']>>>();
        readers[0].readHistory.mockReturnValueOnce(waiting.promise);
        const live = new AbortController();
        const checking = source.verifyAccess(live.signal);
        const rejected = expect(checking).rejects.toThrow('Access cancelled');
        live.abort(new Error('Access cancelled.'));
        waiting.resolve({ items: [], rawCount: 0 });
        await rejected;
    });

    it('reports registration construction failure and disposes its writer without permitting updates', async () => {
        const reader = makeReader();
        reader.connect.mockResolvedValue({ ...account, userId: 'invalid-account' });
        createSession.mockReturnValueOnce(reader);
        start();
        await flush();
        const notification = notifications[0].options;
        notification.onState?.('registered');
        emit(notification);
        await flush();
        expect(writers[0].dispose).toHaveBeenCalledOnce();
        expect(reader.dispose).toHaveBeenCalledOnce();
        expect(runtime.getStatus()).toMatchObject({ error: 'connection' });
        expect(run).not.toHaveBeenCalled();
    });

    it('reports failed notification shutdown without changing a new connection state', async () => {
        await registered();
        const waiting = deferred<void>();
        notifications[0].stop.mockReturnValueOnce(waiting.promise);
        region = 'emea';
        regionChanged();
        await flush();
        notifications[1].options.onState?.('registered');
        waiting.reject(new Error('Private transport detail.'));
        await flush();
        expect(runtime.getStatus()).toMatchObject({ state: 'connected' });
        expect(getLogger().warn).toHaveBeenCalledExactlyOnceWith(expect.any(String),
            '[Teams reactions] Notification shutdown failed.');
    });

    it('bounds all pending pickups and deliveries before starting additional reads', async () => {
        const waiting = deferred<void>();
        onResult.mockReturnValue(waiting.promise);
        const notification = await registered();
        for (let i = 0; i < 256; i++) {
            vi.setSystemTime(epoch + 1000 + i);
            emit(notification);
            await flush();
        }
        expect(onResult).toHaveBeenCalledTimes(256);
        vi.setSystemTime(epoch + 2000);
        emit(notification);
        await flush();
        expect(run).toHaveBeenCalledTimes(256);
        expect(runtime.getStatus()).toMatchObject({ error: 'capacity' });
        waiting.resolve();
        await flush();
    });

    it('disposes subscriptions and all owned resources exactly once and revokes future callbacks', async () => {
        const notification = await registered();
        await runtime.dispose();
        await runtime.dispose();
        expect(unsubscribe).toHaveBeenCalledOnce();
        expect(unsubscribeRegion).toHaveBeenCalledOnce();
        expect(readers[0].dispose).toHaveBeenCalledOnce();
        expect(writers[0].dispose).toHaveBeenCalledOnce();
        expect(notifications[0].stop).toHaveBeenCalledOnce();
        notification.onState?.('registered');
        notification.onWake({ cause: 'message-loss' });
        emit(notification);
        change();
        regionChanged();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(createSession).toHaveBeenCalledOnce();
        expect(run).not.toHaveBeenCalled();
        expect(runtime.getStatus()).toMatchObject({ state: 'stopped', trouter: { state: 'stopped', error: null } });
    });
});
