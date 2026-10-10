import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessStore, QueuedTask } from '@plusplusoneplusplus/forge';
import { MessagingJobNotices, type MessagingJobOrigin } from '../../../src/server/messaging/job-notices';
import { createAutoCompactionOrigins, triggeringRequestId } from '../../../src/server/messaging/auto-compaction-origins';
import { WhatsAppBindings, type WhatsAppBinding } from '../../../src/server/messaging/whatsapp-bindings';
import { WhatsAppAnswerRelay, createWhatsAppNoticeTransport } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppNotConnectedError } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { getRepoDataPath } from '../../../src/server/paths';

const WS = 'ws-a';
const PROC = 'sentinel-proc';
const GROUP = 'group@g.us';
const TASK = 'auto-1';
const SUMMARY = 'SECRET SUMMARY with system prompt and tool output';

type Queue = EventEmitter & { getTask: (id: string) => QueuedTask | undefined; getAll: () => QueuedTask[] };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0)); };

describe('automatic compaction WhatsApp notices', () => {
    let dataDir: string;
    let processes: Map<string, any>;
    let tasks: QueuedTask[];
    let queue: Queue;
    let store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
    let bindings: WhatsAppBindings;
    let group: string | null;
    let online: boolean;
    let sent: Array<{ text: string; quoted?: string }>;
    let sendImpl: ((text: string, quoted?: string) => Promise<string>) | undefined;
    let delivering: Set<string>;
    let mirror: { locate: ReturnType<typeof vi.fn>; authorize: ReturnType<typeof vi.fn> } | undefined;
    let hubs: MessagingJobNotices[];

    const proc = (extra: Record<string, any> = {}, metadata: Record<string, any> = {}) => processes.set(PROC, {
        id: PROC, status: 'completed', title: 'Dispatch',
        conversationTurns: [
            { role: 'user', turnIndex: 0, content: 'hello', relayRequestId: 'req-1' },
            { role: 'assistant', turnIndex: 1, content: 'Answer one' },
        ],
        ...extra,
        metadata: {
            type: 'chat', workspaceId: WS, mode: 'sentinel', queueTaskId: 'req-1',
            autoCompact: { enabled: true, thresholdTokens: 1000, lastEvaluatedTurnIndex: 1 },
            compaction: { taskId: TASK, state: 'queued' },
            ...metadata,
        },
    });
    const setCompaction = (compaction: Record<string, unknown>, autoCompact?: Record<string, unknown>) => {
        const current = processes.get(PROC);
        current.metadata = { ...current.metadata, compaction: { taskId: TASK, ...compaction },
            ...(autoCompact ? { autoCompact: { ...current.metadata.autoCompact, ...autoCompact } } : {}) };
    };
    const binding = (extra: Partial<WhatsAppBinding> = {}): WhatsAppBinding => {
        const row: WhatsAppBinding = { groupJid: GROUP, workspaceId: WS, processId: PROC, taskId: 'req-1',
            inboundId: 'in-1', outboundIds: ['answer-1'], nextPart: 1, status: 'delivered', ...extra };
        bindings.add(row);
        return row;
    };
    const autoTask = (status: QueuedTask['status'] = 'queued', extra: Record<string, unknown> = {}): QueuedTask => {
        const task = { id: TASK, repoId: WS, processId: PROC, type: 'chat', status,
            payload: { kind: 'compact', processId: PROC, workspaceId: WS, trigger: 'auto', ...extra } } as unknown as QueuedTask;
        tasks.splice(0, tasks.length, ...tasks.filter(t => t.id !== TASK), task);
        return task;
    };
    const emit = (event: string, task: QueuedTask, status?: QueuedTask['status']) => {
        if (status) task.status = status;
        queue.emit(event, task);
    };
    const makeHub = () => {
        const origins = createAutoCompactionOrigins({
            bindings, whatsappGroup: () => group, isDeliveringAnswer: id => delivering.has(id), mirror: mirror as never,
        });
        const hub = new MessagingJobNotices({
            dataDir, store, queue,
            locateAutoCompactionOrigin: (p, turnIndex) => origins.locate(p, turnIndex),
            authorizeAutoCompactionOrigin: (origin, owner) => origins.authorize(origin, owner),
        });
        hub.register(createWhatsAppNoticeTransport({
            bindings, connected: () => online, groupJid: () => group,
            send: async (text, quoted) => {
                if (sendImpl) return sendImpl(text, quoted);
                sent.push({ text, quoted });
                return `out-${sent.length}`;
            },
        }));
        hubs.push(hub);
        return hub;
    };
    const ledger = () => JSON.parse(fs.readFileSync(getRepoDataPath(dataDir, WS, 'messaging-job-notices.json'), 'utf8'));
    const texts = () => sent.map(entry => entry.text);

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-compact-notices-'));
        processes = new Map();
        tasks = [];
        queue = Object.assign(new EventEmitter(), {
            getTask: (id: string) => tasks.find(task => task.id === id),
            getAll: () => tasks,
        });
        store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: WS, name: 'Alpha' }]),
            getProcess: vi.fn(async (id: string, workspaceId?: string) => {
                const p = processes.get(id);
                return p && (!workspaceId || p.metadata?.workspaceId === workspaceId) ? p : undefined;
            }),
        } as unknown as typeof store;
        bindings = new WhatsAppBindings(dataDir);
        group = GROUP;
        online = true;
        sent = [];
        sendImpl = undefined;
        delivering = new Set();
        mirror = undefined;
        hubs = [];
    });

    afterEach(() => {
        for (const hub of hubs) hub.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('posts a start notice when execution begins, then the outcome counts without the summary', async () => {
        proc();
        binding();
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        await flush();
        expect(sent).toEqual([]); // Admission alone is not a start.
        emit('taskStarted', task, 'running');
        await flush();
        setCompaction({ state: 'completed', messagesRemoved: 12, tokensRemoved: 4300, summary: SUMMARY },
            { lastResult: { outcome: 'succeeded', at: 'now', turnIndex: 1 } });
        processes.get(PROC).conversationTurns.push({ role: 'assistant', turnIndex: 2, displayOnly: true,
            content: 'Context compacted — removed 12 messages, freed ~4300 tokens', compactionSummary: SUMMARY });
        emit('taskCompleted', task, 'completed');
        await flush();
        expect(texts()).toEqual([
            'Alpha · Dispatch · Auto-compaction · ⏳\nCompacting context automatically. New messages will wait until it finishes.',
            'Alpha · Dispatch · Auto-compaction · ✅\nContext compacted automatically — removed 12 messages, freed ~4300 tokens.',
        ]);
        expect(JSON.stringify(sent)).not.toContain('SECRET');
        // The original answer receipt is untouched; notices get their own bindings.
        const answer = bindings.entries().find(row => row.taskId === 'req-1')!;
        expect(answer).toMatchObject({ status: 'delivered', outboundIds: ['answer-1'], inboundId: 'in-1' });
        expect(bindings.entries().filter(row => row.notice).map(row => row.inboundId)).toEqual(['out-1', 'out-2']);
    });

    it('reports insufficient compaction and pause after repeated failures', async () => {
        proc();
        binding();
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        await flush();
        setCompaction({ state: 'completed', messagesRemoved: 1, tokensRemoved: 10 },
            { lastResult: { outcome: 'insufficient', at: 'now', turnIndex: 1 }, paused: { reason: 'failures', at: 'now' } });
        emit('taskCompleted', task, 'completed');
        await flush();
        expect(texts()).toEqual(['Alpha · Dispatch · Auto-compaction · ✅\nContext compacted automatically — removed 1 message, freed ~10 tokens.'
            + ' Context is still above the auto-compact threshold. Auto-compact is paused after repeated failures.']);
    });

    it.each([
        ['failed', { outcome: 'failed' }, 'Automatic compaction failed. Waiting messages will continue.'],
        ['unsupported', { outcome: 'unsupported' }, 'Automatic compaction is not supported for this provider and is paused. Waiting messages will continue.'],
    ] as const)('posts a fixed %s outcome without the raw provider error', async (_name, result, detail) => {
        proc();
        binding();
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        emit('taskStarted', task, 'running');
        await flush();
        setCompaction({ state: 'failed', error: 'provider stack trace token=abc' },
            { lastResult: { ...result, at: 'now', turnIndex: 1, error: 'provider stack trace token=abc' } });
        emit('taskFailed', task, 'failed');
        await flush();
        expect(texts()).toEqual([
            expect.stringContaining('Compacting context automatically'),
            `Alpha · Dispatch · Auto-compaction · ❌\n${detail}`,
        ]);
        expect(JSON.stringify(sent)).not.toContain('token=abc');
    });

    it('never claims a queued compaction ran when it is cancelled before starting', async () => {
        proc();
        binding();
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        setCompaction({ state: 'cancelled' });
        emit('taskCancelled', task, 'cancelled');
        emit('taskCancelled', task, 'cancelled'); // Repeated lifecycle events are deduplicated.
        await flush();
        expect(texts()).toEqual(['Alpha · Dispatch · Auto-compaction · ⏹\n'
            + 'Queued automatic compaction was cancelled before it started. Waiting messages will continue.']);
    });

    it('holds the start notice until the triggering answer is relayed, keeping the answer first', async () => {
        proc();
        const answer = binding({ status: 'queued', outboundIds: [], nextPart: 0 });
        const chatTask = { id: 'req-1', repoId: WS, processId: PROC, type: 'chat', status: 'completed',
            payload: { kind: 'chat', processId: PROC, workspaceId: WS, relayRequestId: 'req-1' } } as unknown as QueuedTask;
        tasks.push(chatTask);
        const hub = makeHub();
        const relay = new WhatsAppAnswerRelay({
            bindings, store, queue, connected: () => online, groupJid: () => group,
            send: async (text, quoted) => { sent.push({ text, quoted }); return `out-${sent.length}`; },
            onSettled: () => { void hub.reconcile('whatsapp'); },
        });
        try {
            const task = autoTask();
            emit('taskAdded', task);
            emit('taskStarted', task, 'running');
            await flush();
            expect(sent).toEqual([]); // Waiting behind the undelivered answer.
            queue.emit('taskCompleted', chatTask);
            await flush();
            expect(sent[0]).toEqual({ text: 'Alpha · Dispatch\n\nAnswer one', quoted: 'in-1' });
            expect(sent[1].text).toContain('Compacting context automatically');
            expect(sent).toHaveLength(2);
            expect(answer).toMatchObject({ status: 'delivered', outboundIds: ['out-1'] });
        } finally {
            relay.dispose();
        }
    });

    it('drops a stale unsent start once the outcome is known and keeps start-then-outcome order on retry', async () => {
        proc();
        binding();
        const hub = makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        await flush();
        online = false;
        emit('taskStarted', task, 'running');
        await flush();
        expect(ledger()[0].pending).toEqual([{ taskId: `${TASK}:start`, status: 'running' }]);
        online = true;
        await hub.reconcile('whatsapp');
        expect(texts()).toEqual([expect.stringContaining('⏳')]);

        // Second attempt: outcome arrives while its start is still unsent.
        processes.clear();
        sent = [];
        const second = { ...autoTask(), id: 'auto-2' } as QueuedTask;
        tasks.push(second);
        proc({}, { compaction: { taskId: 'auto-2', state: 'queued' } });
        emit('taskAdded', second);
        await flush();
        online = false;
        emit('taskStarted', second, 'running');
        await flush();
        processes.get(PROC).metadata.compaction = { taskId: 'auto-2', state: 'completed', messagesRemoved: 3, tokensRemoved: 90 };
        emit('taskCompleted', second, 'completed');
        await flush();
        online = true;
        await hub.reconcile('whatsapp');
        expect(texts()).toEqual(['Alpha · Dispatch · Auto-compaction · ✅\nContext compacted automatically — removed 3 messages, freed ~90 tokens.']);
    });

    it('retries a definitely-unsent part and quarantines an uncertain send across restart without replay', async () => {
        proc();
        binding();
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        await flush();
        sendImpl = async () => { throw new WhatsAppNotConnectedError(); };
        emit('taskStarted', task, 'running');
        await flush();
        expect(ledger()[0].pending).toEqual([{ taskId: `${TASK}:start`, status: 'running' }]);
        // An interrupted send (crash mid-post) leaves `sending` on disk.
        let release!: () => void;
        sendImpl = () => new Promise<string>(resolve => { release = () => resolve('late'); });
        void hubs[0].reconcile('whatsapp');
        await flush();
        expect(ledger()[0].sending).toBe(`${TASK}:start`);
        hubs[0].dispose();
        sendImpl = undefined;
        setCompaction({ state: 'completed', messagesRemoved: 2, tokensRemoved: 50 });
        task.status = 'completed';
        const restarted = makeHub();
        await restarted.restore();
        expect(texts()).toEqual(['Alpha · Dispatch · Auto-compaction · ✅\nContext compacted automatically — removed 2 messages, freed ~50 tokens.']);
        expect(ledger()[0].done).toEqual([`${TASK}:start`, TASK]);
        await makeHub().restore();
        emit('taskCompleted', task, 'completed');
        await flush();
        expect(sent).toHaveLength(1);
        release();
    });

    it('suppresses notices when the triggering binding is released or the account moves to another group', async () => {
        proc();
        const row = binding();
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        await flush();
        row.releaseState = 'released';
        emit('taskStarted', task, 'running');
        await flush();
        group = 'other@g.us';
        online = true;
        emit('taskCompleted', task, 'completed');
        await flush();
        expect(sent).toEqual([]); // Never retargeted to the newly selected group.
        expect(ledger()[0].done).toEqual([`${TASK}:start`]);
        group = GROUP;
        await hubs[0].reconcile('whatsapp');
        expect(sent).toEqual([]); // Released receipt still suppresses the outcome.
        expect(ledger()[0].done).toEqual([`${TASK}:start`, TASK]);
    });

    it.each([
        ['manual compaction', () => { proc(); binding(); return autoTask('queued', { trigger: undefined }); }],
        ['non-Sentinel chat', () => { proc({}, { mode: 'ask' }); binding(); return autoTask(); }],
        ['unbound conversation', () => { proc(); return autoTask(); }],
        ['binding for a different request', () => { proc(); binding({ taskId: 'req-other' }); return autoTask(); }],
        ['binding in another workspace', () => {
            proc();
            bindings.add({ groupJid: GROUP, workspaceId: 'ws-b', processId: PROC, taskId: 'req-1', inboundId: 'in-b',
                outboundIds: [], nextPart: 0, status: 'delivered' });
            return autoTask();
        }],
        ['selected group differs from the receipt', () => { proc(); binding({ groupJid: 'old@g.us' }); return autoTask(); }],
        ['notice binding only', () => { proc(); binding({ notice: true }); return autoTask(); }],
        ['auto-compact disabled (no evaluated response)', () => {
            proc({}, { autoCompact: { enabled: false, thresholdTokens: 1000 } });
            binding();
            return autoTask();
        }],
    ])('does not notify for a %s', async (_name, setup) => {
        const task = setup();
        makeHub();
        emit('taskAdded', task);
        emit('taskStarted', task, 'running');
        await flush();
        emit('taskCompleted', task, 'completed');
        await flush();
        expect(sent).toEqual([]);
    });

    it('routes desktop-mirror triggered compaction only through the mirror capture and its authority', async () => {
        proc({ conversationTurns: [
            { role: 'user', turnIndex: 0, content: 'hello', relayRequestId: 'req-1' },
            { role: 'assistant', turnIndex: 1, content: 'Answer one' },
            { role: 'user', turnIndex: 2, content: 'desktop ask', relayRequestId: 'mirror-req' },
            { role: 'assistant', turnIndex: 3, content: 'Answer two' },
        ] }, { autoCompact: { enabled: true, thresholdTokens: 1000, lastEvaluatedTurnIndex: 3 } });
        binding();
        const captured: MessagingJobOrigin = { connector: 'whatsapp', chatKey: GROUP, threadId: 'in-1',
            desktopMirror: { workspaceId: WS, processId: PROC, requestId: 'mirror-req', bindingId: 'acct:in-1' } };
        let authority: 'wait' | 'ready' = 'wait';
        mirror = { locate: vi.fn(() => captured), authorize: vi.fn(async () => authority) };
        const hub = makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        emit('taskStarted', task, 'running');
        await flush();
        expect(mirror.locate).toHaveBeenCalledWith({ workspaceId: WS, processId: PROC, requestId: 'mirror-req' });
        expect(mirror.authorize).toHaveBeenCalledWith(captured, { workspaceId: WS, processId: PROC });
        expect(sent).toEqual([]);
        authority = 'ready';
        await hub.reconcile(undefined, true); // Mirror source settlement wakes held notices.
        expect(texts()).toEqual([expect.stringContaining('Compacting context automatically')]);
    });

    it('does not use a desktop request when the mirror has no capture for it', async () => {
        proc({ conversationTurns: [
            { role: 'user', turnIndex: 0, content: 'hello', relayRequestId: 'req-1' },
            { role: 'assistant', turnIndex: 1, content: 'Answer one' },
            { role: 'user', turnIndex: 2, content: 'desktop ask' },
            { role: 'assistant', turnIndex: 3, content: 'Answer two' },
        ] }, { autoCompact: { enabled: true, thresholdTokens: 1000, lastEvaluatedTurnIndex: 3 } });
        binding();
        mirror = { locate: vi.fn(() => undefined), authorize: vi.fn() };
        makeHub();
        const task = autoTask();
        emit('taskAdded', task);
        emit('taskStarted', task, 'running');
        await flush();
        expect(sent).toEqual([]);
    });

    it('resolves the triggering request id from the answered user turn', () => {
        const turns = [
            { role: 'user', turnIndex: 0, content: 'a' },
            { role: 'assistant', turnIndex: 1, content: 'b' },
            { role: 'user', turnIndex: 2, content: 'c', relayRequestId: 'req-2' },
            { role: 'assistant', turnIndex: 3, content: 'd' },
            { role: 'user', turnIndex: 4, content: 'e' },
            { role: 'assistant', turnIndex: 5, content: 'f' },
        ] as never;
        const metadata = { type: 'chat', queueTaskId: 'first' } as never;
        expect(triggeringRequestId({ conversationTurns: turns, metadata }, 1)).toBe('first');
        expect(triggeringRequestId({ conversationTurns: turns, metadata }, 3)).toBe('req-2');
        expect(triggeringRequestId({ conversationTurns: turns, metadata }, 5)).toBeUndefined();
        expect(triggeringRequestId({ conversationTurns: turns, metadata }, 9)).toBeUndefined();
    });
});
