import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_TASK_CONFIG, toQueueProcessId, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { TeamsIc3Message, TeamsIc3Session } from '@plusplusoneplusplus/coc-native';
import type { Ic3ReactionClient } from '@plusplusoneplusplus/coc-connector/teams';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CLIConfig } from '../../../src/config';
import { createTeamsReactionPickup } from '../../../src/server/messaging/teams-reaction-pickup';
import { createTeamsReactionExecution } from '../../../src/server/messaging/teams-reaction-execution';
import * as dispatcher from '../../../src/server/messaging/teams-reaction-dispatcher';
import { createMockProcessStore } from '../helpers/mock-process-store';

const owner = {
    tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    userId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
};
const startedAt = Date.parse('2026-01-01T00:00:00Z');
const binding = {
    workspaceId: 'workspace-a', workingDirectory: path.resolve('workspace-a'),
    dispatcherSkill: 'dispatcher', dispatcherSkillPath: path.resolve('workspace-a', '.github', 'skills', 'dispatcher', 'SKILL.md'),
};

describe('Teams reaction session pickup', () => {
    let config: CLIConfig;
    let store: ReturnType<typeof createMockProcessStore>;
    let events: EventEmitter;
    let tasks: Map<string, QueuedTask>;
    let execution: ReturnType<typeof createTeamsReactionExecution>;
    let pickup: ReturnType<typeof createTeamsReactionPickup>;
    let parent: AbortController;
    let account: typeof owner;
    let resolve: ReturnType<typeof vi.spyOn<typeof dispatcher, 'resolveTeamsReactionDispatcher'>>;
    const readHistory = vi.fn<TeamsIc3Session['readHistory']>();
    const acknowledgeSourceMessage = vi.fn<Ic3ReactionClient['acknowledgeSourceMessage']>();
    let reactions: Pick<Ic3ReactionClient, 'acknowledgeSourceMessage'>;
    const launch = vi.fn(async (id: string, _context: string, _signal: AbortSignal) => {
        const task: QueuedTask = {
            id, type: 'chat', repoId: binding.workspaceId, status: 'queued', priority: 'normal',
            createdAt: Date.now(), config: { ...DEFAULT_TASK_CONFIG },
            payload: { kind: 'chat', mode: 'ask', relayRequestId: id },
        };
        tasks.set(id, task);
        return { workspaceId: binding.workspaceId, processId: toQueueProcessId(id) };
    });
    const finish = (id: string, status: 'completed' | 'failed' | 'cancelled' = 'completed') => {
        const task = tasks.get(id)!;
        task.status = status;
        events.emit({ completed: 'taskCompleted', failed: 'taskFailed', cancelled: 'taskCancelled' }[status], task);
    };
    const evidence = (messageId = 'target', time = Date.now(), chatId = '48:notes') => ({
        conversationId: chatId, messageId, eventAt: time,
        robotUsers: [{ mri: `8:orgid:${owner.userId}`, addedAt: time }],
    });
    function message(messageId = 'target', chatId = '48:notes'): TeamsIc3Message {
        return {
            chatId, messageId, createdAt: new Date(startedAt - 1000).toISOString(),
            modifiedAt: new Date(startedAt - 1000).toISOString(),
            authorKind: 'user', authorId: 'another-user', text: 'Review the quoted request.',
            untrustedHtml: '<blockquote>Parent</blockquote>Review the quoted request.',
            deleted: false, textTruncated: false, htmlTruncated: false,
        };
    }
    function start(reader: Pick<TeamsIc3Session, 'readHistory'> = { readHistory }, dataDir = path.resolve('data')) {
        pickup = createTeamsReactionPickup({
            account, startedAt, reader, reactions, execution, store, dataDir,
            getConfig: () => config, signal: parent.signal,
        });
    }
    async function launched(count = 1) {
        await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(count));
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(startedAt + 1000);
        account = { ...owner };
        config = {
            features: { teamsReactionDelegation: true },
            teamsReactionDelegation: { workspaceId: binding.workspaceId, dispatcherSkill: 'dispatcher' },
        };
        store = createMockProcessStore();
        events = new EventEmitter();
        tasks = new Map();
        parent = new AbortController();
        resolve = vi.spyOn(dispatcher, 'resolveTeamsReactionDispatcher').mockResolvedValue({ ...binding });
        readHistory.mockReset().mockResolvedValue({ items: [message()], rawCount: 1 });
        acknowledgeSourceMessage.mockReset().mockResolvedValue(undefined);
        reactions = { acknowledgeSourceMessage };
        launch.mockClear();
        execution = createTeamsReactionExecution({
            launch, queue: {
                on: (name, listener) => { events.on(name, listener); },
                off: (name, listener) => { events.off(name, listener); },
                getTask: id => tasks.get(id),
            },
        });
        start();
    });
    afterEach(() => {
        pickup.dispose();
        execution.dispose();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it.each(['48:notes', '19:direct@thread.v2', '19:group@unq.gbl.spaces'])(
        'collects only the admitted %s source and returns the owned terminal job', async chatId => {
            readHistory.mockResolvedValue({ items: [message('target', chatId)], rawCount: 1 });
            const pending = pickup.handle(evidence('target', Date.now(), chatId));
            await launched();
            const [id, context, signal] = launch.mock.calls[0];
            expect(readHistory).toHaveBeenCalledExactlyOnceWith(chatId, { cursor: undefined, signal: expect.any(AbortSignal) });
            expect(resolve).toHaveBeenCalledTimes(2);
            expect(acknowledgeSourceMessage).toHaveBeenCalledExactlyOnceWith(chatId, 'target', expect.any(AbortSignal));
            expect(acknowledgeSourceMessage.mock.invocationCallOrder[0]).toBeGreaterThan(
                resolve.mock.invocationCallOrder[1],
            );
            expect(launch.mock.invocationCallOrder[0]).toBeGreaterThan(
                acknowledgeSourceMessage.mock.invocationCallOrder[0],
            );
            expect(JSON.parse(context).target).toMatchObject({
                messageId: 'target', authorId: 'another-user',
                untrustedHtml: '<blockquote>Parent</blockquote>Review the quoted request.',
            });
            expect(signal.aborted).toBe(false);
            let settled = false;
            void pending.then(() => { settled = true; });
            await Promise.resolve();
            expect(settled).toBe(false);
            finish(id);
            await expect(pending).resolves.toEqual({
                admitted: true, requestId: id, conversationId: chatId, messageId: 'target',
                workspaceId: binding.workspaceId, processId: toQueueProcessId(id), status: 'completed',
                sourceText: 'Review the quoted request.',
                sourceHtml: '<blockquote>Parent</blockquote>Review the quoted request.',
                workingDirectory: binding.workingDirectory,
            });
        },
    );

    it('retains an acknowledged job observer after pickup disposal until its account lifetime ends', async () => {
        const connection = new AbortController();
        pickup.dispose();
        pickup = createTeamsReactionPickup({
            account, startedAt, reader: { readHistory }, reactions, execution, store,
            dataDir: path.resolve('data'), getConfig: () => config,
            signal: parent.signal, executionSignal: connection.signal,
        });
        const pending = pickup.handle(evidence());
        await launched();
        const [id, , executionSignal] = launch.mock.calls[0];
        parent.abort(new Error('Notification disconnected.'));
        pickup.dispose();
        expect(executionSignal.aborted).toBe(false);
        finish(id);
        await expect(pending).resolves.toMatchObject({ admitted: true, status: 'completed' });
        expect(launch).toHaveBeenCalledOnce();
        expect(acknowledgeSourceMessage).toHaveBeenCalledOnce();
    });

    it.each([false, undefined])('does not resolve, read or launch while enablement is %s', async enabled => {
        config.features = { teamsReactionDelegation: enabled };
        await expect(pickup.handle(evidence())).resolves.toEqual({ admitted: false, reason: 'disabled' });
        expect(resolve).not.toHaveBeenCalled();
        expect(readHistory).not.toHaveBeenCalled();
        expect(acknowledgeSourceMessage).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it.each([
        { robotUsers: [] },
        { robotUsers: [{ mri: '8:orgid:cccccccc-cccc-cccc-cccc-cccccccccccc', addedAt: startedAt + 1000 }] },
        { eventAt: startedAt },
        { conversationId: '19:channel@thread.tacv2' },
        { messageId: 'bad/id' },
    ])('never reads or launches rejected normalized evidence %j', async patch => {
        await expect(pickup.handle({ ...evidence(), ...patch })).resolves.toMatchObject({ admitted: false });
        expect(resolve).not.toHaveBeenCalled();
        expect(readHistory).not.toHaveBeenCalled();
        expect(acknowledgeSourceMessage).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it('consumes an addition once before asynchronous reads, without retrying failed policy', async () => {
        resolve.mockRejectedValue(new Error('Dispatcher unavailable.'));
        await expect(pickup.handle(evidence())).rejects.toThrow('Dispatcher unavailable');
        await expect(pickup.handle(evidence())).resolves.toMatchObject({ admitted: false, reason: 'duplicate' });
        expect(resolve).toHaveBeenCalledOnce();
        expect(readHistory).not.toHaveBeenCalled();
        expect(acknowledgeSourceMessage).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent arrivals before the first policy read completes', async () => {
        let release!: (value: typeof binding) => void;
        resolve.mockReturnValueOnce(new Promise(done => { release = done; }));
        const update = evidence();
        const pending = pickup.handle(update);
        await expect(pickup.handle(update)).resolves.toMatchObject({ reason: 'duplicate' });
        expect(resolve).toHaveBeenCalledOnce();
        expect(readHistory).not.toHaveBeenCalled();
        release(binding);
        await launched();
        finish(launch.mock.calls[0][0]);
        await pending;
    });

    it('fails visibly when context evidence is missing', async () => {
        readHistory.mockResolvedValue({ items: [], rawCount: 0 });
        await expect(pickup.handle(evidence())).rejects.toThrow('not found');
        expect(acknowledgeSourceMessage).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it.each(['workspaceId', 'workingDirectory', 'dispatcherSkill', 'dispatcherSkillPath'] as const)(
        'rejects changed %s after collecting context', async key => {
            resolve.mockResolvedValueOnce({ ...binding }).mockResolvedValueOnce({ ...binding, [key]: 'changed' });
            await expect(pickup.handle(evidence())).rejects.toThrow('changed during pickup');
            expect(readHistory).toHaveBeenCalledOnce();
            expect(acknowledgeSourceMessage).not.toHaveBeenCalled();
            expect(launch).not.toHaveBeenCalled();
        },
    );

    it('does not launch if dispatcher policy disappears during the read', async () => {
        readHistory.mockImplementationOnce(async () => {
            resolve.mockRejectedValue(new Error('Dispatcher disabled.'));
            return { items: [message()], rawCount: 1 };
        });
        await expect(pickup.handle(evidence())).rejects.toThrow('Dispatcher disabled');
        expect(acknowledgeSourceMessage).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it('snapshots account, source IDs, reader and acknowledgment methods before awaiting policy', async () => {
        const reader = { readHistory };
        pickup.dispose();
        start(reader);
        const update = evidence();
        const pending = pickup.handle(update);
        update.conversationId = '19:other@thread.v2';
        update.messageId = 'other';
        account.userId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
        reader.readHistory = vi.fn().mockRejectedValue(new Error('Replaced reader.'));
        reactions.acknowledgeSourceMessage = vi.fn().mockRejectedValue(new Error('Replaced reactions.'));
        await launched();
        expect(readHistory.mock.calls[0][0]).toBe('48:notes');
        expect(acknowledgeSourceMessage).toHaveBeenCalledExactlyOnceWith('48:notes', 'target', expect.any(AbortSignal));
        finish(launch.mock.calls[0][0]);
        await expect(pending).resolves.toMatchObject({ messageId: 'target', conversationId: '48:notes' });
    });

    it('ignores duplicate notifications and serializes distinct re-additions through execution', async () => {
        const update = evidence();
        const first = pickup.handle(update);
        await launched();
        await expect(pickup.handle(update)).resolves.toMatchObject({ reason: 'duplicate' });
        vi.setSystemTime(Date.now() + 1);
        const second = pickup.handle(evidence());
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(4));
        expect(launch).toHaveBeenCalledOnce();
        finish(launch.mock.calls[0][0]);
        await first;
        await launched(2);
        expect(launch.mock.calls[1][0]).not.toBe(launch.mock.calls[0][0]);
        finish(launch.mock.calls[1][0]);
        await second;
        expect(readHistory).toHaveBeenCalledTimes(2);
        expect(acknowledgeSourceMessage).toHaveBeenCalledTimes(2);
    });

    it('waits for Eyes before execution without acknowledging concurrent duplicates', async () => {
        let release!: () => void;
        acknowledgeSourceMessage.mockReturnValueOnce(new Promise(done => { release = done; }));
        const update = evidence();
        const pending = pickup.handle(update);
        await vi.waitFor(() => expect(acknowledgeSourceMessage).toHaveBeenCalledOnce());
        expect(launch).not.toHaveBeenCalled();
        await expect(pickup.handle(update)).resolves.toMatchObject({ reason: 'duplicate' });
        expect(acknowledgeSourceMessage).toHaveBeenCalledOnce();
        release();
        await launched();
        finish(launch.mock.calls[0][0]);
        await pending;
    });

    it.each(['not-attempted', 'rejected', 'unknown'])(
        'propagates a %s Eyes write failure without admission or replay', async outcome => {
            const error = Object.assign(new Error('Eyes unavailable.'), { outcome });
            acknowledgeSourceMessage.mockRejectedValueOnce(error);
            const update = evidence();
            await expect(pickup.handle(update)).rejects.toBe(error);
            await expect(pickup.handle(update)).resolves.toMatchObject({ reason: 'duplicate' });
            expect(acknowledgeSourceMessage).toHaveBeenCalledOnce();
            expect(launch).not.toHaveBeenCalled();
            vi.setSystemTime(Date.now() + 1);
            const next = pickup.handle(evidence());
            await launched();
            finish(launch.mock.calls[0][0]);
            await next;
            expect(acknowledgeSourceMessage).toHaveBeenCalledTimes(2);
        },
    );

    it.each(['dispose', 'parent'] as const)(
        'revokes late acknowledgment after %s cancellation without executing', async kind => {
            let release!: () => void;
            acknowledgeSourceMessage.mockReturnValueOnce(new Promise(done => { release = done; }));
            const pending = pickup.handle(evidence());
            await vi.waitFor(() => expect(acknowledgeSourceMessage).toHaveBeenCalledOnce());
            const signal = acknowledgeSourceMessage.mock.calls[0][2]!;
            if (kind === 'dispose') pickup.dispose();
            else parent.abort(new Error('Session replaced.'));
            expect(signal.aborted).toBe(true);
            release();
            await expect(pending).rejects.toThrow();
            expect(launch).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        },
    );

    it('keeps the account-pinned acknowledgment receiver and its lifecycle owned by the session', async () => {
        const client = {
            acknowledgeSourceMessage(chatId: string, messageId: string, signal?: AbortSignal) {
                expect(this).toBe(client);
                return acknowledgeSourceMessage(chatId, messageId, signal);
            },
            dispose: vi.fn(),
        };
        pickup.dispose();
        reactions = client;
        start();
        const pending = pickup.handle(evidence());
        await launched();
        finish(launch.mock.calls[0][0]);
        await pending;
        pickup.dispose();
        expect(client.dispose).not.toHaveBeenCalled();
    });

    it('handles a removal without cancellation and runs its later re-addition separately', async () => {
        const first = pickup.handle(evidence());
        await launched();
        vi.setSystemTime(Date.now() + 1);
        await expect(pickup.handle({ ...evidence(), robotUsers: [] })).resolves.toMatchObject({
            admitted: false, reason: 'absent',
        });
        expect(launch.mock.calls[0][2].aborted).toBe(false);
        vi.setSystemTime(Date.now() + 1);
        const second = pickup.handle(evidence());
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(4));
        expect(launch).toHaveBeenCalledOnce();
        finish(launch.mock.calls[0][0]);
        await first;
        await launched(2);
        finish(launch.mock.calls[1][0]);
        await second;
    });

    it('allows different source messages to execute concurrently', async () => {
        readHistory.mockImplementation(async chatId => ({
            items: [message('first', chatId), message('second', chatId)], rawCount: 2,
        }));
        const first = pickup.handle(evidence('first'));
        const second = pickup.handle(evidence('second'));
        await launched(2);
        for (const [id] of launch.mock.calls) finish(id);
        await Promise.all([first, second]);
    });

    it.each(['failed', 'cancelled'] as const)('returns %s as scheduling evidence, not task success', async status => {
        const pending = pickup.handle(evidence());
        await launched();
        finish(launch.mock.calls[0][0], status);
        await expect(pending).resolves.toMatchObject({ status });
    });

    it.each(['dispose', 'parent'] as const)('revokes policy results after %s cancellation without a read', async kind => {
        let release!: (value: typeof binding) => void;
        resolve.mockReturnValueOnce(new Promise(done => { release = done; }));
        const pending = pickup.handle(evidence());
        if (kind === 'dispose') pickup.dispose();
        else parent.abort(new Error('Session replaced.'));
        release(binding);
        await expect(pending).rejects.toThrow();
        expect(readHistory).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
        await expect(pickup.handle(evidence())).rejects.toThrow();
    });

    it('rejects an already-aborted session before policy, native reads or execution', async () => {
        parent.abort(new Error('Session closed.'));
        await expect(pickup.handle(evidence())).rejects.toThrow('Session closed');
        expect(resolve).not.toHaveBeenCalled();
        expect(readHistory).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
    });

    it('revokes late context results and retires the read timer', async () => {
        let release!: (value: Awaited<ReturnType<TeamsIc3Session['readHistory']>>) => void;
        readHistory.mockReturnValueOnce(new Promise(done => { release = done; }));
        const pending = pickup.handle(evidence());
        await vi.waitFor(() => expect(readHistory).toHaveBeenCalledOnce());
        const readSignal = readHistory.mock.calls[0][1]!.signal!;
        pickup.dispose();
        expect(readSignal.aborted).toBe(true);
        release({ items: [message()], rawCount: 1 });
        await expect(pending).rejects.toThrow();
        expect(launch).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('retains the shared execution lock across session disposal and reconnect', async () => {
        const first = pickup.handle(evidence());
        const firstRejected = expect(first).rejects.toThrow('pickup stopped');
        await launched();
        pickup.dispose();
        await firstRejected;
        vi.setSystemTime(Date.now() + 1);
        start();
        const second = pickup.handle(evidence());
        await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(4));
        expect(launch).toHaveBeenCalledOnce();
        finish(launch.mock.calls[0][0]);
        await launched(2);
        finish(launch.mock.calls[1][0]);
        await second;
    });

    it('caps pending policy/context/execution work at 256 and frees capacity on failure', async () => {
        let release!: () => void;
        const gate = new Promise<void>(done => { release = done; });
        resolve.mockImplementation(async () => {
            await gate;
            throw new Error('Policy unavailable.');
        });
        const pending = Array.from({ length: 256 }, (_, index) =>
            expect(pickup.handle(evidence(`message-${index}`))).rejects.toThrow('Policy unavailable'));
        await expect(pickup.handle(evidence('overflow'))).rejects.toThrow('capacity');
        expect(resolve).toHaveBeenCalledTimes(256);
        release();
        await Promise.all(pending);
        await expect(pickup.handle(evidence('overflow'))).rejects.toThrow('Policy unavailable');
        expect(readHistory).not.toHaveBeenCalled();
    });

    it('composes real strict skill resolution with context collection and owned execution', async () => {
        resolve.mockRestore();
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reaction-pickup-'));
        try {
            const skill = path.join(root, '.github', 'skills', 'dispatcher', 'SKILL.md');
            await fs.mkdir(path.dirname(skill), { recursive: true });
            await fs.writeFile(skill, 'Use the configured task policy.');
            store = createMockProcessStore({ initialWorkspaces: [
                { id: binding.workspaceId, name: 'Fixture', rootPath: root },
            ] });
            config.skills = { autoDetectDefaultFolders: false };
            pickup.dispose();
            start({ readHistory }, path.join(root, 'data'));
            const pending = pickup.handle(evidence());
            await launched();
            expect(JSON.parse(launch.mock.calls[0][1]).target.messageId).toBe('target');
            finish(launch.mock.calls[0][0]);
            await expect(pending).resolves.toMatchObject({ status: 'completed', workspaceId: binding.workspaceId });
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
