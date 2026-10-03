import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { TeamsAnswerRelay } from '../../../src/server/messaging/teams-answer-relay';
import { formatTeamsAnswerChunks, TEAMS_ANSWER_MAX_BYTES } from '../../../src/server/messaging/teams-answer-format';
import { formatTeamsOutbound } from '../../../src/server/messaging/teams-outbound-format';
import { TeamsCommandRouter } from '../../../src/server/messaging/teams-command-router';
import { TeamsMessageNotSentError } from '../../../src/server/messaging/teams-messaging-manager';
import { getRepoDataPath } from '../../../src/server/paths';
import { TeamsOperationError } from '@plusplusoneplusplus/coc-connector/teams';
import { createBotControlMetadata } from '../../../src/server/messaging/bot-control-metadata';

describe('TeamsAnswerRelay new topics', () => {
    let dataDir: string;
    let queue: EventEmitter & { getTask: (id: string) => QueuedTask | undefined };
    let tasks: Map<string, QueuedTask>;
    let processes: Map<string, any>;
    let send: ReturnType<typeof vi.fn>;
    let enabled: boolean;
    let relay: TeamsAnswerRelay;
    let store: ProcessStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-answer-relay-'));
        tasks = new Map();
        processes = new Map();
        queue = Object.assign(new EventEmitter(), { getTask: (id: string) => tasks.get(id) });
        send = vi.fn().mockResolvedValue('accepted-id');
        enabled = true;
        store = {
            getWorkspaces: vi.fn().mockResolvedValue([
                { id: 'workspace-a', name: 'A', rootPath: path.join(dataDir, 'a') },
                { id: 'workspace-b', name: 'B', rootPath: path.join(dataDir, 'b') },
            ]),
            getProcess: vi.fn().mockImplementation(async (id: string) => processes.get(id)),
        } as unknown as ProcessStore;
        relay = new TeamsAnswerRelay({
            dataDir, store, queue,
            isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }),
            send,
        });
    });

    afterEach(() => {
        relay.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function message(id: string) {
        return { messageId: id, channelId: 'channel-1', text: `request ${id}`, senderAadId: 'user-1' };
    }

    function finish(id: string, workspaceId: string, answer: string): void {
        const task = tasks.get(id)!;
        task.status = 'completed';
        processes.set(toQueueProcessId(id), {
            id: toQueueProcessId(id), status: 'completed', metadata: { workspaceId, queueTaskId: id },
            conversationTurns: [
                { role: 'user', content: 'private prompt', turnIndex: 0 },
                { role: 'assistant', content: answer, turnIndex: 1 },
            ],
        });
    }

    it('relays an AI-job table as HTML to its original thread without Markdown pipes', async () => {
        const root = message('table-root');
        const admitted = await relay.admitNew(root, 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        finish(admitted.taskId, 'workspace-a',
            '| Person | Last activity |\n|---|---|\n| Contact A | Oct 2, 4:37 PM |');
        await relay.acknowledged(admitted.taskId);
        expect(send).toHaveBeenCalledTimes(1);
        const [answer, rootId] = send.mock.calls[0];
        expect(rootId).toBe(root.messageId);
        const html = formatTeamsOutbound(answer, 'html');
        expect(html).toContain('<p>CoC · <strong>Request ');
        expect(html).toContain('<th scope="col">Person</th><th scope="col">Last activity</th>');
        expect(html).toContain('<tr><td>Contact A</td><td>Oct 2, 4:37 PM</td></tr>');
        expect(html).not.toContain('|---');
        expect(html).not.toContain('&lt;table');
        await relay.reconcileTask(admitted.taskId);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('persists a shared thread selection while retaining the original answer receipt', async () => {
        const root = message('root-selection');
        const admitted = await relay.admitNew(root, 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });

        const reply = { ...message('reply-selection'), replyToMessageId: root.messageId };
        processes.set('chosen-topic', {
            id: 'chosen-topic', status: 'completed', metadata: { workspaceId: 'workspace-b' },
        });
        await relay.selectThreadTarget(reply, 'workspace-b', 'chosen-topic');
        expect((await relay.resolveThread(reply))?.process?.id).toBe('chosen-topic');
        expect(fs.existsSync(getRepoDataPath(dataDir, 'workspace-b', 'teams-thread-roots'))).toBe(true);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect((await restored.resolveThread(reply))?.workspaceId).toBe('workspace-b');
        } finally {
            restored.dispose();
        }
        await relay.selectThreadTarget(reply, 'workspace-b', null);
        expect(await relay.resolveThread(reply)).toEqual({ workspaceId: 'workspace-b' });
        finish(admitted.taskId, 'workspace-a', 'Original answer');
        await relay.acknowledged(admitted.taskId);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Repo A · Chat'), root.messageId);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Original answer'), root.messageId);
    });

    it('turns a command-only root into a chat in its selected workspace and restores its routing', async () => {
        const reply = { ...message('first-question'), replyToMessageId: 'command-root' };
        await relay.selectThreadTarget(reply, 'workspace-b', null);
        const enqueue = vi.fn(async (id: string) => {
            tasks.set(id, { id, repoId: 'workspace-b', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const admission = await relay.admitThreadNew(reply, 'workspace-b', enqueue);
        expect(admission.duplicate).toBe(false);
        expect((await relay.resolveThread(reply))?.taskId).toBe(admission.taskId);
        await relay.acknowledged(admission.taskId);
        expect(await relay.admitThreadNew(reply, 'workspace-b', enqueue)).toEqual({
            taskId: admission.taskId, duplicate: true,
        });
        expect(enqueue).toHaveBeenCalledTimes(1);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect(restored.threadRoots('team-1', 'channel-1')).toContain('command-root');
            expect((await restored.resolveThread(reply))?.workspaceId).toBe('workspace-b');
            finish(admission.taskId, 'workspace-b', 'Response in command thread');
            await restored.reconcileTask(admission.taskId);
            expect(send).toHaveBeenCalledWith(expect.stringContaining('Response in command thread'), 'command-root');
        } finally {
            restored.dispose();
        }
    });

    it('deduplicates selected thread commands without changing other roots', async () => {
        const command = { ...message('command-id'), replyToMessageId: 'root-one' };
        await relay.selectThreadTarget(command, 'workspace-a', null);
        relay.recordCommand(command);
        expect(relay.hasCommand(command)).toBe(true);
        expect(relay.hasCommand({ ...command, replyToMessageId: 'root-two' })).toBe(false);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });

        try {
            await restored.restore();
            expect(restored.hasCommand(command)).toBe(true);
        } finally {
            restored.dispose();
        }
    });

    it('persists discovered roots without workspace data and scopes them by team and channel', async () => {
        relay.recordDiscoveredRoot('team-1', { ...message('historic-root'), channelId: 'channel-1' });
        relay.recordDiscoveredRoot('team-1', { ...message('other-root'), channelId: 'channel-2' });
        expect(relay.threadRoots('team-1', 'channel-1')).toContain('historic-root');
        expect(relay.threadRoots('team-2', 'channel-1')).not.toContain('historic-root');
        const folder = path.join(dataDir, 'teams-thread-discovery');
        const stored = fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), 'utf8');
        expect(stored).not.toMatch(/workspaceId|workspace-a|workspace-b|request/);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect(restored.threadRoots('team-1', 'channel-1')).toContain('historic-root');
            expect(restored.threadRoots('team-1', 'channel-2')).toContain('other-root');
        } finally {
            restored.dispose();
        }
    });

    it('does not acknowledge a repo switch when selection persistence fails', async () => {
        const blocked = path.join(dataDir, 'not-a-directory');
        fs.writeFileSync(blocked, 'block writes');
        const failing = new TeamsAnswerRelay({
            dataDir: blocked, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        const msg = { ...message('switch'), replyToMessageId: 'root' };
        try {
            await expect(failing.selectThreadTarget(msg, 'workspace-b', null)).rejects.toThrow();
            expect(failing.getThreadSelection(msg)).toBeNull();
        } finally {
            failing.dispose();
        }
    });

    it('rejects cross-workspace and deleted topics without losing the active chat', async () => {
        const msg = { ...message('choose-topic'), replyToMessageId: 'root' };
        await relay.selectThreadTarget(msg, 'workspace-b', null);
        processes.set('foreign-topic', {
            id: 'foreign-topic', status: 'completed', metadata: { workspaceId: 'workspace-a' },
        });
        await expect(relay.selectThreadTarget(msg, 'workspace-b', 'foreign-topic'))
            .rejects.toThrow('Teams thread chat is unavailable');
        await expect(relay.selectThreadTarget(msg, 'workspace-b', 'missing-topic'))
            .rejects.toThrow('Teams thread chat is unavailable');
        expect(await relay.resolveThread(msg)).toEqual({ workspaceId: 'workspace-b' });
    });

    it('runs a command-only thread across two senders without sender fallback or command prompts', async () => {
        const ack = vi.fn().mockResolvedValue(undefined);
        const enqueue = vi.fn(async (ws: string, _prompt: string, id: string) => {
            tasks.set(id, { id, repoId: ws, processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const router = new TeamsCommandRouter({
            store: {
                ...store,
                getAllProcesses: vi.fn().mockResolvedValue([]),
            } as ProcessStore,
            dataDir, sendReply: ack, enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
            isAnswerRelayEnabled: () => enabled,
            resolveThreadReply: msg => relay.resolveThread(msg),
            getThreadSelection: msg => relay.getThreadSelection(msg),
            selectThreadTarget: (msg, ws, proc) => relay.selectThreadTarget(msg, ws, proc),
            hasThreadCommand: msg => relay.hasCommand(msg),
            recordThreadCommand: msg => relay.recordCommand(msg),
            admitThreadNew: (msg, ws) => relay.admitThreadNew(msg, ws, id => enqueue(ws, msg.text, id)),
            acknowledgeNewChat: id => relay.acknowledged(id),
            admitPendingFollowUp: vi.fn().mockResolvedValue({ duplicate: false }),
            acknowledgeFollowUp: vi.fn(),
        });
        const inbound = (id: string, text: string, senderAadId: string) => ({
            ...message(id), text, senderAadId, replyToMessageId: 'existing-root',
        });
        await router.handle(inbound('list', '/list repos', 'person-a'));
        await router.handle(inbound('before', 'Question before selection', 'person-b'));
        expect(ack.mock.calls[1][0]).toContain('/select repo <name>');
        await router.handle(inbound('select', '/select repo B', 'person-b'));
        await router.handle(inbound('select', '/select repo B', 'person-b'));
        expect(ack).toHaveBeenCalledTimes(3);
        await router.handle(inbound('malformed', '/select repo', 'person-a'));
        expect(ack.mock.lastCall?.[0]).toContain('Unknown command');
        await router.handle(inbound('question', 'Question after selection', 'person-a'));
        expect(enqueue).toHaveBeenCalledExactlyOnceWith('workspace-b', 'Question after selection', expect.any(String));
        expect(ack.mock.lastCall?.[1]).toBe('existing-root');
        await router.handle(inbound('question', 'Question after selection', 'person-a'));
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it('reconstructs a historical repo command silently and never admits old questions', async () => {
        const ack = vi.fn().mockResolvedValue(undefined);
        const enqueue = vi.fn();
        const router = new TeamsCommandRouter({
            store, dataDir, sendReply: ack, enqueueChat: enqueue, executeFollowUp: vi.fn(),
            isAnswerRelayEnabled: () => enabled,
            getThreadSelection: msg => relay.getThreadSelection(msg),
            resolveThreadReply: msg => relay.resolveThread(msg),
            selectThreadTarget: (msg, ws, proc) => relay.selectThreadTarget(msg, ws, proc),
            hasThreadCommand: msg => relay.hasCommand(msg),
        });
        const historic = { ...message('historical-select'), text: '/select repo B',
            replyToMessageId: 'historic-root', initializationReplay: true, historicalSelectionReplay: true };
        relay.recordDiscoveredRoot('team-1', { ...message('historic-root'), channelId: 'channel-1' });
        await router.handle({ ...message('old-question'), replyToMessageId: 'historic-root', historicalSelectionReplay: true });
        await router.handle(historic);
        expect(relay.getThreadSelection(historic)).toEqual({ workspaceId: 'workspace-b' });
        processes.set('historic-topic', {
            id: 'historic-topic', status: 'completed', metadata: { workspaceId: 'workspace-b' },
        });
        await router.handle({ ...historic, messageId: 'historic-topic-command', text: '/select topic historic-topic' });
        expect((await relay.resolveThread(historic))?.process?.id).toBe('historic-topic');
        await router.handle({ ...historic, messageId: 'historic-new-command', text: '/create topic' });
        expect(await relay.resolveThread(historic)).toEqual({ workspaceId: 'workspace-b' });
        expect(ack).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
        const freshRouter = new TeamsCommandRouter({
            store, dataDir, sendReply: ack, enqueueChat: enqueue, executeFollowUp: vi.fn(),
            isAnswerRelayEnabled: () => enabled,
            getThreadSelection: msg => relay.getThreadSelection(msg),
            resolveThreadReply: msg => relay.resolveThread(msg),
            selectThreadTarget: (msg, ws, proc) => relay.selectThreadTarget(msg, ws, proc),
        });
        await freshRouter.handle({ ...historic, messageId: 'older-select', text: '/select repo A' });
        expect(relay.getThreadSelection(historic)).toEqual({ workspaceId: 'workspace-b' });
        expect(ack).not.toHaveBeenCalled();
    });

    it('keeps the newer selection when a prior chat admission finishes after a repo switch', async () => {
        const first = { ...message('first-question'), replyToMessageId: 'shared-root' };
        await relay.selectThreadTarget(first, 'workspace-a', null);
        let finishEnqueue: ((id: string) => void) | undefined;
        const queued = relay.admitThreadNew(first, 'workspace-a', id => new Promise(resolve => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            finishEnqueue = resolve;
        }));
        await vi.waitFor(() => expect(finishEnqueue).toBeDefined());
        await relay.selectThreadTarget({ ...message('switch'), replyToMessageId: 'shared-root' }, 'workspace-b', null);
        finishEnqueue!(tasks.keys().next().value!);
        const admitted = await queued;
        expect((await relay.resolveThread(first))).toEqual({ workspaceId: 'workspace-b' });
        finish(admitted.taskId, 'workspace-a', 'Earlier repo answer');
        await relay.acknowledged(admitted.taskId);
        expect(send).toHaveBeenCalledWith(expect.stringContaining('Repo A · Chat'), 'shared-root');
    });

    it('restores the selected workspace even when the original root workspace is removed', async () => {
        const root = message('old-root');
        await relay.admitNew(root, 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const reply = { ...message('switch-command'), replyToMessageId: root.messageId };
        await relay.selectThreadTarget(reply, 'workspace-b', null);
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: 'workspace-b', name: 'B', rootPath: path.join(dataDir, 'b') },
        ] as Awaited<ReturnType<typeof store.getWorkspaces>>);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect(await restored.resolveThread(reply)).toEqual({ workspaceId: 'workspace-b' });
            expect(restored.threadRoots('team-1', 'channel-1')).toContain(root.messageId);
        } finally {
            restored.dispose();
        }
    });

    it('rejects a removed selected workspace after restart rather than falling back to its original chat', async () => {
        const root = message('old-chat-root');
        await relay.admitNew(root, 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const reply = { ...message('move-to-b'), replyToMessageId: root.messageId };
        await relay.selectThreadTarget(reply, 'workspace-b', null);
        vi.mocked(store.getWorkspaces).mockResolvedValue([
            { id: 'workspace-a', name: 'A', rootPath: path.join(dataDir, 'a') },
        ] as Awaited<ReturnType<typeof store.getWorkspaces>>);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            await expect(restored.resolveThread(reply)).rejects.toThrow('workspace is unavailable');
        } finally {
            restored.dispose();
        }
    });

    it('attaches a second question to a pending chat started in a command-only thread', async () => {
        const first = { ...message('first'), replyToMessageId: 'command-root' };
        await relay.selectThreadTarget(first, 'workspace-a', null);
        const admitted = await relay.admitThreadNew(first, 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued',
                type: 'chat', payload: { kind: 'chat', workspaceId: 'workspace-a' } } as QueuedTask);
            return id;
        });
        const second = { ...message('second'), replyToMessageId: 'command-root' };
        const enqueue = vi.fn(async (workspaceId: string, processId: string, requestId: string, taskId: string) => {
            expect(workspaceId).toBe('workspace-a');
            expect(processId).toBe(toQueueProcessId(admitted.taskId));
            expect(requestId).toBeTruthy();
            return taskId;
        });
        expect(await relay.admitPendingFollowUp(second, admitted.taskId, enqueue)).toEqual({ duplicate: false });
        expect(await relay.admitPendingFollowUp(second, admitted.taskId, enqueue)).toEqual({ duplicate: true });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    async function pendingOrigin(messageId = 'pending-root', workspaceId = 'workspace-a') {
        return relay.admitNew(message(messageId), workspaceId, async id => {
            tasks.set(id, {
                id, repoId: workspaceId, processId: toQueueProcessId(id), status: 'queued',
                type: 'chat', payload: { kind: 'chat', workspaceId },
                botControl: createBotControlMetadata('teams'),
            } as QueuedTask);
            return id;
        });
    }

    it('deduplicates concurrent pending follow-ups without changing origin control', async () => {
        const parent = await pendingOrigin();
        tasks.get(parent.taskId)!.status = 'running';
        const enqueue = vi.fn(async (_ws: string, _process: string, _request: string, id: string) => id);
        const results = await Promise.all([
            relay.admitPendingFollowUp(message('pending-question'), parent.taskId, enqueue),
            relay.admitPendingFollowUp(message('pending-question'), toQueueProcessId(parent.taskId), enqueue),
        ]);
        expect(results).toEqual([{ duplicate: false }, { duplicate: true }]);
        expect(enqueue).toHaveBeenCalledOnce();
        expect(tasks.get(parent.taskId)!.botControl).toEqual(createBotControlMetadata('teams'));
    });

    it.each(['workspace', 'id', 'failed', 'cancelled', 'competing', 'malformed'])(
        'rejects a process with %s drift appearing during pending admission',
        async mismatch => {
            const parent = await pendingOrigin();
            const processId = toQueueProcessId(parent.taskId);
            processes.set(processId, {
                id: mismatch === 'id' ? 'wrong-process' : processId,
                status: mismatch === 'failed' || mismatch === 'cancelled' ? mismatch : 'running',
                metadata: {
                    workspaceId: mismatch === 'workspace' ? 'workspace-b' : 'workspace-a',
                    botControl: mismatch === 'competing' ? createBotControlMetadata('whatsapp')
                        : mismatch === 'malformed' ? { source: 'teams' } : createBotControlMetadata('teams'),
                },
            });
            const enqueue = vi.fn();
            await expect(relay.admitPendingFollowUp(message('pending-question'), parent.taskId, enqueue)).rejects.toThrow();
            expect(enqueue).not.toHaveBeenCalled();
        },
    );

    it('rejects reuse of a pending receipt for another conversation and workspace', async () => {
        const first = await pendingOrigin('root-a');
        const second = await pendingOrigin('root-b', 'workspace-b');
        const enqueue = vi.fn(async (_ws: string, _process: string, _request: string, id: string) => id);
        await relay.admitPendingFollowUp(message('shared-delivery'), first.taskId, enqueue);
        await expect(relay.admitPendingFollowUp(message('shared-delivery'), second.taskId, enqueue))
            .rejects.toThrow('binding identity mismatch');
        expect(enqueue).toHaveBeenCalledOnce();
    });

    it('rejects an inbound channel outside the live target', async () => {
        const parent = await pendingOrigin();
        const enqueue = vi.fn();
        await expect(relay.admitPendingFollowUp(
            { ...message('pending-question'), channelId: 'other-channel' }, parent.taskId, enqueue,
        )).rejects.toThrow('Teams topic is unavailable');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('removes a rejected reserved pending receipt when a callback returns an unrelated ID', async () => {
        const parent = await pendingOrigin();
        await expect(relay.admitPendingFollowUp(message('pending-question'), parent.taskId, async () => 'wrong-task'))
            .rejects.toThrow('different task ID');
        expect(relay.hasInbound(message('pending-question'))).toBe(false);
        expect(relay.hasInbound(message('pending-root'))).toBe(true);
        const enqueue = vi.fn(async (_ws: string, _process: string, _request: string, id: string) => id);
        await expect(relay.admitPendingFollowUp(message('pending-question'), parent.taskId, enqueue))
            .resolves.toEqual({ duplicate: false });
    });

    it('acknowledges before sending the saved assistant turn and deduplicates inbound polling', async () => {
        const ack = vi.fn().mockResolvedValue(undefined);
        const enqueue = vi.fn(async (workspaceId: string, _prompt: string, id: string) => {
            tasks.set(id, { id, repoId: workspaceId, processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const router = new TeamsCommandRouter({
            store, dataDir, sendReply: ack,
            enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
            admitNewChat: (msg, wsId, prompt) => relay.admitNew(msg, wsId, id => enqueue(wsId, prompt, id)),
            acknowledgeNewChat: id => relay.acknowledged(id),
        });

        if (!relay.hasInbound(message('post-1'))) await router.handle(message('post-1'));
        expect(ack).toHaveBeenCalledTimes(1);
        const id = enqueue.mock.calls[0][2];
        expect(relay.hasInbound(message('post-1'))).toBe(true);
        finish(id, 'workspace-a', 'Distinct saved response');
        queue.emit('taskCompleted', tasks.get(id));
        await relay.reconcileTask(id);
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Distinct saved response'), 'post-1');
        const receiptFolder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
        const receipt = fs.readFileSync(path.join(receiptFolder, fs.readdirSync(receiptFolder)[0]), 'utf8');
        expect(receipt).not.toMatch(/Distinct saved response|private prompt|user-1/);
        if (!relay.hasInbound(message('post-1'))) await router.handle(message('post-1'));
        await relay.reconcileTask(id);
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(ack).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('does not send before acknowledgement or relay a previous, interrupted, or missing answer', async () => {
        const enqueue = async (id: string) => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        };
        const first = await relay.admitNew(message('post-1'), 'workspace-a', enqueue);
        finish(first.taskId, 'workspace-a', 'answer after ack');
        await relay.reconcileTask(first.taskId);
        expect(send).not.toHaveBeenCalled();
        await relay.acknowledged(first.taskId);
        expect(send).toHaveBeenCalledOnce();

        const second = await relay.admitNew(message('post-2'), 'workspace-a', enqueue);
        finish(second.taskId, 'workspace-a', 'interrupted');
        processes.get(toQueueProcessId(second.taskId)).conversationTurns[1].interrupted = true;
        await relay.acknowledged(second.taskId);
        expect(send).toHaveBeenCalledTimes(1);

        const third = await relay.admitNew(message('post-3'), 'workspace-a', enqueue);
        finish(third.taskId, 'workspace-b', 'wrong workspace');
        await relay.acknowledged(third.taskId);
        expect(send).toHaveBeenCalledTimes(1);

        const fourth = await relay.admitNew(message('post-4'), 'workspace-a', enqueue);
        finish(fourth.taskId, 'workspace-a', '');
        await relay.acknowledged(fourth.taskId);
        expect(send.mock.calls[1][0]).toContain('This request completed without a text answer.');

        const fifth = await relay.admitNew(message('post-5'), 'workspace-a', enqueue);
        finish(fifth.taskId, 'workspace-a', 'never saved');
        processes.get(toQueueProcessId(fifth.taskId)).conversationTurns.pop();
        await relay.acknowledged(fifth.taskId);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('keeps workspace bindings isolated and never replays an accepted or uncertain send', async () => {
        const makeTask = (workspaceId: string) => async (id: string) => {
            tasks.set(id, { id, repoId: workspaceId, processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        };
        const one = await relay.admitNew(message('post-1'), 'workspace-a', makeTask('workspace-a'));
        const two = await relay.admitNew(message('post-2'), 'workspace-b', makeTask('workspace-b'));
        await relay.acknowledged(one.taskId);
        await relay.acknowledged(two.taskId);
        finish(one.taskId, 'workspace-a', 'answer A');
        finish(two.taskId, 'workspace-b', 'answer B');
        await relay.reconcile();
        expect(send.mock.calls).toEqual([
            [expect.stringContaining('answer A'), 'post-1'],
            [expect.stringContaining('answer B'), 'post-2'],
        ]);
        relay.dispose();
        const restarted = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restarted.restore();
        expect(send).toHaveBeenCalledTimes(2);
        restarted.dispose();
    });

    it('never admits a repeated inbound message into a newly selected workspace', async () => {
        const first = await relay.admitNew(message('same-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        });

        const crossWorkspaceEnqueue = vi.fn();
        const duplicate = await relay.admitNew(message('same-post'), 'workspace-b', crossWorkspaceEnqueue);
        expect(duplicate).toEqual({ taskId: first.taskId, duplicate: true });
        expect(crossWorkspaceEnqueue).not.toHaveBeenCalled();
    });

    it('retains tracked roots and outbound IDs across restore without leaking other channels', async () => {
        const root = await relay.admitNew(message('old-root'), 'workspace-b', async id => {
            tasks.set(id, { id, repoId: 'workspace-b', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        await relay.acknowledged(root.taskId);
        finish(root.taskId, 'workspace-b', 'completed');
        await relay.reconcileTask(root.taskId);
        relay.recordOutbound('team-1', 'channel-1', 'old-root', 'sent-acceptance');
        expect(relay.threadRoots('team-1', 'channel-1')).toEqual(['old-root']);
        expect(relay.threadRoots('team-1', 'other-channel')).toEqual([]);
        expect(relay.isOwnReply('team-1', { ...message('sent-acceptance'), replyToMessageId: 'old-root' })).toBe(true);
        expect(relay.isOwnReply('other-team', { ...message('sent-acceptance'), replyToMessageId: 'old-root' })).toBe(false);

        relay.dispose();
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restored.restore();
        expect(restored.threadRoots('team-1', 'channel-1')).toEqual(['old-root']);
        expect(restored.isOwnReply('team-1', { ...message('sent-acceptance'), replyToMessageId: 'old-root' })).toBe(true);
        restored.dispose();
    });

    it('retains a per-root reply cursor after a follow-up receipt is compacted', async () => {
        const root = await relay.admitNew(message('root-cursor'), 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued',
                type: 'chat', payload: { kind: 'chat', workspaceId: 'workspace-a' } } as QueuedTask);
            return id;
        });
        const reply = {
            ...message('reply-cursor'), replyToMessageId: 'root-cursor',
            createdDateTime: '2026-01-01T00:00:00Z',
        };
        await relay.admitPendingFollowUp(reply, root.taskId, async (_ws, _process, _request, id) => id);
        relay.recordSeenReply('team-1', reply);
        expect(relay.hasSeenReply('team-1', reply)).toBe(true);
        expect(relay.hasSeenReply('team-1', {
            ...reply, messageId: 'new-same-millisecond',
        })).toBe(false);
        relay.dispose();
        const folder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
        const followUpFile = fs.readdirSync(folder).map(name => path.join(folder, name))
            .find(file => JSON.parse(fs.readFileSync(file, 'utf8')).messageId === reply.messageId)!;
        fs.unlinkSync(followUpFile);
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restored.restore();
        expect(restored.threadRoots('team-1', 'channel-1')).toEqual(['root-cursor']);
        expect(restored.hasSeenReply('team-1', reply)).toBe(true);
        expect(restored.hasSeenReply('team-1', { ...reply, messageId: 'old-reply',
            createdDateTime: '2025-12-31T23:59:59Z' })).toBe(true);
        expect(restored.hasSeenReply('team-1', { ...reply, messageId: 'newer-reply',
            createdDateTime: '2026-01-01T00:00:01Z' })).toBe(false);
        restored.dispose();
    });

    it('recognizes an answer returned before its outbound ID can be persisted', async () => {
        const root = await relay.admitNew(message('root-crash'), 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        finish(root.taskId, 'workspace-a', 'answer after send');
        send.mockRejectedValueOnce(new Error('send confirmation interrupted'));
        await relay.acknowledged(root.taskId);
        expect(send).toHaveBeenCalledOnce();
        const outbound = { ...message('unrecorded-id'), replyToMessageId: 'root-crash',
            text: formatTeamsOutbound(send.mock.calls[0][0] as string, 'html') };
        relay.dispose();
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restored.restore();
        expect(restored.isOwnReply('team-1', outbound)).toBe(true);
        const plain = outbound.text.replace(/<\/p>/g, '\n').replace(/<[^>]*>/g, '');
        expect(restored.isOwnReply('team-1', { ...outbound, text: plain })).toBe(true);
        expect(restored.isOwnReply('team-1', { ...outbound, text: plain.replace(/^CoC · /, 'AI: ') })).toBe(true);
        expect(restored.isOwnReply('team-1', { ...outbound, text: 'CoC · Human question' })).toBe(false);
        expect(restored.isOwnReply('team-2', outbound)).toBe(false);
        expect(restored.isOwnReply('team-1', { ...outbound, channelId: 'other-channel' })).toBe(false);
        expect(restored.isOwnReply('team-1', { ...outbound, replyToMessageId: 'other-root' })).toBe(false);
        expect(send).toHaveBeenCalledTimes(1);
        restored.dispose();
    });

    it('resolves a bound thread only in its physical workspace, including a queued root', async () => {
        const accepted = await relay.admitNew(message('root-b'), 'workspace-b', async id => {
            tasks.set(id, { id, repoId: 'workspace-b', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const reply = { ...message('reply-b'), replyToMessageId: 'root-b' };
        expect(await relay.resolveThread(reply)).toEqual({
            taskId: accepted.taskId, workspaceId: 'workspace-b',
        });
        finish(accepted.taskId, 'workspace-b', 'answer');
        const bound = await relay.resolveThread(reply);
        expect(bound?.process?.id).toBe(toQueueProcessId(accepted.taskId));
        expect(bound?.workspaceId).toBe('workspace-b');
        expect(await relay.resolveThread({ ...reply, replyToMessageId: 'missing-root' })).toBeNull();

        processes.get(toQueueProcessId(accepted.taskId)).metadata.workspaceId = 'workspace-a';
        await expect(relay.resolveThread(reply)).rejects.toThrow('Teams thread chat is unavailable');
        expect(await relay.resolveThread({ ...reply, channelId: 'other-channel' })).toBeNull();
    });

    it('rejects a stale queued binding before admitting a thread follow-up', async () => {
        const accepted = await relay.admitNew(message('root-a'), 'workspace-a', async id => {
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const reply = { ...message('new-reply'), replyToMessageId: 'root-a' };
        tasks.get(accepted.taskId)!.repoId = 'workspace-b';
        const enqueue = vi.fn();
        await expect(relay.resolveThread(reply)).rejects.toThrow('Teams thread chat is unavailable');
        await expect(relay.admitPendingFollowUp(reply, accepted.taskId, enqueue))
            .rejects.toThrow('Teams thread chat is unavailable');
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('honors disabling before admission and delivery', async () => {
        enabled = false;
        await expect(relay.admitNew(message('post-1'), 'workspace-a', vi.fn())).rejects.toThrow();
        enabled = true;
        const id = (await relay.admitNew(message('post-1'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        enabled = false;
        finish(id, 'workspace-a', 'answer');
        await relay.acknowledged(id);
        expect(send).not.toHaveBeenCalled();
        enabled = true;
        await relay.reconcile();
        expect(send).toHaveBeenCalledOnce();
    });

    it('keeps the existing routing error text when the relay flag is off', async () => {
        const reply = vi.fn().mockResolvedValue(undefined);
        const router = new TeamsCommandRouter({
            store, dataDir, sendReply: reply,
            isAnswerRelayEnabled: () => false,
            enqueueChat: vi.fn().mockRejectedValue(new Error('queue is full')),
            admitNewChat: async () => { throw new Error('queue is full'); },
            executeFollowUp: vi.fn(),
        });
        await router.handle(message('off-error'));
        expect(reply).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('queue is full'), 'off-error');
    });

    it('sends a safe terminal notice for queued cancellation without a process', async () => {
        const id = (await relay.admitNew(message('cancelled-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        tasks.get(id)!.status = 'cancelled';
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('This request was cancelled.'), 'cancelled-post');
    });

    it('does not relay interrupted output when a running task is cancelled', async () => {
        const id = (await relay.admitNew(message('running-cancel'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'running' } as QueuedTask);
            return taskId;
        })).taskId;
        await relay.acknowledged(id);
        finish(id, 'workspace-a', 'private partial answer');
        const proc = processes.get(toQueueProcessId(id));
        proc.status = 'cancelled';
        proc.conversationTurns[1].interrupted = true;
        tasks.get(id)!.status = 'cancelled';
        queue.emit('taskCancelled', tasks.get(id));
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(send.mock.calls[0][0]).toContain('This request was cancelled.');
        expect(send.mock.calls[0][0]).not.toContain('private partial answer');
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('waits through a queue retry and relays only its successful saved answer', async () => {
        const id = (await relay.admitNew(message('retried-task'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'running', retryCount: 0 } as QueuedTask);
            return taskId;
        })).taskId;
        await relay.acknowledged(id);
        tasks.get(id)!.retryCount = 1;
        tasks.get(id)!.status = 'queued';
        await relay.reconcile();
        expect(send).not.toHaveBeenCalled();
        finish(id, 'workspace-a', 'answer after retry');
        queue.emit('taskCompleted', tasks.get(id));
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(send.mock.calls[0][0]).toContain('answer after retry');
        expect(send.mock.calls[0][0]).not.toContain('could not be completed');
    });

    it('does not leak failed-turn partial output or raw failure details', async () => {
        const id = (await relay.admitNew(message('failed-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'sensitive partial output');
        tasks.get(id)!.status = 'failed';
        const proc = processes.get(toQueueProcessId(id));
        proc.status = 'failed';
        proc.error = 'private provider exception';
        proc.conversationTurns[1].interrupted = true;
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining('This request could not be completed.'), 'failed-post',
        );
        expect(send.mock.calls[0][0]).not.toMatch(/private|sensitive|provider exception/);
    });

    it('relays the session limit and reset time without leaking interrupted output', async () => {
        const id = (await relay.admitNew(message('limit-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'sensitive partial output');
        tasks.get(id)!.status = 'failed';
        const proc = processes.get(toQueueProcessId(id));
        proc.status = 'failed';
        proc.conversationTurns[1].interrupted = true;
        proc.conversationTurns[1].interruptionReason = "You've hit your session limit · resets 7:10pm (UTC)";
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining('Provider session limit reached. Resets at 7:10pm (UTC).'), 'limit-post',
        );
        expect(send.mock.calls[0][0]).not.toContain('sensitive partial output');
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('selects the final persisted assistant turn rather than an earlier tool-only turn', async () => {
        const id = (await relay.admitNew(message('multi-part-turn'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', '');
        processes.get(toQueueProcessId(id)).conversationTurns.push({
            role: 'assistant', content: 'the final saved answer', turnIndex: 2,
        });
        await relay.acknowledged(id);
        expect(send.mock.calls[0]).toEqual([expect.stringContaining('the final saved answer'), 'multi-part-turn']);
    });

    it('rejects an unbound Teams thread reply without creating a chat', async () => {
        const ack = vi.fn().mockResolvedValue(undefined);
        const router = new TeamsCommandRouter({
            store, dataDir, sendReply: ack,
            enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
            isAnswerRelayEnabled: () => true,
            admitNewChat: (msg, wsId) => relay.admitNew(msg, wsId, async taskId => {
                tasks.set(taskId, { id: taskId, repoId: wsId, processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
                return taskId;
            }),
            acknowledgeNewChat: id => relay.acknowledged(id),
        });
        await router.handle({ ...message('reply-1'), replyToMessageId: 'thread-root' });
        expect(ack.mock.calls[0][1]).toBe('thread-root');
        expect(ack.mock.calls[0][0]).toContain('/select repo <name>');
        expect(tasks.size).toBe(0);
        expect(send).not.toHaveBeenCalled();
    });

    it('labels two users asking in one thread with distinct opaque request labels', async () => {
        for (const [id, sender, answer] of [
            ['reply-a', 'user-a', 'answer A'], ['reply-b', 'user-b', 'answer B'],
        ]) {
            const msg = { ...message(id), replyToMessageId: 'shared-root', senderAadId: sender };
            const taskId = (await relay.admitNew(msg, 'workspace-a', async value => {
                tasks.set(value, { id: value, repoId: 'workspace-a', processId: toQueueProcessId(value), status: 'queued' } as QueuedTask);
                return value;
            })).taskId;
            finish(taskId, 'workspace-a', answer);
            await relay.acknowledged(taskId);
        }
        expect(send.mock.calls.map(call => call[1])).toEqual(['shared-root', 'shared-root']);
        const labels = send.mock.calls.map(call => (call[0] as string).match(/Request ([a-f0-9]{10}) ·/)?.[1]);
        expect(labels[0]).toMatch(/^[a-f0-9]{10}$/);
        expect(labels[1]).not.toBe(labels[0]);
        expect(send.mock.calls[0][0]).not.toContain('user-a');
        expect(send.mock.calls[1][0]).not.toContain('user-b');
    });

    it('recovers an admitted completion on restart without repeating an accepted send', async () => {
        const id = (await relay.admitNew(message('restart-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'saved after crash');
        relay.dispose();
        tasks.clear();
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restored.restore();
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('saved after crash'), 'restart-post');
        await restored.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
        restored.dispose();
    });

    it('propagates a corrupt receipt without sending or rerouting its answer', async () => {
        const id = (await relay.admitNew(message('corrupt-receipt'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'unsent answer');
        relay.dispose();
        const folder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
        fs.writeFileSync(path.join(folder, fs.readdirSync(folder)[0]), '{"invalid":true}');
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await expect(restored.restore()).rejects.toThrow('Invalid Teams answer binding');
        expect(send).not.toHaveBeenCalled();
        restored.dispose();
    });

    it('never reroutes an old-channel answer through a newly selected Teams target', async () => {
        const id = (await relay.admitNew(message('old-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'old answer');
        relay.dispose();
        const moved = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-2' }), send,
        });
        await moved.restore();
        expect(send).not.toHaveBeenCalled();
        moved.dispose();
        const returned = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await returned.restore();
        expect(send).toHaveBeenCalledTimes(1);
        returned.dispose();
    });

    it('holds a completed receipt across disconnect and resumes only on matching reconnect', async () => {
        const id = (await relay.admitNew(message('offline-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        await relay.acknowledged(id);
        relay.dispose();
        let connected = false;
        const resumed = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        finish(id, 'workspace-a', 'saved while offline');
        await resumed.restore();
        expect(send).not.toHaveBeenCalled();
        connected = true;
        await resumed.reconnected();
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('saved while offline'), 'offline-post');
        resumed.dispose();
    });

    it('pauses a multipart delivery when disabled between confirmed parts and resumes without resending part one', async () => {
        const id = (await relay.admitNew(message('paused-multipart'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'large & answer '.repeat(3_000));
        send.mockImplementationOnce(async () => {
            enabled = false;
            return 'first-part-id';
        });
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledTimes(1);
        enabled = true;
        await relay.reconnected();
        expect(send.mock.calls.length).toBeGreaterThan(1);
        expect(send.mock.calls[0][0]).toContain('Part 1/');
        expect(send.mock.calls[1][0]).toContain('Part 2/');
    });

    it.each(['stable', 'shifted', 'unsent'] as const)(
        'handles %s persisted chunk boundaries safely across attribution changes', async scenario => {
            const root = message(`attribution-${scenario}`);
            const id = (await relay.admitNew(root, 'workspace-a', async taskId => {
                tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                    processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
                return taskId;
            })).taskId;
            const answer = scenario === 'stable' ? 'x'.repeat(12_000) + '\n' + 'y'.repeat(12_000)
                : '&'.repeat(10_000);
            finish(id, 'workspace-a', answer);
            send.mockImplementationOnce(async () => {
                enabled = false;
                return 'confirmed-first-part';
            });
            await relay.acknowledged(id);
            const folder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
            const receipt = path.join(folder, fs.readdirSync(folder)[0]);
            const saved = JSON.parse(fs.readFileSync(receipt, 'utf8'));
            const label = (send.mock.calls[0][0] as string).match(/Request ([\w-]+)/)![1];
            const oldParts = formatTeamsAnswerChunks(answer, label, undefined, saved.sourceContext, 'legacy');
            const newParts = formatTeamsAnswerChunks(answer, label, undefined, saved.sourceContext);
            expect(oldParts.length).toBe(newParts.length);
            if (scenario === 'stable') expect(oldParts).toEqual(newParts);
            else expect(oldParts).not.toEqual(newParts);
            delete saved.attribution;
            saved.partCount = oldParts.length;
            saved.nextPart = scenario === 'unsent' ? 0 : 1;
            fs.writeFileSync(receipt, JSON.stringify(saved));
            relay.dispose();
            send.mockClear();
            enabled = true;
            const restored = new TeamsAnswerRelay({
                dataDir, store, queue, isEnabled: () => enabled,
                target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
            });
            try {
                await restored.restore();
                const updated = JSON.parse(fs.readFileSync(receipt, 'utf8'));
                if (scenario === 'shifted') {
                    expect(send).not.toHaveBeenCalled();
                    expect(updated.status).toBe('ambiguous');
                    expect(updated.nextPart).toBe(1);
                } else {
                    expect(updated.status).toBe('delivered');
                    expect(updated.attribution).toBe('compact');
                    expect(send.mock.calls.map(([part]) => part))
                        .toEqual(newParts.slice(scenario === 'unsent' ? 0 : 1));
                }
                const count = send.mock.calls.length;
                await restored.reconcile();
                expect(send).toHaveBeenCalledTimes(count);
            } finally {
                restored.dispose();
            }
        },
    );

    it('delivers a persisted answer even when the immediate acknowledgement rejects', async () => {
        const ack = vi.fn().mockRejectedValueOnce(new Error('ACK rejected')).mockResolvedValue(undefined);
        const router = new TeamsCommandRouter({
            store, dataDir, sendReply: ack,
            enqueueChat: vi.fn(), executeFollowUp: vi.fn(),
            admitNewChat: (msg, wsId) => relay.admitNew(msg, wsId, async taskId => {
                tasks.set(taskId, { id: taskId, repoId: wsId, processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
                finish(taskId, wsId, 'saved answer');
                return taskId;
            }),
            acknowledgeNewChat: id => relay.acknowledged(id),
        });
        await router.handle(message('ack-failed'));
        expect(ack).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('saved answer'), 'ack-failed');
    });

    it('quarantines an unknown send outcome instead of replaying it', async () => {
        const id = (await relay.admitNew(message('uncertain-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        send.mockRejectedValueOnce(new Error('timeout while receiving confirmation'));
        finish(id, 'workspace-a', 'answer');
        await relay.acknowledged(id);
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it.each(['not-attempted', 'rejected', 'unknown'] as const)(
        'retries only definitive Graph delivery outcomes (%s)', async outcome => {
            const id = (await relay.admitNew(message('graph-outcome'), 'workspace-a', async taskId => {
                tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
                return taskId;
            })).taskId;
            finish(id, 'workspace-a', 'saved answer');
            vi.useFakeTimers();
            try {
                send.mockRejectedValueOnce(new TeamsOperationError('Graph request failed', 'graph', 'authentication', outcome));
                await relay.acknowledged(id);
                await vi.advanceTimersByTimeAsync(1_000);
                expect(send).toHaveBeenCalledTimes(outcome === 'unknown' ? 1 : 2);
                await relay.reconnected();
                expect(send).toHaveBeenCalledTimes(outcome === 'unknown' ? 1 : 2);
            } finally {
                vi.useRealTimers();
            }
        });

    it('honors Graph rate-limit Retry-After before retrying a definite rejection', async () => {
        const id = (await relay.admitNew(message('graph-rate-limit'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'saved answer');
        vi.useFakeTimers();
        try {
            send.mockRejectedValueOnce(new TeamsOperationError('Graph rate limited', 'graph', 'rate-limited', 'rejected', 30_000));
            await relay.acknowledged(id);
            await vi.advanceTimersByTimeAsync(29_999);
            await relay.reconcile();
            expect(send).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(send).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('marks a send interrupted by restart ambiguous without replaying it', async () => {
        const id = (await relay.admitNew(message('send-in-flight'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        await relay.acknowledged(id);
        finish(id, 'workspace-a', 'saved answer');
        relay.dispose();
        const folder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
        const receipt = path.join(folder, fs.readdirSync(folder)[0]);
        fs.writeFileSync(receipt, JSON.stringify({ ...JSON.parse(fs.readFileSync(receipt, 'utf8')), status: 'sending' }));
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restored.restore();
        expect(JSON.parse(fs.readFileSync(receipt, 'utf8')).status).toBe('ambiguous');
        expect(send).not.toHaveBeenCalled();
        restored.dispose();
    });

    it('treats an empty remote confirmation as ambiguous, not accepted', async () => {
        const id = (await relay.admitNew(message('empty-confirmation'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'saved answer');
        send.mockResolvedValueOnce('');
        await relay.acknowledged(id);
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('sends bounded ordered chunks and never replays a confirmed chunk after a later ambiguous send', async () => {
        const id = (await relay.admitNew(message('long-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        const answer = '<script> & 👩‍💻'.repeat(3500);
        finish(id, 'workspace-a', answer);
        send.mockResolvedValueOnce('accepted').mockRejectedValueOnce(new Error('timeout'));
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledTimes(2);
        for (const [body, root] of send.mock.calls) {
            expect(root).toBe('long-post');
            expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(20_000);
            expect(body).not.toContain('<script>');
        }
        expect(send.mock.calls[0][0]).toContain('Part 1/');
        expect(send.mock.calls[1][0]).toContain('Part 2/');
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('matches overlapping follow-ups to their persisted user turns instead of a mutable process result', async () => {
        const process = {
            id: 'queue_existing', status: 'running', metadata: { workspaceId: 'workspace-a', queueTaskId: 'existing' },
            conversationTurns: [
                { role: 'user', content: 'old prompt', turnIndex: 0 },
                { role: 'assistant', content: 'old answer', turnIndex: 1 },
            ],
            result: 'old answer',
        };
        processes.set(process.id, process);
        const first = message('ask-one');
        const second = message('ask-two');
        let firstRequestId = '';
        let secondRequestId = '';
        await relay.admitFollowUp(first, process as any, async requestId => {
            firstRequestId = requestId;
            process.conversationTurns.push({ role: 'user', content: 'private first', turnIndex: 2, relayRequestId: requestId } as any);
            return {};
        });
        await relay.acknowledgedMessage(first);
        expect(send).not.toHaveBeenCalled();

        await relay.admitFollowUp(second, process as any, async requestId => {
            secondRequestId = requestId;
            process.conversationTurns.push({ role: 'user', content: 'private second', turnIndex: 4, relayRequestId: requestId } as any);
            return {};
        });
        await relay.acknowledgedMessage(second);
        process.conversationTurns.splice(3, 0, { role: 'assistant', content: 'first answer', turnIndex: 3 });
        process.result = 'newer unrelated result';
        tasks.set('follow-1', {
            id: 'follow-1', repoId: 'workspace-a', processId: process.id,
            payload: { relayRequestId: firstRequestId }, status: 'completed',
        } as QueuedTask);
        queue.emit('taskCompleted', tasks.get('follow-1'));
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]).toEqual([expect.stringContaining('first answer'), 'ask-one']);
        process.conversationTurns.push({ role: 'assistant', content: 'second answer', turnIndex: 5 });
        tasks.set('follow-2', {
            id: 'follow-2', repoId: 'workspace-a', processId: process.id,
            payload: { relayRequestId: secondRequestId }, status: 'completed',
        } as QueuedTask);
        queue.emit('taskCompleted', tasks.get('follow-2'));
        await relay.reconcile();
        expect(send.mock.calls[1]).toEqual([expect.stringContaining('second answer'), 'ask-two']);
    });

    it('matches a cancelled follow-up task to its request even if its process has an earlier answer', async () => {
        const process = {
            id: 'queue_previous', status: 'completed',
            metadata: { workspaceId: 'workspace-a', queueTaskId: 'previous' },
            conversationTurns: [
                { role: 'user', content: 'old user', turnIndex: 0 },
                { role: 'assistant', content: 'old answer', turnIndex: 1 },
            ],
        };
        processes.set(process.id, process);
        let requestId = '';
        const msg = message('cancel-follow');
        await relay.admitFollowUp(msg, process as any, async id => {
            requestId = id;
            process.conversationTurns.push({ role: 'user', content: 'new user', turnIndex: 2, relayRequestId: id } as any);
            return { taskId: 'new-follow-task' };
        });
        await relay.acknowledgedMessage(msg);
        tasks.set('new-follow-task', {
            id: 'new-follow-task', repoId: 'workspace-a', processId: process.id,
            payload: { relayRequestId: requestId }, status: 'cancelled',
        } as QueuedTask);
        queue.emit('taskCancelled', tasks.get('new-follow-task'));
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
        expect(send.mock.calls[0]).toEqual([expect.stringContaining('This request was cancelled.'), 'cancel-follow']);
        expect(send.mock.calls[0][0]).not.toContain('old answer');
    });

    it.each([undefined, "You've hit your session limit · resets 7:10pm (UTC)"])('recovers a failed follow-up after queue history is lost (error: %s)', async error => {
        const process = {
            id: 'queue_failed_follow', status: 'running', error,
            metadata: { workspaceId: 'workspace-a', queueTaskId: 'old-task' },
            conversationTurns: [
                { role: 'user', content: 'old request', turnIndex: 0 },
                { role: 'assistant', content: 'old answer', turnIndex: 1 },
            ],
        };
        processes.set(process.id, process);
        const msg = message('failed-follow');
        await relay.admitFollowUp(msg, process as any, async requestId => {
            process.conversationTurns.push({ role: 'user', content: 'new request', turnIndex: 2, relayRequestId: requestId } as any);
            return { taskId: 'lost-history' };
        });
        await relay.acknowledgedMessage(msg);
        process.status = 'failed';
        relay.dispose();
        const restarted = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restarted.restore();
        expect(send).toHaveBeenCalledExactlyOnceWith(
            expect.stringContaining(error ? 'Provider session limit reached. Resets at 7:10pm (UTC).'
                : 'This request could not be completed.'), 'failed-follow',
        );
        expect(send.mock.calls[0][0]).not.toContain('old answer');
        restarted.dispose();
    });

    it('retries only definite non-deliveries with capped attempts', async () => {
        const id = (await relay.admitNew(message('rejected-post'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'recovered answer');
        send.mockRejectedValueOnce(new TeamsMessageNotSentError());
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledTimes(1);
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(1);
        await new Promise(resolve => setTimeout(resolve, 1100));
        await relay.reconcile();
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[1][0]).toContain('recovered answer');
    });

    it('labels an old-chat answer after a rejected send and a repo switch across restart', async () => {
        const id = (await relay.admitNew(message('retry-after-switch'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        const overhead = Buffer.byteLength(formatTeamsOutbound(
            '<p><strong>Request 0123456789 · Part 1/1</strong></p><p></p>', 'html',
        ), 'utf8');
        finish(id, 'workspace-a', 'x'.repeat(TEAMS_ANSWER_MAX_BYTES - overhead));
        send.mockRejectedValueOnce(new TeamsMessageNotSentError());
        await relay.acknowledged(id);
        expect(send.mock.calls[0][0]).not.toContain('Repo A');
        const command = { ...message('switch-after-rejection'), replyToMessageId: 'retry-after-switch' };
        await relay.selectThreadTarget(command, 'workspace-b', null);
        relay.dispose();
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            await new Promise(resolve => setTimeout(resolve, 1100));
            await restored.reconcile();
            expect(send.mock.calls[0][0]).toContain('Part 1/1');
            expect(send.mock.calls[1][0]).toContain('Part 1/2');
            expect(send).toHaveBeenCalledTimes(3);
            expect(send.mock.calls[1][0]).toContain('Repo A · Chat');
            expect(send.mock.calls[2][0]).toContain('Part 2/2');
            expect(send.mock.calls[2][0]).toContain('Repo A · Chat');
            await restored.reconcile();
            expect(send).toHaveBeenCalledTimes(3);
        } finally {
            restored.dispose();
        }
    });

    it('labels a continuation after the first part was confirmed before a repo switch', async () => {
        const root = message('multipart-switch');
        const id = (await relay.admitNew(root, 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'large & answer '.repeat(3_000));
        send.mockImplementationOnce(async () => {
            enabled = false;
            return 'confirmed-first-part';
        });
        await relay.acknowledged(id);
        expect(send).toHaveBeenCalledTimes(1);
        const firstPart = send.mock.calls[0][0] as string;
        expect(firstPart).toContain('Part 1/');
        expect(firstPart).not.toContain('Repo A');
        const partCount = Number(firstPart.match(/Part 1\/(\d+)/)?.[1]);
        expect(partCount).toBeGreaterThan(1);

        enabled = true;
        await relay.selectThreadTarget(
            { ...message('switch-during-multipart'), replyToMessageId: root.messageId },
            'workspace-b', null,
        );
        relay.dispose();
        send.mockRejectedValueOnce(new TeamsMessageNotSentError());
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect(send).toHaveBeenCalledTimes(2);
            expect(send.mock.calls[0][0]).toBe(firstPart);
            expect(send.mock.calls[1][0]).toContain('Repo A · Chat');
            await new Promise(resolve => setTimeout(resolve, 1100));
            await restored.reconcile();
            expect(send).toHaveBeenCalledTimes(partCount + 1);
            expect(send.mock.calls[2][0]).toBe(send.mock.calls[1][0]);
            for (const [index, [body, target]] of send.mock.calls.slice(2).entries()) {
                expect(body).toContain(`Part ${index + 2}/${partCount}`);
                expect(target).toBe(root.messageId);
                expect(body).toContain('Repo A · Chat');
                expect(Buffer.byteLength(formatTeamsOutbound(body, 'html'), 'utf8')).toBeLessThanOrEqual(TEAMS_ANSWER_MAX_BYTES);
            }
            await restored.reconcile();
            expect(send).toHaveBeenCalledTimes(partCount + 1);
        } finally {
            restored.dispose();
        }
    });

    it('labels subsequent parts when the repo switches during an active multipart send', async () => {
        const root = message('switch-while-sending');
        const id = (await relay.admitNew(root, 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'large & answer '.repeat(3_000));
        send.mockImplementationOnce(async () => {
            await relay.selectThreadTarget(
                { ...message('switch-mid-delivery'), replyToMessageId: root.messageId },
                'workspace-b', null,
            );
            return 'accepted-first-part';
        });
        await relay.acknowledged(id);
        expect(send.mock.calls.length).toBeGreaterThan(1);
        expect(send.mock.calls[0][0]).not.toContain('Repo A');
        for (const [part] of send.mock.calls.slice(1)) {
            expect(part).toContain('Repo A · Chat');
            expect(Buffer.byteLength(formatTeamsOutbound(part, 'html'), 'utf8')).toBeLessThanOrEqual(TEAMS_ANSWER_MAX_BYTES);
        }
        await relay.reconcile();
        expect(send.mock.calls.length).toBe(Number((send.mock.calls[0][0] as string).match(/Part 1\/(\d+)/)?.[1]));
    });

    it('labels a previously persisted multipart continuation without replaying confirmed parts', async () => {
        const root = message('older-multipart');
        const id = (await relay.admitNew(root, 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'large & answer '.repeat(3_000));
        send.mockImplementationOnce(async () => {
            enabled = false;
            return 'confirmed-first-part';
        });
        await relay.acknowledged(id);
        const folder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
        const receipt = path.join(folder, fs.readdirSync(folder)[0]);
        const saved = JSON.parse(fs.readFileSync(receipt, 'utf8'));
        delete saved.sourceContext;
        fs.writeFileSync(receipt, JSON.stringify(saved));
        enabled = true;
        await relay.selectThreadTarget(
            { ...message('older-switch'), replyToMessageId: root.messageId }, 'workspace-b', null,
        );
        relay.dispose();
        send.mockRejectedValueOnce(new TeamsMessageNotSentError());
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect(send.mock.calls[1][0]).toContain('Repo A · Chat');
            expect(send.mock.calls[1][0]).toContain('Continuation');
            expect(send).toHaveBeenCalledTimes(2);
            await new Promise(resolve => setTimeout(resolve, 1100));
            await restored.reconcile();
            expect(send.mock.calls[2][0]).toBe(send.mock.calls[1][0]);
            expect(send.mock.calls[3][0]).toContain('Part 2/');
            expect(send.mock.calls[3][1]).toBe(root.messageId);
            const count = send.mock.calls.length;
            await restored.reconcile();
            expect(send).toHaveBeenCalledTimes(count);
        } finally {
            restored.dispose();
        }
    });

    it('labels a legacy continuation when a switch occurs during its first send', async () => {
        const root = message('legacy-mid-send');
        const id = (await relay.admitNew(root, 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a',
                processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'large & answer '.repeat(3_000));
        send.mockRejectedValueOnce(new TeamsMessageNotSentError());
        await relay.acknowledged(id);
        const folder = getRepoDataPath(dataDir, 'workspace-a', 'teams-answer-relay');
        const receipt = path.join(folder, fs.readdirSync(folder)[0]);
        const saved = JSON.parse(fs.readFileSync(receipt, 'utf8'));
        delete saved.sourceContext;
        delete saved.nextAttemptAt;
        saved.status = 'awaiting';
        fs.writeFileSync(receipt, JSON.stringify(saved));
        relay.dispose();

        let restored: TeamsAnswerRelay;
        send.mockImplementationOnce(async () => {
            await restored.selectThreadTarget(
                { ...message('legacy-mid-switch'), replyToMessageId: root.messageId },
                'workspace-b', null,
            );
            return 'confirmed-first';
        });
        restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        try {
            await restored.restore();
            expect(send.mock.calls[1][0]).toContain('Part 1/');
            expect(send.mock.calls[2][0]).toContain('Repo A · Chat');
            expect(send.mock.calls[2][0]).toContain('Continuation');
            expect(send.mock.calls[3][0]).toContain('Part 2/');
            await restored.reconcile();
            expect(send.mock.calls.filter(([part]) => part.includes('Continuation'))).toHaveLength(1);
        } finally {
            restored.dispose();
        }
    });

    it('stops retrying after the finite definite-rejection budget', async () => {
        const id = (await relay.admitNew(message('max-retries'), 'workspace-a', async taskId => {
            tasks.set(taskId, { id: taskId, repoId: 'workspace-a', processId: toQueueProcessId(taskId), status: 'queued' } as QueuedTask);
            return taskId;
        })).taskId;
        finish(id, 'workspace-a', 'saved answer');
        vi.useFakeTimers();
        try {
            send.mockRejectedValue(new TeamsMessageNotSentError());
            await relay.acknowledged(id);
            for (const delay of [1_000, 2_000, 4_000, 8_000]) {
                await vi.advanceTimersByTimeAsync(delay);
            }
            expect(send).toHaveBeenCalledTimes(5);
            await vi.advanceTimersByTimeAsync(120_000);
            expect(send).toHaveBeenCalledTimes(5);
        } finally {
            vi.useRealTimers();
        }
    });

    it('disposes every queue listener and stops future sends', async () => {
        expect(queue.listenerCount('taskCompleted')).toBe(1);
        expect(queue.listenerCount('taskFailed')).toBe(1);
        expect(queue.listenerCount('taskCancelled')).toBe(1);
        relay.dispose();
        for (const event of ['taskCompleted', 'taskFailed', 'taskCancelled']) {
            expect(queue.listenerCount(event)).toBe(0);
        }
        await expect(relay.admitNew(message('after-close'), 'workspace-a', vi.fn())).rejects.toThrow();
    });
});
