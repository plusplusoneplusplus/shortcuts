import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toQueueProcessId, type QueuedTask } from '@plusplusoneplusplus/forge';
import type { InboundTeamsMessage } from '@plusplusoneplusplus/coc-connector/teams';
import { TeamsMessagingManager, TeamsMessageNotSentError } from '../../../src/server/messaging/teams-messaging-manager';
import { registerTeamsMessagingRoutes } from '../../../src/server/messaging/teams-messaging-handler';
import { AskUserQuestionRelayHub, QUESTION_RELAY_TEXT } from '../../../src/server/messaging/ask-user-relay';
import { teamsQuestionChatKey } from '../../../src/server/messaging/teams-answer-relay';
import type { MessagingJobOrigin } from '../../../src/server/messaging/job-notices';
import { formatTeamsQuestion } from '../../../src/server/messaging/teams-outbound-format';
import { createAskUserTool, type AskUserQuestion, type AskUserResponse } from '../../../src/server/llm-tools/ask-user-tool';

const teamId = 'team-1';
const channelId = 'channel-1';

describe('Teams ask_user question relay', () => {
    let dataDir: string;
    let manager: TeamsMessagingManager;
    let hub: AskUserQuestionRelayHub;
    let handle: (msg: InboundTeamsMessage) => Promise<void>;
    let sendMessage: ReturnType<typeof vi.fn>;
    let react: ReturnType<typeof vi.fn>;
    let relayEnabled: boolean;
    let tasks: Map<string, QueuedTask>;
    let followUps: Array<{ processId: string; requestId: string }>;
    let sent = 0;
    const processes = new Map<string, any>();
    const store = {
        getWorkspaces: vi.fn().mockResolvedValue([{ id: 'global-workspace-00', name: 'Alpha', rootPath: '/a' }]),
        getProcess: vi.fn(async (id: string) => processes.get(id)),
        updateProcess: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-question-relay-'));
        relayEnabled = true;
        sent = 0;
        tasks = new Map();
        followUps = [];
        processes.clear();
        manager = new TeamsMessagingManager(dataDir);
        vi.spyOn(manager, 'getStatus').mockReturnValue({
            enabled: true, status: 'connected', teamId, channelId,
            botName: 'CoC', error: null, serverUrl: null, authStatus: null,
        } as any);
        sendMessage = vi.fn(async () => `sent-${++sent}`);
        vi.spyOn(manager, 'sendMessage').mockImplementation(sendMessage as any);
        react = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(manager, 'reactToChannelMessage').mockImplementation(react as any);
        vi.spyOn(manager, 'setMessageHandler').mockImplementation(handler => {
            handle = msg => handler(msg, () => {});
        });
        hub = new AskUserQuestionRelayHub({ store: store as any });
        const queue = Object.assign(new EventEmitter(), {
            getTask: (id: string) => tasks.get(id),
            getAll: () => [...tasks.values()],
        });
        registerTeamsMessagingRoutes([], {
            dataDir, store: store as any, manager, questionRelay: hub,
            relayQueue: queue as any,
            getAnswerRelayEnabled: () => relayEnabled,
            enqueueChat: async () => { throw new Error('Expected relay admission'); },
            executeFollowUp: async () => { throw new Error('Expected relay follow-up'); },
            enqueueRelayChat: async (_ws, _prompt, id) => {
                tasks.set(id, { id, repoId: 'global-workspace-00', processId: toQueueProcessId(id), status: 'running', payload: {} } as any);
                return id;
            },
            admitRelayFollowUp: async (process, _text, requestId, _mode, taskId) => {
                followUps.push({ processId: process.id, requestId });
                return { taskId };
            },
        });
    });

    afterEach(() => {
        manager.dispose();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    const inbound = (messageId: string, text: string, replyToMessageId?: string): InboundTeamsMessage =>
        ({ messageId, channelId, text, senderAadId: 'user', ...(replyToMessageId ? { replyToMessageId } : {}) });

    async function startRequest(): Promise<{ processId: string; requestId: string }> {
        await handle(inbound('root', 'please help'));
        const [taskId] = [...tasks.keys()];
        return { processId: toQueueProcessId(taskId), requestId: taskId };
    }

    function ask(request: { processId: string; requestId: string; origin?: MessagingJobOrigin }, questions: AskUserQuestion[]) {
        const emitted: string[] = [];
        const tool = createAskUserTool({
            computeTurnIndex: () => 1,
            emitQuestions: (payloads, control) => {
                emitted.push(...payloads.map(p => p.questionId));
                hub.relay({ ...request, questions: payloads, control });
            },
        });
        const result = (tool.tool.handler as (a: { questions: AskUserQuestion[] }) => Promise<AskUserResponse[]>)({ questions });
        return { tool, result, emitted };
    }

    const questionCalls = () => sendMessage.mock.calls.filter(([, , source]) => source === 'html');

    const jobRequest = (threadId?: string) => ({
        processId: 'handed-off-job', requestId: 'job-turn',
        origin: { connector: 'teams' as const, chatKey: teamsQuestionChatKey(teamId, channelId), threadId },
    });

    it('records the dispatcher thread root in the hand-off origin', async () => {
        const request = await startRequest();
        expect(hub.locateOrigin(request)).toEqual(jobRequest('root').origin);
    });

    it.each(['root', undefined])('keeps Git status out of pending AI question answers (%s)', async threadId => {
        const { result } = ask(jobRequest(threadId), [{ question: 'Color?', type: 'text' }]);
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        const tryAnswer = vi.spyOn(hub, 'tryAnswer');
        store.getWorkspaces.mockResolvedValueOnce([]);
        await handle(inbound('git-command', '/git status', threadId));
        expect(sendMessage).toHaveBeenLastCalledWith(expect.stringContaining('No accessible local repos registered.'), threadId ?? 'git-command');
        expect(tryAnswer).not.toHaveBeenCalled();
        expect(hub.pendingCount()).toBe(1);
        expect(tasks.size).toBe(0);
        expect(followUps).toEqual([]);
        await handle(inbound('answer', 'blue', threadId));
        expect((await result)[0].answer).toBe('blue');
    });

    it.each(['dispatcher-root', undefined])('relays jobs without receipts to their origin root (%s)', async threadId => {
        const { result } = ask(jobRequest(threadId), [{ question: 'Color?', type: 'text' }]);
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(questionCalls()[0][1]).toBe(threadId);
        await handle(inbound('select', 'select repo Alpha', 'another-thread'));
        await handle(inbound('answer', 'blue', threadId));
        expect((await result)[0].answer).toBe('blue');
        expect(tasks.size).toBe(0);
        expect(followUps).toEqual([]);
    });

    it('does not guess a job for an ambiguous thread reply; question ids route each answer', async () => {
        const a = ask(jobRequest('root'), [{ question: 'Color A?', type: 'text' }]);
        const b = ask({ ...jobRequest('root'), processId: 'job-b' }, [{ question: 'Color B?', type: 'text' }]);
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(2));
        await handle(inbound('ambiguous', 'blue', 'root'));
        expect(sendMessage).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.ambiguous, 'root');
        expect(hub.pendingCount()).toBe(2);
        await handle(inbound('answer-b', 'blue', 'sent-2'));
        await handle(inbound('answer-a', 'red', 'sent-1'));
        expect((await b.result)[0].answer).toBe('blue');
        expect((await a.result)[0].answer).toBe('red');
        expect(tasks.size).toBe(0);
        expect(followUps).toEqual([]);
    });

    it('keeps a disabled job question in the dashboard', async () => {
        relayEnabled = false;
        const { tool, result, emitted } = ask(jobRequest('root'), [{ question: 'Color?', type: 'text' }]);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(questionCalls()).toEqual([]);
        tool.answerQuestion(emitted[0], 'blue');
        expect((await result)[0].answer).toBe('blue');
    });

    it('reports a job question answered in the dashboard as already answered', async () => {
        const { tool, result, emitted } = ask(jobRequest('dispatcher-root'), [{ question: 'Color?', type: 'text' }]);
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        tool.answerQuestion(emitted[0], 'blue');
        await result;
        await handle(inbound('late', 'red', 'dispatcher-root'));
        expect(sendMessage).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.alreadyAnswered, 'dispatcher-root');
        expect(followUps).toEqual([]);
        expect(tasks.size).toBe(0);
    });

    it('posts each question in the request thread and takes thread replies as answers, one at a time', async () => {
        const request = await startRequest();
        const { result } = ask(request, [
            { question: 'Database?', type: 'select', options: [{ value: 'pg', label: 'Postgres' }, { value: 'lite', label: 'SQLite' }] },
            { question: 'Proceed?', type: 'yes-no' },
        ]);
        await vi.waitFor(() => expect(questionCalls()).toHaveLength(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(questionCalls()[0]).toEqual([formatTeamsQuestion({
            progress: '(Question 1 of 2)', question: 'Database?',
            options: ['1. Postgres', '2. SQLite'], hint: 'Reply: 1-2, your own answer, or "skip"',
        }), 'root', 'html']);
        await handle(inbound('r1', 'Postgres', 'root'));
        await vi.waitFor(() => expect(questionCalls()).toHaveLength(2));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(react).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'r1' }));
        await handle(inbound('r2', 'no', 'root'));
        expect((await result).map(r => r.answer)).toEqual(['pg', false]);
        expect(followUps).toEqual([]);
    });

    it('accepts a top-level message only while exactly one question is pending', async () => {
        const request = await startRequest();
        const { result } = ask(request, [{ question: 'Name?', type: 'text' }]);
        await vi.waitFor(() => expect(questionCalls()).toHaveLength(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        await handle(inbound('plain', 'widget'));
        expect((await result)[0].answer).toBe('widget');
        // Nothing pending: a top-level post is an ordinary request again.
        await handle(inbound('next', 'another question'));
        expect(String(sendMessage.mock.calls.at(-1)![0])).toMatch(/^💬 /);
    });

    it.each(['select', 'multi-select', 'yes-no', 'confirm'] as const)('delivers a thread clarification for %s once without a follow-up turn', async type => {
        const clarification = "i need you to explain this, i don't think we have cloud or local";
        const request = await startRequest();
        const { tool, result, emitted } = ask(request, [{
            question: 'How should we transcribe?', type,
            ...(type === 'select' || type === 'multi-select' ? { options: [
                { value: 'cloud', label: 'Cloud' }, { value: 'local', label: 'Local' }, { value: 'both', label: 'Both' },
            ] } : {}),
        }]);
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        const reply = inbound('clarification', `  ${clarification}  `, 'root');
        await handle(reply);
        expect((await result)[0]).toMatchObject({ answer: clarification, skipped: false });
        expect(tool.answerQuestion(emitted[0], 'cloud')).toBe(false);
        const sends = sendMessage.mock.calls.length;
        await handle(reply);
        expect(react.mock.calls.filter(([msg]) => msg.messageId === 'clarification')).toHaveLength(1);
        expect(sendMessage.mock.calls).toHaveLength(sends);
        expect(tasks.size).toBe(1);
        expect(followUps).toEqual([]);
        expect(hub.pendingCount()).toBe(0);
    });

    it('keeps approval prompts in the dashboard and denies a clarification answer', async () => {
        const request = await startRequest();
        let questionId = '';
        const tool = createAskUserTool({
            computeTurnIndex: () => 1,
            emitQuestions: (payloads, control) => {
                questionId = payloads[0].questionId;
                const questions = payloads.filter(p => !p.approval);
                if (questions.length) hub.relay({ ...request, questions, control });
            },
        });
        const decision = tool.askApproval({
            kind: 'dangerous-command', command: 'rm -rf /', ruleId: 'r', description: 'd', matchedSegment: 'rm',
        });
        expect(questionCalls()).toEqual([]);
        expect(hub.pendingCount()).toBe(0);
        await handle(inbound('clarification', 'please explain before proceeding', 'root'));
        expect(tool.hasPending()).toBe(true);
        expect(tool.answerQuestion(questionId, 'please explain before proceeding')).toBe(true);
        expect(await decision).toBe('deny');
    });

    it('locates a follow-up turn by its relay request id', async () => {
        const request = await startRequest();
        processes.set(request.processId, {
            id: request.processId, status: 'completed', metadata: { workspaceId: 'global-workspace-00', queueTaskId: request.requestId },
        });
        await handle(inbound('follow', 'and then?', 'root'));
        expect(followUps).toHaveLength(1);
        const { result } = ask({ processId: request.processId, requestId: followUps[0].requestId }, [{ question: 'Ok?', type: 'confirm' }]);
        await vi.waitFor(() => expect(questionCalls()).toHaveLength(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        expect(questionCalls()[0][1]).toBe('root');
        await handle(inbound('ans', 'yes', 'root'));
        expect((await result)[0].answer).toBe(true);
    });

    it('replies "already answered" after the dashboard answered first', async () => {
        const request = await startRequest();
        const { tool, result, emitted } = ask(request, [{ question: 'Ok?', type: 'yes-no' }]);
        await vi.waitFor(() => expect(questionCalls()).toHaveLength(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        tool.answerQuestion(emitted[0], true);
        await result;
        await new Promise(resolve => setTimeout(resolve, 0));
        await handle(inbound('late', 'no', 'root'));
        expect(sendMessage).toHaveBeenLastCalledWith(QUESTION_RELAY_TEXT.alreadyAnswered, 'root');
        expect(followUps).toEqual([]);
        tool.cancelAll();
    });

    it('resolves as unavailable when the relay is disabled or the send fails', async () => {
        const request = await startRequest();
        sendMessage.mockRejectedValueOnce(new TeamsMessageNotSentError());
        const failed = ask(request, [{ question: 'Ok?', type: 'yes-no' }]);
        expect((await failed.result)[0]).toMatchObject({ reason: 'unavailable' });
        relayEnabled = false;
        const disabled = ask(request, [{ question: 'Ok?', type: 'yes-no' }]);
        expect((await disabled.result)[0]).toMatchObject({ reason: 'unavailable' });
    });

    it('clears pending questions when the turn is cancelled', async () => {
        const request = await startRequest();
        const { tool, result } = ask(request, [{ question: 'Ok?', type: 'yes-no' }, { question: 'Name?', type: 'text' }]);
        await vi.waitFor(() => expect(questionCalls()).toHaveLength(1));
        await vi.waitFor(() => expect(hub.pendingCount()).toBe(1));
        tool.cancelAll();
        expect((await result).map(r => r.reason)).toEqual(['cancelled', 'cancelled']);
        expect(hub.pendingCount()).toBe(0);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(questionCalls()).toHaveLength(1);
    });
});

describe('formatTeamsQuestion', () => {
    it('renders escaped, phone-readable HTML', () => {
        expect(formatTeamsQuestion({
            progress: '(Question 2 of 3)', question: 'Use <b>x</b>?\nReally', options: ['1. A & B', '2. C'],
            hint: 'Reply: 1-2, your own answer, or "skip"',
        })).toBe('<p><em>(Question 2 of 3)</em></p><p><strong>Use &lt;b&gt;x&lt;/b&gt;?<br>Really</strong></p>'
            + '<p>1. A &amp; B<br>2. C</p><p>Reply: 1-2, your own answer, or &quot;skip&quot;</p>');
        expect(formatTeamsQuestion({ question: 'Name?', options: [], hint: 'Reply: your answer or "skip"' }))
            .toBe('<p><strong>Name?</strong></p><p>Reply: your answer or &quot;skip&quot;</p>');
    });
});
