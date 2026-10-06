/**
 * AC-04: a mode prefix in a sentinel thread starts a separate handed-off job
 * (WhatsApp and Teams share `createMessagingHandOff`).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, toQueueProcessId, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { createMessagingHandOff, type MessagingHandOff } from '../../../src/server/messaging/job-handoff';
import { prepareIncomingImages } from '../../../src/server/messaging/incoming-images';
import { MessagingJobNotices } from '../../../src/server/messaging/job-notices';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { TeamsCommandRouter, type TeamsCommandRouterDeps } from '../../../src/server/messaging/teams-command-router';
import { TeamsUserStateStore } from '../../../src/server/messaging/teams-user-state';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { createSentinelDelegationEnqueue } from '../../../src/server/delegation/sentinel-delegation-enqueue';
import { DelegatedJobResults } from '../../../src/server/delegation/delegated-job-results';

const GLOBAL = 'global-workspace-00';
const workspaces = [{ id: 'ws-a', name: 'Alpha' }, { id: GLOBAL, name: 'Global' }];
const processes = [
    { id: 'sentinel-a', status: 'completed', metadata: { workspaceId: 'ws-a', mode: 'sentinel' }, startTime: new Date() },
    { id: 'sentinel-g', status: 'completed', metadata: { workspaceId: GLOBAL, mode: 'sentinel' }, startTime: new Date() },
    { id: 'job-a', status: 'completed', metadata: { workspaceId: 'ws-a', mode: 'autopilot' }, startTime: new Date() },
];
const getProcess = async (id: string, workspaceId?: string) =>
    processes.find(proc => proc.id === id && (!workspaceId || proc.metadata.workspaceId === workspaceId));

let dir: string;
let queue: TaskQueueManager;
let notices: MessagingJobNotices;
let handOff: MessagingHandOff;
let enqueueJob: ReturnType<typeof vi.fn>;
let jobs: DelegatedJobStore;

/** Queue tasks the hand-off created (they carry a `messagingOrigin`). */
const handedOff = () => queue.getAll().filter(task => (task.payload as { context?: { messagingOrigin?: unknown } }).context?.messagingOrigin);
const ledger = (workspaceId: string) => {
    const file = path.join(dir, 'repos', workspaceId, 'messaging-job-notices.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ processId: string; origin: unknown }> : [];
};

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'messaging-handoff-'));
    queue = new TaskQueueManager();
    queue.pause();
    const store = { getProcess: vi.fn(getProcess), getWorkspaces: vi.fn(async () => workspaces) };
    notices = new MessagingJobNotices({ dataDir: dir, store: store as never, queue });
    enqueueJob = vi.fn(async (input: CreateTaskInput) => queue.enqueue(input));
    jobs = new DelegatedJobStore(dir);
    const admit = createSentinelDelegationEnqueue({ store, jobs,
        hasTask: id => !!queue.getTask(id), getTask: id => queue.getTask(id) });
    handOff = createMessagingHandOff({ store, queue,
        enqueue: input => input.payload.mode === 'ralph' ? enqueueJob(input) : admit(input, enqueueJob),
        jobNotices: notices });
});
afterEach(() => {
    notices.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('createMessagingHandOff', () => {
    it.each(['completed', 'failed', 'cancelled'] as const)('records a connector command %s outcome for the originating Sentinel', async outcome => {
        const onResult = vi.fn().mockResolvedValue(undefined);
        const results = new DelegatedJobResults({ jobs, queue, onResult,
            store: { getProcess: getProcess as never, getWorkspaces: async () => workspaces as never } });
        try {
            const processId = await handOff.start({ mode: 'autopilot', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'inspect',
                { connector: 'teams', chatKey: 'team', threadId: 'root' });
            const taskId = handedOff()[0].id;
            queue.markStarted(taskId);
            if (outcome === 'completed') queue.markCompleted(taskId, { response: 'Checked the logs.' });
            else if (outcome === 'failed') queue.markFailed(taskId, new Error('Job failed'));
            else queue.cancelTask(taskId);
            await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(1));
            expect(onResult.mock.calls[0][0]).toMatchObject({
                parent: { workspaceId: 'ws-a', processId: 'sentinel-a' },
                child: { workspaceId: 'ws-a', processId }, terminal: { result: { outcome } },
            });
            queue.emit('taskCompleted', queue.getTask(taskId)!);
            await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
            expect(jobs.list('ws-a')).toHaveLength(1);
            expect(onResult.mock.calls[1][0].terminal).toEqual(onResult.mock.calls[0][0].terminal);
        } finally {
            results.dispose();
        }
    });

    it.each(['whatsapp', 'teams'] as const)('durably registers an ordinary %s handoff before queue execution', async connector => {
        const origin = { connector, chatKey: 'original-chat', threadId: 'original-thread' };
        queue.on('taskAdded', task => {
            expect(new DelegatedJobStore(dir).list('ws-a')).toEqual([expect.objectContaining({
                parent: { workspaceId: 'ws-a', processId: 'sentinel-a' },
                child: { workspaceId: 'ws-a', processId: toQueueProcessId(task.id) },
            })]);
        });
        const processId = await handOff.start({ mode: 'ask', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'inspect', origin);
        expect(jobs.list('ws-a')[0].id).toBe(processId);
        expect(jobs.list(GLOBAL)).toEqual([]);
    });

    it('settles rejected command admission without a pending parent review', async () => {
        enqueueJob.mockRejectedValueOnce(new Error('queue full'));
        await expect(handOff.start({ mode: 'autopilot', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'fix',
            { connector: 'whatsapp', chatKey: 'group' })).rejects.toThrow('queue full');
        expect(jobs.list('ws-a')[0].terminal).toMatchObject({ delivery: { state: 'failed' } });
        expect(ledger('ws-a')).toEqual([]);
    });

    it('retains registered image handoff identity after an accepted observer failure', async () => {
        const images = await prepareIncomingImages(dir, 'ws-a', [{ mimeType: 'image/png',
            download: async () => Buffer.from('89504e470d0a1a0a010203', 'hex') }]);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        queue.on('taskAdded', () => { throw new Error('observer failed'); });
        const processId = await handOff.start({ mode: 'ask', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'inspect',
            { connector: 'teams', chatKey: 'team', threadId: 'root' }, { taskId: 'reserved', images });
        expect(processId).toBe(toQueueProcessId('reserved'));
        expect(jobs.list('ws-a')).toHaveLength(1);
        expect(jobs.list('ws-a')[0].terminal).toBeUndefined();
        expect(fs.existsSync(images.imageTempDir!)).toBe(true);
        error.mockRestore();
    });

    it('hands off only non-sentinel prefixes to a sentinel, in the sentinel workspace', async () => {
        expect(await handOff.resolve('sentinel-a', 'autopilot')).toEqual({ mode: 'autopilot', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' });
        expect(await handOff.resolve('sentinel-g', 'ralph')).toEqual({ mode: 'ralph', workspaceId: GLOBAL, parentProcessId: 'sentinel-g' });
        expect(await handOff.resolve('sentinel-a', 'sentinel')).toBeUndefined();
        expect(await handOff.resolve('sentinel-a', undefined)).toBeUndefined();
        expect(await handOff.resolve('job-a', 'ask')).toBeUndefined();
        expect(await handOff.resolve('missing', 'ask')).toBeUndefined();
        expect(await handOff.resolve(null, 'ask')).toBeUndefined();
    });

    it('treats a sentinel first turn still in the queue as the target', async () => {
        const queued = queue.enqueue({ type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
            payload: { kind: 'chat', mode: 'sentinel', prompt: 'hi', workspaceId: 'ws-a' } });
        const processId = toQueueProcessId(queued);
        expect(await handOff.resolve(processId, 'ask')).toEqual({ mode: 'ask', workspaceId: 'ws-a', parentProcessId: processId });
        const ask = queue.enqueue({ type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
            payload: { kind: 'chat', mode: 'ask', prompt: 'hi', workspaceId: 'ws-a' } });
        expect(await handOff.resolve(toQueueProcessId(ask), 'autopilot')).toBeUndefined();
    });

    it('enqueues the job with its spawn link and origin, and tracks its notices', async () => {
        const origin = { connector: 'whatsapp' as const, chatKey: 'group@g.us' };
        const processId = await handOff.start({ mode: 'autopilot', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'add a comment', origin);
        const [task] = handedOff();
        expect(processId).toBe(toQueueProcessId(task.id));
        expect(task).toMatchObject({ type: 'chat', repoId: 'ws-a', payload: {
            kind: 'chat', mode: 'autopilot', prompt: 'add a comment', workspaceId: 'ws-a',
            context: { spawnedFromProcessId: 'sentinel-a', messagingOrigin: origin },
        } });
        expect(ledger('ws-a')).toEqual([expect.objectContaining({ processId, origin })]);
    });

    it.each(['workspace', 'parent', 'directory', 'origin'])('rejects observer reconciliation for a mismatched %s', async field => {
        const images = await prepareIncomingImages(dir, 'ws-a', [{ mimeType: 'image/png',
            download: async () => Buffer.from('89504e470d0a1a0a010203', 'hex') }]);
        const track = vi.fn();
        const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mismatched = createMessagingHandOff({ store: { getProcess }, queue, jobNotices: { track }, enqueue: async input => {
            const bad = { ...input, payload: { ...input.payload, context: { ...input.payload.context } } };
            if (field === 'workspace') bad.repoId = 'ws-other';
            if (field === 'parent') bad.payload.context.spawnedFromProcessId = 'other-parent';
            if (field === 'directory') bad.payload.imageTempDir = 'other-files';
            if (field === 'origin') bad.payload.context.messagingOrigin = { connector: 'whatsapp', chatKey: 'other-group' };
            queue.enqueue(bad); throw new Error('observer failed');
        } });
        await expect(mismatched.start({ mode: 'ask', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'inspect',
            { connector: 'whatsapp', chatKey: 'group' }, { taskId: 'reserved', images })).rejects.toThrow('observer failed');
        expect(track).not.toHaveBeenCalled(); errorLog.mockRestore();
    });

    it('keeps an enqueued job when notice tracking fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        handOff = createMessagingHandOff({ store: { getProcess: vi.fn(getProcess) }, queue, enqueue: enqueueJob,
            jobNotices: { track: () => { throw new Error('disk full'); } } });
        await expect(handOff.start({ mode: 'ask', workspaceId: 'ws-a', parentProcessId: 'sentinel-a' }, 'q',
            { connector: 'teams', chatKey: 'team\0ch' })).resolves.toMatch(/^queue_/);
        expect(handedOff()).toHaveLength(1);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});

describe('WhatsApp sentinel hand-off', () => {
    let bindings: WhatsAppBindings;
    let enqueue: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    let router: WhatsAppCommandRouter;
    const inbound = (text: string, id: string, patch: Partial<InboundWAMessage> = {}): InboundWAMessage => ({
        chatJid: 'group@g.us', senderJid: 'group@g.us', participantJid: 'self@s.whatsapp.net',
        fromMe: true, messageId: id, text, ...patch,
    });

    beforeEach(async () => {
        const store = {
            getWorkspaces: vi.fn(async () => workspaces),
            getAllProcesses: vi.fn(async () => []),
            getProcess: vi.fn(getProcess),
        } as unknown as WhatsAppRouterDeps['store'];
        bindings = new WhatsAppBindings(dir);
        await bindings.restore(store);
        // Ordinary messages: new chats start as sentinel, like the server wiring.
        enqueue = vi.fn(async (workspaceId, prompt, mode, processId, id) => queue.enqueue({
            id, repoId: workspaceId, processId, type: 'chat', priority: 'normal', config: {},
            payload: { kind: 'chat', workspaceId, prompt, mode: mode ?? 'sentinel', relayRequestId: id },
        }));
        react = vi.fn().mockResolvedValue(undefined);
        send = vi.fn().mockResolvedValue('outbound');
        router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => 'group@g.us', enqueue, send, react, handOff,
            getTask: id => queue.getTask(id),
        });
        bindings.selectRepo('ws-a');
        bindings.selectTopic('ws-a', 'sentinel-a');
    });

    it('starts a separate job for a mode prefix, keeping the sentinel selected', async () => {
        await router.handle(inbound('/autopilot add a comment to README', 'm1'));
        expect(enqueue).not.toHaveBeenCalled();
        const [job] = handedOff();
        expect(job.payload).toMatchObject({ mode: 'autopilot', prompt: 'add a comment to README', workspaceId: 'ws-a',
            context: { spawnedFromProcessId: 'sentinel-a', messagingOrigin: { connector: 'whatsapp', chatKey: 'group@g.us' } } });
        expect(ledger('ws-a').map(row => row.processId)).toEqual([toQueueProcessId(job.id)]);
        expect(react).toHaveBeenCalledWith('m1');
        expect(send).not.toHaveBeenCalled();
        expect(bindings.topic('ws-a')).toBe('sentinel-a');

        // A redelivered message does not start a second job.
        await router.handle(inbound('/autopilot add a comment to README', 'm1'));
        expect(handedOff()).toHaveLength(1);
    });

    it.each(['/ask', '/ralph'])('hands off %s too', async prefix => {
        await router.handle(inbound(`${prefix} look into it`, 'm1'));
        expect(handedOff()[0].payload).toMatchObject({ mode: prefix.slice(1), prompt: 'look into it' });
    });

    it('sends plain and /sentinel messages to the sentinel', async () => {
        await router.handle(inbound('what is running?', 'm1'));
        await router.handle(inbound('/sentinel and now?', 'm2'));
        expect(enqueue.mock.calls.map(call => [call[1], call[2], call[3]])).toEqual([
            ['what is running?', undefined, 'sentinel-a'],
            ['and now?', 'sentinel', 'sentinel-a'],
        ]);
        expect(handedOff()).toHaveLength(0);
    });

    it('continues the job, not a new hand-off, when replying to its notice with a prefix', async () => {
        bindings.recordNotice({ groupJid: 'group@g.us', workspaceId: 'ws-a', processId: 'job-a' }, 'notice-1');
        await router.handle(inbound('/ask why?', 'm1', { quotedMessageId: 'notice-1' }));
        expect(enqueue).toHaveBeenCalledWith('ws-a', 'why?', 'ask', 'job-a', expect.any(String), undefined);
        expect(handedOff()).toHaveLength(0);
        expect(bindings.topic('ws-a')).toBe('sentinel-a');
    });

    it('hands off from a sentinel whose first turn is still queued', async () => {
        bindings.selectTopic('ws-a', null);
        await router.handle(inbound('hello', 'm1'));
        const sentinel = bindings.topic('ws-a')!;
        expect(sentinel).toMatch(/^queue_/);
        await router.handle(inbound('/autopilot fix it', 'm2'));
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(handedOff()[0].payload).toMatchObject({ mode: 'autopilot', context: { spawnedFromProcessId: sentinel } });
        expect(bindings.topic('ws-a')).toBe(sentinel);
        expect(jobs.list('ws-a')[0]).toMatchObject({ parent: { processId: sentinel },
            child: { processId: toQueueProcessId(handedOff()[0].id) } });
    });

    it('hands off from a Global sentinel into Global', async () => {
        bindings.selectRepo(GLOBAL);
        bindings.selectTopic(GLOBAL, 'sentinel-g');
        await router.handle(inbound('/autopilot tidy up', 'm1'));
        expect(handedOff()[0]).toMatchObject({ repoId: GLOBAL, payload: { workspaceId: GLOBAL } });
        expect(ledger(GLOBAL)).toHaveLength(1);
    });

    it('asks for a message when the prefix has no body', async () => {
        await router.handle(inbound('/autopilot', 'm1'));
        expect(send).toHaveBeenCalledWith('Send a message to start a chat.', 'm1');
        expect(handedOff()).toHaveLength(0);
    });

    it('replies with the queue error when the hand-off cannot be enqueued', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        enqueueJob.mockRejectedValueOnce(new Error('queue full'));
        await router.handle(inbound('/autopilot fix it', 'm1'));
        expect(send).toHaveBeenCalledWith('Could not queue the request. Please try again.', 'm1');
        expect(ledger('ws-a')).toHaveLength(0);
        error.mockRestore();
    });
});

describe('Teams sentinel hand-off', () => {
    let deps: TeamsCommandRouterDeps;
    let reply: ReturnType<typeof vi.fn>;
    const origin = (msg: InboundTeamsMessage) => ({ connector: 'teams' as const, chatKey: `team\0${msg.channelId}`,
        threadId: msg.replyToMessageId || msg.messageId });
    const msg = (text: string, patch: Partial<InboundTeamsMessage> = {}): InboundTeamsMessage => ({
        channelId: 'ch-1', messageId: `msg-${Math.random().toString(36).slice(2, 8)}`, text,
        senderAadId: 'user-1', senderName: 'User', ...patch,
    });
    const router = () => new TeamsCommandRouter(deps);

    beforeEach(() => {
        reply = vi.fn().mockResolvedValue(undefined);
        deps = {
            store: { getWorkspaces: vi.fn(async () => workspaces), getAllProcesses: vi.fn(async () => []), getProcess: vi.fn(getProcess) } as never,
            enqueueChat: vi.fn().mockResolvedValue('task-new'),
            executeFollowUp: vi.fn().mockResolvedValue(undefined),
            sendReply: reply,
            dataDir: dir,
            handOff,
            handOffOrigin: origin,
        };
        new TeamsUserStateStore(dir).update('user-1', { selectedRepo: 'ws-a', selectedTopic: 'sentinel-a' });
    });

    it('starts a separate job from the selected sentinel, keeping the selection', async () => {
        const message = msg('/autopilot add a comment');
        await router().handle(message);
        expect(deps.executeFollowUp).not.toHaveBeenCalled();
        expect(handedOff()[0].payload).toMatchObject({ mode: 'autopilot', prompt: 'add a comment',
            context: { spawnedFromProcessId: 'sentinel-a', messagingOrigin: origin(message) } });
        expect(ledger('ws-a')).toHaveLength(1);
        expect(reply).toHaveBeenCalledWith('🚀 Started a separate autopilot job. A notice follows when it finishes.', message.messageId);
        expect(new TeamsUserStateStore(dir).get('user-1')).toMatchObject({ selectedTopic: 'sentinel-a', lastActiveTopic: null });

        await router().handle(msg('plain question'));
        await router().handle(msg('/sentinel routed question'));
        expect(deps.executeFollowUp).toHaveBeenNthCalledWith(1, 'sentinel-a', 'plain question', undefined);
        expect(deps.executeFollowUp).toHaveBeenNthCalledWith(2, 'sentinel-a', 'routed question', 'sentinel');
        expect(handedOff()).toHaveLength(1);
    });

    it('hands off an explicit [chatid] message to a sentinel, but continues other chats', async () => {
        await router().handle(msg('/ask [sentinel-a] check the logs'));
        expect(handedOff()[0].payload).toMatchObject({ mode: 'ask', prompt: 'check the logs' });
        await router().handle(msg('/ask [job-a] why?'));
        expect(deps.executeFollowUp).toHaveBeenCalledWith('job-a', 'why?', 'ask');
        expect(handedOff()).toHaveLength(1);
    });

    it('asks for a message when the prefix has no body', async () => {
        const message = msg('/autopilot');
        await router().handle(message);
        expect(reply).toHaveBeenCalledWith('❌ Send a message to start a chat.', message.messageId);
        expect(handedOff()).toHaveLength(0);
    });

    describe('bound threads', () => {
        const commands = new Set<string>();
        beforeEach(() => {
            commands.clear();
            deps.isAnswerRelayEnabled = () => true;
            deps.admitFollowUp = vi.fn().mockResolvedValue({ duplicate: false });
            deps.admitPendingFollowUp = vi.fn().mockResolvedValue({ duplicate: false });
            deps.acknowledgeFollowUp = vi.fn().mockResolvedValue(undefined);
            deps.hasThreadCommand = m => commands.has(m.messageId);
            deps.recordThreadCommand = m => { commands.add(m.messageId); };
            deps.resolveThreadReply = vi.fn(async (m: InboundTeamsMessage) => m.replyToMessageId === 'root-s'
                ? { process: processes[0] as never, workspaceId: 'ws-a' }
                : { taskId: queuedSentinel, workspaceId: 'ws-a' });
        });
        let queuedSentinel = '';

        it('hands off in a sentinel thread, replies in the thread, and ignores a redelivery', async () => {
            const message = msg('/ralph build the thing', { replyToMessageId: 'root-s' });
            await router().handle(message);
            await router().handle(message);
            expect(deps.admitFollowUp).not.toHaveBeenCalled();
            expect(handedOff()).toHaveLength(1);
            expect(handedOff()[0].payload).toMatchObject({ mode: 'ralph',
                context: { messagingOrigin: { connector: 'teams', chatKey: 'team\0ch-1', threadId: 'root-s' } } });
            expect(reply).toHaveBeenCalledWith('🚀 Started a separate ralph job. A notice follows when it finishes.', 'root-s');

            await router().handle(msg('keep going', { replyToMessageId: 'root-s' }));
            expect(deps.admitFollowUp).toHaveBeenCalledWith(expect.anything(), processes[0], 'keep going', undefined);
        });

        it('hands off from a thread whose sentinel is still queued', async () => {
            queuedSentinel = queue.enqueue({ type: 'chat', repoId: 'ws-a', priority: 'normal', config: {},
                payload: { kind: 'chat', mode: 'sentinel', prompt: 'hi', workspaceId: 'ws-a' } });
            await router().handle(msg('/autopilot go', { replyToMessageId: 'root-q' }));
            expect(deps.admitPendingFollowUp).not.toHaveBeenCalled();
            expect(handedOff()[0].payload).toMatchObject({ context: { spawnedFromProcessId: toQueueProcessId(queuedSentinel) } });
            expect(jobs.list('ws-a')[0].parent.processId).toBe(toQueueProcessId(queuedSentinel));
        });

        it('asks for a message when the prefix has no body', async () => {
            await router().handle(msg('/ask', { replyToMessageId: 'root-s' }));
            expect(reply).toHaveBeenCalledWith('❌ Send a message to start a chat.', 'root-s');
            expect(handedOff()).toHaveLength(0);
        });
    });
});
