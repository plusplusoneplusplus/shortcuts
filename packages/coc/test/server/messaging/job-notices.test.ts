import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQueueProcessId, type ProcessStore, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { InboundWAMessage } from '@plusplusoneplusplus/coc-connector/whatsapp';
import { MessagingJobNotices, formatJobNotice, type JobNoticeTransport } from '../../../src/server/messaging/job-notices';
import { AskUserQuestionRelayHub } from '../../../src/server/messaging/ask-user-relay';
import { WhatsAppBindings } from '../../../src/server/messaging/whatsapp-bindings';
import { createWhatsAppNoticeTransport, createWhatsAppQuestionTransport } from '../../../src/server/messaging/whatsapp-answer-relay';
import { WhatsAppCommandRouter, type WhatsAppRouterDeps } from '../../../src/server/messaging/whatsapp-command-router';
import { WhatsAppNotConnectedError } from '../../../src/server/messaging/whatsapp-messaging-manager';
import { TeamsAnswerRelay, teamsQuestionChatKey } from '../../../src/server/messaging/teams-answer-relay';
import { TeamsCommandRouter } from '../../../src/server/messaging/teams-command-router';
import { TeamsMessageNotSentError } from '../../../src/server/messaging/teams-messaging-manager';
import { getRepoDataPath } from '../../../src/server/paths';

const WS = 'ws-a';
const JOB = toQueueProcessId('job-task');
const GROUP = 'group@g.us';

type Queue = EventEmitter & { getTask: (id: string) => QueuedTask | undefined; getAll: () => QueuedTask[] };

function makeQueue(tasks: QueuedTask[] = []): Queue {
    return Object.assign(new EventEmitter(), {
        getTask: (id: string) => tasks.find(task => task.id === id),
        getAll: () => tasks,
    });
}

function terminal(queue: Queue, id: string, status: 'completed' | 'failed' | 'cancelled', processId = JOB): void {
    const event = status === 'completed' ? 'taskCompleted' : status === 'failed' ? 'taskFailed' : 'taskCancelled';
    queue.emit(event, { id, repoId: WS, processId, status } as QueuedTask);
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('MessagingJobNotices', () => {
    let dataDir: string;
    let processes: Map<string, any>;
    let store: Pick<ProcessStore, 'getProcess' | 'getWorkspaces'>;
    let queue: Queue;
    let hubs: MessagingJobNotices[];
    let posted: Array<{ chatKey: string; text: string; processId: string }>;
    let online: boolean;

    const transport = (): JobNoticeTransport => ({
        platform: 'whatsapp',
        connected: () => online,
        post: async (chatKey, notice) => {
            const { line, detail } = formatJobNotice(notice);
            posted.push({ chatKey, text: detail ? `${line}\n${detail}` : line, processId: notice.processId });
            return `notice-${posted.length}`;
        },
    });
    const makeHub = () => {
        const hub = new MessagingJobNotices({ dataDir, store, queue });
        hub.register(transport());
        hubs.push(hub);
        return hub;
    };
    const job = (turns: any[], status = 'completed', extra: Record<string, unknown> = {}) => processes.set(JOB, {
        id: JOB, status, title: 'Fix login', metadata: { workspaceId: WS, queueTaskId: 'job-task' },
        conversationTurns: turns, ...extra,
    });

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-notices-'));
        processes = new Map();
        store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: WS, name: 'Alpha' }]),
            getProcess: vi.fn(async (id: string) => processes.get(id)),
        } as unknown as typeof store;
        queue = makeQueue();
        hubs = [];
        posted = [];
        online = true;
    });

    afterEach(() => {
        for (const hub of hubs) hub.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('persists parent review output and replays once after reconnect and restart', async () => {
        online = false;
        const hub = makeHub();
        const result = { workspaceId: WS, processId: 'sentinel', origin: { connector: 'whatsapp' as const, chatKey: GROUP },
            receiptId: 'review-receipt', repo: 'Child', title: 'Job', body: 'Reviewed result', status: 'completed' as const };
        hub.queueResult(result);
        hub.queueResult({ ...result, body: 'Duplicate content' });
        const file = getRepoDataPath(dataDir, WS, 'messaging-job-notices.json');
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject([{ processId: 'sentinel', result: { body: 'Reviewed result' } }]);
        hub.dispose();
        const restarted = makeHub();
        await restarted.restore();
        online = true;
        await restarted.reconcile();
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ processId: 'sentinel', chatKey: GROUP });
        restarted.queueResult(result);
        await restarted.reconcile();
        expect(posted).toHaveLength(1);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].done).toEqual(['review-receipt']);
    });

    it('does not treat other parent turns as result notifications', async () => {
        online = false;
        const hub = makeHub();
        hub.queueResult({ workspaceId: WS, processId: JOB, origin: { connector: 'whatsapp', chatKey: GROUP },
            receiptId: 'review-receipt', repo: 'Child', title: 'Job', body: 'Result', status: 'completed' });
        terminal(queue, 'later-parent-turn', 'completed');
        await flush();
        const rows = JSON.parse(fs.readFileSync(getRepoDataPath(dataDir, WS, 'messaging-job-notices.json'), 'utf8'));
        expect(rows[0].pending).toEqual([{ taskId: 'review-receipt', status: 'completed' }]);
    });

    it('notices only the admitted compaction and recovers its completion after restart', async () => {
        const hub = makeHub();
        hub.track({ processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP }, taskId: 'compact' });
        terminal(queue, 'other-turn', 'completed');
        await flush();
        expect(posted).toHaveLength(0);
        job([], 'running', { metadata: { workspaceId: WS, compaction: { taskId: 'compact', state: 'failed' } } });
        hub.dispose();
        await makeHub().restore();
        expect(posted).toHaveLength(1);
        expect(posted[0].text).toContain('Compaction');
        expect(posted[0].text).toContain('Later messages can continue');
        await makeHub().restore();
        expect(posted).toHaveLength(1);
    });

    it('posts one notice per terminal status with the repo and title', async () => {
        const hub = makeHub();
        hub.track({ processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP } });
        job([{ role: 'user', content: 'do it' }, { role: 'assistant', content: 'done' }]);
        terminal(queue, 'job-task', 'completed');
        await flush();
        job([{ role: 'user', content: 'do it' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'more' }], 'cancelled');
        terminal(queue, 'follow-up-1', 'cancelled');
        await flush();
        expect(posted).toEqual([
            { chatKey: GROUP, text: 'Alpha · Fix login · ✅', processId: JOB },
            { chatKey: GROUP, text: 'Alpha · Fix login · ⏹', processId: JOB },
        ]);
    });

    it('uses safe failure text: a usage-limit reset time, never raw exception text', async () => {
        const hub = makeHub();
        hub.track({ processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP } });
        job([{ role: 'user', content: 'do it' }], 'failed', { error: 'Usage limit reached; resets at 4pm (UTC). token=sk-secret' });
        terminal(queue, 'job-task', 'failed');
        await flush();
        job([{ role: 'user', content: 'do it' }, { role: 'user', content: 'again' }], 'failed',
            { error: 'ENOENT: /home/me/secret/path partial output' });
        terminal(queue, 'follow-up-1', 'failed');
        await flush();
        expect(posted.map(p => p.text)).toEqual([
            'Alpha · Fix login · ❌\nProvider usage limit reached. Resets at 4pm (UTC). Send a follow-up after the reset to retry.',
            'Alpha · Fix login · ❌\nThis request could not be completed.',
        ]);
        expect(posted.map(p => p.text).join()).not.toMatch(/sk-secret|ENOENT|\/home/);
    });

    it('ignores chats it does not track (dashboard-started)', async () => {
        makeHub();
        job([{ role: 'user', content: 'x' }]);
        terminal(queue, 'job-task', 'completed');
        await flush();
        expect(posted).toEqual([]);
        expect(fs.existsSync(getRepoDataPath(dataDir, WS, 'messaging-job-notices.json'))).toBe(false);
    });

    it('never double-sends a task, including after a restart', async () => {
        const hub = makeHub();
        hub.track({ processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP } });
        job([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }]);
        terminal(queue, 'job-task', 'completed');
        terminal(queue, 'job-task', 'completed');
        await flush();
        hub.dispose();
        const restarted = makeHub();
        await restarted.restore();
        terminal(queue, 'job-task', 'completed');
        await flush();
        expect(posted).toHaveLength(1);
    });

    it('keeps a notice pending while disconnected and posts it on reconnect or after a restart', async () => {
        const hub = makeHub();
        hub.track({ processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP } });
        job([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }]);
        online = false;
        terminal(queue, 'job-task', 'completed');
        await flush();
        expect(posted).toEqual([]);
        hub.dispose();
        const restarted = makeHub();
        await restarted.restore();
        expect(posted).toEqual([]);
        online = true;
        await restarted.reconcile('whatsapp');
        await restarted.reconcile('whatsapp');
        expect(posted.map(p => p.text)).toEqual(['Alpha · Fix login · ✅']);
    });

    it('notices a first turn that finished while the server was down', async () => {
        makeHub().track({ processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP } });
        job([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }]);
        await makeHub().restore();
        expect(posted.map(p => p.text)).toEqual(['Alpha · Fix login · ✅']);
    });

    it('does not resend a notice whose send a restart interrupted', async () => {
        const file = getRepoDataPath(dataDir, WS, 'messaging-job-notices.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify([{
            processId: JOB, workspaceId: WS, origin: { connector: 'whatsapp', chatKey: GROUP },
            createdAt: new Date().toISOString(), done: [], pending: [], sending: 'job-task', noticeIds: [],
        }]));
        job([{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }]);
        await makeHub().restore();
        terminal(queue, 'job-task', 'completed');
        await flush();
        expect(posted).toEqual([]);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0]).toMatchObject({ done: ['job-task'] });
    });

    it('locates an origin only for connector-started turns', async () => {
        const bindings = new WhatsAppBindings(dataDir);
        bindings.add({ groupJid: GROUP, workspaceId: WS, processId: 'dispatcher', taskId: 'req-1', inboundId: 'in-1', outboundIds: [], nextPart: 0, status: 'queued' });
        const relay = new AskUserQuestionRelayHub({ store: store as unknown as ProcessStore });
        relay.register(createWhatsAppQuestionTransport({ bindings, connected: () => true, groupJid: () => GROUP, send: vi.fn() }));
        expect(relay.locateOrigin({ processId: 'dispatcher', requestId: 'req-1' })).toEqual({ connector: 'whatsapp', chatKey: GROUP });
        expect(relay.locateOrigin({ processId: 'dispatcher', requestId: 'dashboard-task' })).toBeUndefined();
    });
});

describe('WhatsApp job notices', () => {
    let dataDir: string;
    let bindings: WhatsAppBindings;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-job-notices-'));
        bindings = new WhatsAppBindings(dataDir);
    });
    afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

    const notice = { workspaceId: WS, processId: JOB, repo: 'Alpha', title: 'Fix login', status: 'completed' as const };

    it('posts unquoted plain text and binds the notice to the job', async () => {
        const send = vi.fn().mockResolvedValue('notice-1');
        const transport = createWhatsAppNoticeTransport({ bindings, connected: () => true, groupJid: () => GROUP, send });
        expect(await transport.post(GROUP, notice)).toBe('notice-1');
        expect(send).toHaveBeenCalledWith('Alpha · Fix login · ✅');
        const restarted = new WhatsAppBindings(dataDir);
        await restarted.restore({ getWorkspaces: async () => [{ id: WS }] } as never);
        expect(restarted.findMessage('notice-1')).toMatchObject({ workspaceId: WS, processId: JOB, notice: true });
        expect(bindings.isKnownMessage('notice-1')).toBe(true);
    });

    it('posts a parent review despite topic selection changes and binds replies to the parent', async () => {
        bindings.selectRepo('different-workspace');
        bindings.selectTopic('different-workspace', 'different-topic');
        const send = vi.fn().mockResolvedValue('parent-result');
        const transport = createWhatsAppNoticeTransport({ bindings, connected: () => true, groupJid: () => GROUP, send });
        await transport.post(GROUP, { ...notice, operation: 'result', processId: 'sentinel', body: 'Review & next step' });
        expect(send).toHaveBeenCalledWith('Alpha · Fix login · ✅\n\nReview & next step');
        expect(bindings.findMessage('parent-result')).toMatchObject({ workspaceId: WS, processId: 'sentinel' });
        expect(bindings.selectedRepo).toBe('different-workspace');
        expect(bindings.topic('different-workspace')).toBe('different-topic');
    });

    it('does not retry a multipart review after an already posted part', async () => {
        const send = vi.fn().mockResolvedValueOnce('first-part').mockRejectedValueOnce(new WhatsAppNotConnectedError());
        const transport = createWhatsAppNoticeTransport({ bindings, connected: () => true, groupJid: () => GROUP, send });
        await expect(transport.post(GROUP, { ...notice, operation: 'result', body: 'Long answer. '.repeat(2000) }))
            .rejects.toBeInstanceOf(WhatsAppNotConnectedError);
        expect(bindings.findMessage('first-part')).toMatchObject({ processId: JOB });
    });

    it('reports a definitely-unsent notice as undefined', async () => {
        const send = vi.fn().mockRejectedValue(new WhatsAppNotConnectedError());
        const transport = createWhatsAppNoticeTransport({ bindings, connected: () => true, groupJid: () => GROUP, send });
        expect(await transport.post(GROUP, notice)).toBeUndefined();
        expect(transport.connected('other@g.us')).toBe(false);
    });

    it('routes a quote-reply to the job, keeps its mode and the dispatcher selection', async () => {
        const store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: WS, name: 'Alpha' }, { id: 'ws-d', name: 'Dispatch' }]),
            getAllProcesses: vi.fn().mockResolvedValue([]),
            getProcess: vi.fn(async (id: string) => id === JOB ? { id: JOB, metadata: { workspaceId: WS, mode: 'autopilot' } } : undefined),
        } as unknown as WhatsAppRouterDeps['store'];
        bindings.selectRepo('ws-d');
        bindings.selectTopic('ws-d', 'dispatcher');
        bindings.recordNotice({ groupJid: GROUP, workspaceId: WS, processId: JOB }, 'notice-1');
        const enqueue = vi.fn().mockResolvedValue('queued');
        const router = new WhatsAppCommandRouter({
            store, bindings, groupJid: () => GROUP, enqueue,
            send: vi.fn().mockResolvedValue('out'), react: vi.fn().mockResolvedValue(undefined),
        });
        const msg: InboundWAMessage = {
            chatJid: GROUP, senderJid: GROUP, participantJid: 'me', fromMe: true,
            messageId: 'reply-1', text: 'also add tests', quotedMessageId: 'notice-1',
        };
        await router.handle(msg);
        // Plain text passes no mode; the server's follow-up resolver keeps autopilot.
        expect(enqueue).toHaveBeenCalledWith(WS, 'also add tests', undefined, JOB, expect.any(String), undefined);
        expect(bindings.selectedRepo).toBe('ws-d');
        expect(bindings.topic('ws-d')).toBe('dispatcher');
        expect(bindings.topic(WS)).toBeNull();
        // The follow-up is a normal request binding, so its answer is relayed as usual.
        expect(bindings.findMessage('reply-1')).toMatchObject({ processId: JOB, status: 'queued' });
    });
});

describe('Teams job notices', () => {
    let dataDir: string;
    let processes: Map<string, any>;
    let store: ProcessStore;
    let send: ReturnType<typeof vi.fn>;
    let relays: TeamsAnswerRelay[];
    const chatKey = teamsQuestionChatKey('team-1', 'channel-1');
    const notice = { workspaceId: WS, processId: JOB, repo: 'A<b>', title: 'Fix & ship', status: 'failed' as const, detail: 'This request could not be completed.' };

    const makeRelay = () => {
        const relay = new TeamsAnswerRelay({
            dataDir, store, queue: makeQueue(), isEnabled: () => true,
            target: () => ({ connected: true, teamId: 'team-1', channelId: 'channel-1' }), send,
        });
        relays.push(relay);
        return relay;
    };

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-job-notices-'));
        processes = new Map([[JOB, { id: JOB, status: 'completed', metadata: { workspaceId: WS, mode: 'autopilot' } }]]);
        store = {
            getWorkspaces: vi.fn().mockResolvedValue([{ id: WS, name: 'A' }, { id: 'ws-d', name: 'D' }]),
            getProcess: vi.fn(async (id: string) => processes.get(id)),
        } as unknown as ProcessStore;
        send = vi.fn().mockResolvedValue('notice-root');
        relays = [];
    });
    afterEach(() => {
        for (const relay of relays) relay.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('posts a top-level safe-HTML notice whose thread routes to the job, across restarts', async () => {
        const transport = makeRelay().noticeTransport();
        expect(await transport.post(chatKey, notice)).toBe('notice-root');
        expect(send).toHaveBeenCalledWith('<p>A&lt;b&gt; · Fix &amp; ship · ❌</p><p>This request could not be completed.</p>');
        expect(send.mock.calls[0][1]).toBeUndefined();

        const restored = makeRelay();
        await restored.restore();
        expect(restored.threadRoots('team-1', 'channel-1')).toContain('notice-root');
        const reply = { messageId: 'reply-1', channelId: 'channel-1', text: 'also add tests', replyToMessageId: 'notice-root', senderAadId: 'u' };
        expect((await restored.resolveThread(reply))?.process?.id).toBe(JOB);
    });

    it('returns safe review text to the original thread without changing selection', async () => {
        const relay = makeRelay();
        await relay.noticeTransport().post(chatKey, { ...notice, operation: 'result', processId: 'sentinel',
            threadId: 'original-thread', body: 'Review <script>bad()</script> & next step' });
        expect(send.mock.calls[0][1]).toBe('original-thread');
        expect(send.mock.calls[0][0]).not.toContain('<script>');
        expect(send.mock.calls[0][0]).toContain('next step');
        expect(relay.threadRoots('team-1', 'channel-1')).not.toContain('notice-root');
    });

    it('does not retry a multipart review after an already posted Teams part', async () => {
        send.mockResolvedValueOnce('first-part').mockRejectedValueOnce(new TeamsMessageNotSentError());
        const relay = makeRelay();
        await expect(relay.noticeTransport().post(chatKey, { ...notice, operation: 'result',
            body: 'Long answer. '.repeat(4000), threadId: 'original-thread' })).rejects.toBeInstanceOf(TeamsMessageNotSentError);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('reports a definite send rejection as undefined and skips other channels', async () => {
        send.mockRejectedValue(new TeamsMessageNotSentError());
        const transport = makeRelay().noticeTransport();
        expect(await transport.post(chatKey, notice)).toBeUndefined();
        expect(transport.connected(teamsQuestionChatKey('team-1', 'other'))).toBe(false);
    });

    it('a reply in the notice thread follows up the job without touching user selection', async () => {
        const relay = makeRelay();
        await relay.noticeTransport().post(chatKey, notice);
        const admitFollowUp = vi.fn().mockResolvedValue({ duplicate: false });
        const sendReply = vi.fn().mockResolvedValue(undefined);
        const acknowledgeFollowUp = vi.fn().mockResolvedValue(undefined);
        const router = new TeamsCommandRouter({
            store, dataDir, enqueueChat: vi.fn(), executeFollowUp: vi.fn(), sendReply,
            isAnswerRelayEnabled: () => true,
            resolveThreadReply: msg => relay.resolveThread(msg),
            admitFollowUp, acknowledgeFollowUp,
        });
        const reply = { messageId: 'reply-1', channelId: 'channel-1', text: 'also add tests', replyToMessageId: 'notice-root', senderAadId: 'u' };
        await router.handle(reply);
        expect(admitFollowUp).toHaveBeenCalledWith(reply, expect.objectContaining({ id: JOB }), 'also add tests', undefined);
        // Thread follow-ups are acknowledged silently (Like), not with a reply.
        expect(acknowledgeFollowUp).toHaveBeenCalledWith(reply);
        expect(sendReply).not.toHaveBeenCalled();
        expect(fs.existsSync(path.join(dataDir, 'teams-user-state.json'))).toBe(false);
    });
});
