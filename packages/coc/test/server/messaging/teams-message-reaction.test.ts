import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsMessagingManager } from '../../../src/server/messaging/teams-messaging-manager';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';

describe('Teams channel Like admission', () => {
    let dataDir: string;
    let manager: TeamsMessagingManager;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-reaction-'));
    });

    afterEach(() => {
        manager?.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function setup(relay = false) {
        let enabled = false;
        const events: string[] = [];
        const tasks = new Map<string, QueuedTask>();
        const queue = Object.assign(new EventEmitter(), { getTask: (id: string) => tasks.get(id) });
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: 'global-workspace-00', name: 'Global', rootPath: dataDir }]),
            getProcess: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProcessStore;
        manager = new TeamsMessagingManager(dataDir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId: 'team-a', channelId: 'channel-a',
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        });
        const react = vi.spyOn(manager, 'reactToChannelMessage').mockImplementation(async msg => {
            events.push(`like:${msg.messageId}`);
        });
        const send = vi.spyOn(manager, 'sendMessage').mockImplementation(async (text, target) => {
            events.push(`reply:${target ?? 'channel'}:${text}`);
            return 'outbound-id';
        });
        let handle!: (msg: InboundTeamsMessage) => Promise<void>;
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(callback => {
            handle = msg => callback(msg, () => {});
        });
        const enqueue = vi.fn(async (_workspaceId: string, _text: string) => {
            events.push('enqueue');
            return 'task-a';
        });
        registerTeamsMessagingRoutes([], {
            dataDir, manager, store, enqueueChat: enqueue, executeFollowUp: vi.fn(),
            getMessageReactionEnabled: () => enabled,
            ...(relay ? {
                relayQueue: queue,
                getAnswerRelayEnabled: () => true,
                admitRelayFollowUp: vi.fn().mockResolvedValue({}),
                enqueueRelayChat: async (workspaceId: string, _text: string, taskId: string) => {
                    events.push('enqueue');
                    tasks.set(taskId, {
                        id: taskId, repoId: workspaceId, processId: toQueueProcessId(taskId), status: 'queued',
                        type: 'chat', payload: { kind: 'chat', workspaceId },
                    } as QueuedTask);
                    return taskId;
                },
                enqueuePendingRelayFollowUp: async (_ws: string, _process: string, _text: string, _request: string, _mode: unknown, taskId?: string) => {
                    events.push('enqueue-follow-up');
                    if (!taskId) throw new Error('Expected reserved pending task ID');
                    return taskId;
                },
            } : {}),
        });
        const message = (messageId: string, text: string, replyToMessageId?: string): InboundTeamsMessage => ({
            channelId: 'channel-a', messageId, text, senderAadId: 'human',
            ...(replyToMessageId ? { replyToMessageId } : {}),
        });
        return { handle, message, react, send, events, enqueue, setEnabled: (value: boolean) => { enabled = value; } };
    }

    it('is live and default off; preserves command and chat replies while reacting before dispatch', async () => {
        const { handle, message, react, send, events, setEnabled } = setup();
        await handle(message('off', '/list repos'));
        expect(react).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledOnce();
        events.length = 0;
        setEnabled(true);
        await handle(message('command', '/list repos'));
        expect(events[0]).toBe('like:command');
        expect(events[1]).toContain('reply:command:');
        events.length = 0;
        await handle(message('chat', 'new request'));
        expect(events).toEqual([
            'like:chat', 'enqueue', expect.stringContaining('reply:chat:'),
        ]);
        setEnabled(false);
        await handle(message('off-again', '/list repos'));
        expect(react).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenCalledTimes(4);
    });

    it('reacts to an admitted tracked thread reply, not its parent, and skips durable duplicates', async () => {
        const { handle, message, react, events, setEnabled } = setup(true);
        setEnabled(true);
        await handle(message('root', 'new request'));
        events.length = 0;
        await handle(message('unbound', 'unbound follow-up', 'missing-root'));
        expect(react).toHaveBeenCalledTimes(1);
        events.length = 0;
        await handle(message('follow', 'follow-up', 'root'));
        expect(events).toEqual(['like:follow', 'enqueue-follow-up']);
        expect(react.mock.calls.map(([msg]) => msg.messageId)).toEqual(['root', 'follow']);
        events.length = 0;
        await handle(message('root', 'new request'));
        await handle(message('follow', 'follow-up', 'root'));
        expect(events).toEqual([]);
        expect(react).toHaveBeenCalledTimes(2);
    });

    it('does not react to bot authors, empty posts, or unsupported thread replies', async () => {
        const { handle, message, react, events, setEnabled } = setup();
        setEnabled(true);
        await handle({ ...message('bot', '/list repos'), botAuthored: true });
        await handle(message('empty', '   '));
        await handle(message('thread', 'follow-up', 'root'));
        expect(react).not.toHaveBeenCalled();
        expect(events.some(event => event.startsWith('reply:'))).toBe(true);
    });

    it('routes initial tracked-thread replies without reacting to historical posts', async () => {
        const { handle, message, react, events, setEnabled } = setup(true);
        setEnabled(true);
        await handle(message('root', 'new request'));
        events.length = 0;
        await handle({ ...message('historical', 'follow-up', 'root'), initializationReplay: true });
        expect(react).toHaveBeenCalledTimes(1);
        expect(events).toEqual(['enqueue-follow-up']);
    });

    it('logs a rejected Like and still dispatches, replies, and processes the next post', async () => {
        const { handle, message, react, events, setEnabled } = setup();
        setEnabled(true);
        react.mockRejectedValueOnce(new Error('private provider details'));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await handle(message('first', '/list repos'));
            await handle(message('second', 'another request'));
            expect(react).toHaveBeenCalledTimes(2);
            expect(events.some(event => event.startsWith('reply:first:'))).toBe(true);
            expect(events).toContain('enqueue');
            expect(errors).toHaveBeenCalledWith(
                '[teams-messaging] Teams Like reaction unavailable or failed:', 'Error',
            );
            expect(errors.mock.calls.flat().join(' ')).not.toContain('private provider details');
            react.mockRejectedValueOnce(new Error(
                'Teams channel Like reaction unavailable: IC3 credential could not be acquired',
            ));
            await handle(message('unavailable', '/list repos'));
            expect(events.some(event => event.startsWith('reply:unavailable:'))).toBe(true);
            expect(errors).toHaveBeenCalledWith(
                '[teams-messaging] Teams Like reaction unavailable or failed:',
                'Teams channel Like reaction unavailable: IC3 credential could not be acquired',
            );
            react.mockRejectedValueOnce(Object.assign(new Error('private authorization response'), { status: 401 }));
            await handle(message('unauthorized', '/list repos'));
            expect(events.some(event => event.startsWith('reply:unauthorized:'))).toBe(true);
            expect(errors).toHaveBeenCalledWith(
                '[teams-messaging] Teams Like reaction unavailable or failed:', 'Error (HTTP 401)',
            );
            expect(errors.mock.calls.flat().join(' ')).not.toContain('private authorization response');
        } finally {
            errors.mockRestore();
        }
    });

    it('dispatches and accepts subsequent messages without waiting for a slow Like', async () => {
        const { handle, message, react, enqueue, send, setEnabled } = setup();
        setEnabled(true);
        let finishLike!: () => void;
        react.mockImplementationOnce(() => new Promise<void>(resolve => { finishLike = resolve; }));
        try {
            await handle(message('slow-like', 'new request'));
            expect(enqueue).toHaveBeenCalledOnce();
            expect(send).toHaveBeenCalledOnce();
            await handle(message('next-command', '/list repos'));
            expect(react).toHaveBeenCalledTimes(2);
            expect(send).toHaveBeenCalledTimes(2);
        } finally {
            finishLike?.();
        }
    });

    it('logs a late Like rejection without failing admission or leaking provider details', async () => {
        const { handle, message, react, enqueue, setEnabled } = setup();
        setEnabled(true);
        let rejectLike!: (error: Error) => void;
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        react.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectLike = reject; }));
        try {
            await handle(message('late-like', 'new request'));
            expect(enqueue).toHaveBeenCalledOnce();
            rejectLike(new Error('private provider details'));
            await Promise.resolve();
            expect(errors).toHaveBeenCalledWith(
                '[teams-messaging] Teams Like reaction unavailable or failed:', 'Error',
            );
            expect(errors.mock.calls.flat().join(' ')).not.toContain('private provider details');
        } finally {
            errors.mockRestore();
        }
    });
});
