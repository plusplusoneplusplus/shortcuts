import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import { TeamsAnswerRelay } from '../../../src/server/messaging/teams-answer-relay';
import { TeamsCommandRouter } from '../../../src/server/messaging/teams-command-router';
import { TeamsMessageNotSentError } from '../../../src/server/messaging/teams-messaging-manager';
import { getRepoDataPath } from '../../../src/server/paths';

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
            tasks.set(id, { id, repoId: 'workspace-a', processId: toQueueProcessId(id), status: 'queued' } as QueuedTask);
            return id;
        });
        const reply = {
            ...message('reply-cursor'), replyToMessageId: 'root-cursor',
            createdDateTime: '2026-01-01T00:00:00Z',
        };
        await relay.admitPendingFollowUp(reply, root.taskId, async () => 'followup-task');
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
            text: send.mock.calls[0][0] as string };
        relay.dispose();
        const restored = new TeamsAnswerRelay({
            dataDir, store, queue, isEnabled: () => enabled,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        await restored.restore();
        expect(restored.isOwnReply('team-1', outbound)).toBe(true);
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
        expect(ack.mock.calls[0][0]).toContain('unavailable');
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

    it('quarantines a corrupt receipt without sending or rerouting its answer', async () => {
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
        await restored.restore();
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

    it('recovers the last failed follow-up from persisted process status after queue history is lost', async () => {
        const process = {
            id: 'queue_failed_follow', status: 'running',
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
            expect.stringContaining('This request could not be completed.'), 'failed-follow',
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
