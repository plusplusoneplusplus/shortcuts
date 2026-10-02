import { describe, expect, it, vi } from 'vitest';
import {
    AskUserQuestionRelayHub, QUESTION_RELAY_TEXT, buildQuestionLayout, parseQuestionReply,
    type QuestionLayout, type QuestionReplyInbound, type QuestionTransport,
} from '../../../src/server/messaging/ask-user-relay';
import { createAskUserTool, type AskUserQuestion, type AskUserResponse, type AskUserSSEPayload } from '../../../src/server/llm-tools/ask-user-tool';

const select = { type: 'select' as const, options: [{ value: 'pg', label: 'Postgres' }, { value: 'lite', label: 'SQLite' }] };
const multi = { type: 'multi-select' as const, options: [
    { value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }, { value: 'c', label: 'Gamma' },
] };

describe('parseQuestionReply', () => {
    it('parses select by number or option text, case-insensitively', () => {
        expect(parseQuestionReply(select, '2')).toEqual({ kind: 'answer', value: 'lite' });
        expect(parseQuestionReply(select, ' postgres ')).toEqual({ kind: 'answer', value: 'pg' });
        expect(parseQuestionReply(select, 'LITE')).toEqual({ kind: 'answer', value: 'lite' });
        expect(parseQuestionReply(select, '3')).toMatchObject({ kind: 'invalid' });
        expect(parseQuestionReply(select, 'mysql')).toMatchObject({ kind: 'invalid' });
    });

    it('parses multi-select from comma or space separated numbers', () => {
        expect(parseQuestionReply(multi, '1,3')).toEqual({ kind: 'answer', value: ['a', 'c'] });
        expect(parseQuestionReply(multi, '1 3 1')).toEqual({ kind: 'answer', value: ['a', 'c'] });
        expect(parseQuestionReply(multi, '2, 3')).toEqual({ kind: 'answer', value: ['b', 'c'] });
        expect(parseQuestionReply(multi, 'beta')).toEqual({ kind: 'answer', value: ['b'] });
        expect(parseQuestionReply(multi, '1,4')).toMatchObject({ kind: 'invalid' });
    });

    it('parses yes-no and confirm as booleans', () => {
        for (const type of ['yes-no', 'confirm'] as const) {
            expect(parseQuestionReply({ type }, 'Y')).toEqual({ kind: 'answer', value: true });
            expect(parseQuestionReply({ type }, 'yes')).toEqual({ kind: 'answer', value: true });
            expect(parseQuestionReply({ type }, 'n')).toEqual({ kind: 'answer', value: false });
            expect(parseQuestionReply({ type }, 'NO')).toEqual({ kind: 'answer', value: false });
            expect(parseQuestionReply({ type }, 'maybe')).toEqual({ kind: 'invalid', error: 'Please reply yes or no.' });
        }
    });

    it('accepts any text for text questions and skip for every type', () => {
        expect(parseQuestionReply({ type: 'text' }, '  use port 8080 ')).toEqual({ kind: 'answer', value: 'use port 8080' });
        expect(parseQuestionReply({ type: 'text' }, '   ')).toMatchObject({ kind: 'invalid' });
        for (const q of [select, multi, { type: 'yes-no' as const }, { type: 'confirm' as const }, { type: 'text' as const }]) {
            expect(parseQuestionReply(q, 'Skip')).toEqual({ kind: 'skip' });
        }
    });
});

describe('buildQuestionLayout', () => {
    const payload = (patch: Partial<AskUserSSEPayload>): AskUserSSEPayload => ({
        batchId: 'b', questionId: 'q', question: 'Which database?', type: 'text', turnIndex: 1, index: 0, batchSize: 1, ...patch,
    });

    it('numbers options one per line with a hint and progress for batches', () => {
        expect(buildQuestionLayout(payload({ ...select, options: [
            { value: 'pg', label: 'Postgres', description: 'server' }, { value: 'lite', label: 'SQLite' },
        ] }), 1, 3)).toEqual({
            progress: '(Question 2 of 3)',
            question: 'Which database?',
            options: ['1. Postgres — server', '2. SQLite'],
            hint: 'Reply: 1-2 or "skip"',
        });
    });

    it('omits progress for single questions and picks per-type hints', () => {
        expect(buildQuestionLayout(payload({}), 0, 1)).toEqual({
            question: 'Which database?', options: [], hint: 'Reply: your answer or "skip"',
        });
        expect(buildQuestionLayout(payload(multi), 0, 1).hint).toBe('Reply: 1,2 or "skip"');
        expect(buildQuestionLayout(payload({ type: 'yes-no' }), 0, 1).hint).toBe('Reply: yes / no or "skip"');
        expect(buildQuestionLayout(payload({ type: 'confirm' }), 0, 1).hint).toBe('Reply: yes / no or "skip"');
    });
});

// ============================================================================
// Hub, driven through the real ask_user tool
// ============================================================================

function setup(opts: { post?: QuestionTransport['post']; owned?: boolean } = {}) {
    const posted: Array<{ layout: QuestionLayout; id: string }> = [];
    let counter = 0;
    const store = {
        getProcess: vi.fn(async () => ({ pendingAskUser: emitted })),
        updateProcess: vi.fn(async () => undefined),
    };
    let emitted: AskUserSSEPayload[] = [];
    const hub = new AskUserQuestionRelayHub({ store: store as any });
    const transport: QuestionTransport = {
        platform: 'whatsapp',
        locate: () => opts.owned === false ? undefined : { chatKey: 'group' },
        post: opts.post ?? (async (_target, layout) => {
            const id = `question-${++counter}`;
            posted.push({ layout, id });
            return id;
        }),
        isPastQuestion: id => id === 'old-question',
    };
    hub.register(transport);
    const relayed = vi.fn();
    const tool = createAskUserTool({
        computeTurnIndex: () => 1,
        emitQuestions: (payloads, control) => {
            emitted = payloads;
            relayed(hub.relay({ processId: 'proc', requestId: 'req', questions: payloads.filter(p => !p.approval), control }));
        },
    });
    const ask = (questions: AskUserQuestion[]) =>
        (tool.tool.handler as (args: { questions: AskUserQuestion[] }) => Promise<AskUserResponse[]>)({ questions });
    const replies: string[] = [];
    const acks: string[] = [];
    const inbound = (text: string, messageId: string, replyToId?: string): QuestionReplyInbound => ({
        chatKey: 'group', messageId, replyToId, text,
        reply: async t => { replies.push(t); },
        acknowledge: async () => { acks.push(messageId); },
    });
    const answer = (text: string, messageId: string, replyToId?: string) =>
        hub.tryAnswer('whatsapp', inbound(text, messageId, replyToId));
    return { hub, tool, ask, posted, replies, acks, answer, store, relayed, get emitted() { return emitted; } };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AskUserQuestionRelayHub', () => {
    it('sends a batch one question at a time and resolves each answer as it arrives', async () => {
        const t = setup();
        const result = t.ask([
            { question: 'Database?', type: 'select', options: select.options },
            { question: 'Name?', type: 'text' },
        ]);
        await vi.waitFor(() => expect(t.posted).toHaveLength(1));
        await vi.waitFor(() => expect(t.hub.pendingCount()).toBe(1));
        expect(t.posted[0].layout.progress).toBe('(Question 1 of 2)');
        await flush();
        expect(t.posted).toHaveLength(1);

        expect(await t.answer('2', 'a1', 'question-1')).toBe(true);
        expect(t.acks).toEqual(['a1']);
        await vi.waitFor(() => expect(t.posted).toHaveLength(2));
        await vi.waitFor(() => expect(t.hub.pendingCount()).toBe(1));
        expect(t.posted[1].layout.progress).toBe('(Question 2 of 2)');
        expect(t.store.updateProcess).toHaveBeenCalledWith('proc', { pendingAskUser: [t.emitted[1]] });

        // Plain message answers the single pending question.
        expect(await t.answer('widget', 'a2')).toBe(true);
        const responses = await result;
        expect(responses.map(r => r.answer)).toEqual(['lite', 'widget']);
        expect(t.store.updateProcess).toHaveBeenLastCalledWith('proc', { pendingAskUser: undefined });
    });

    it('ignores plain messages when no question is pending', async () => {
        const t = setup();
        expect(await t.answer('hello', 'm1')).toBe(false);
        expect(t.replies).toEqual([]);
    });

    it('keeps the question pending and re-sends the hint on invalid input', async () => {
        const t = setup();
        const result = t.ask([{ question: 'Ok?', type: 'yes-no' }]);
        await vi.waitFor(() => expect(t.posted).toHaveLength(1));
        await vi.waitFor(() => expect(t.hub.pendingCount()).toBe(1));
        expect(await t.answer('perhaps', 'bad', 'question-1')).toBe(true);
        expect(t.replies).toEqual(['Please reply yes or no.\nReply: yes / no or "skip"']);
        expect(t.tool.hasPending()).toBe(true);
        expect(await t.answer('skip', 'good', 'question-1')).toBe(true);
        expect((await result)[0]).toMatchObject({ skipped: true, reason: 'user-skipped' });
    });

    it('lets the dashboard win and tells a later connector reply it was already answered', async () => {
        const t = setup();
        const result = t.ask([{ question: 'Ok?', type: 'confirm' }]);
        await vi.waitFor(() => expect(t.posted).toHaveLength(1));
        await vi.waitFor(() => expect(t.hub.pendingCount()).toBe(1));
        t.tool.answerQuestion(t.emitted[0].questionId, true);
        expect((await result)[0].answer).toBe(true);
        await flush();
        expect(await t.answer('no', 'late', 'question-1')).toBe(true);
        expect(t.replies).toEqual([QUESTION_RELAY_TEXT.alreadyAnswered]);
        expect(t.acks).toEqual([]);
    });

    it('skips posting questions the dashboard already answered', async () => {
        const t = setup();
        const result = t.ask([{ question: 'A?', type: 'text' }, { question: 'B?', type: 'text' }]);
        await vi.waitFor(() => expect(t.posted).toHaveLength(1));
        await vi.waitFor(() => expect(t.hub.pendingCount()).toBe(1));
        t.tool.answerQuestions([
            { questionId: t.emitted[0].questionId, answer: 'x' },
            { questionId: t.emitted[1].questionId, answer: 'y' },
        ]);
        await result;
        await flush();
        expect(t.posted).toHaveLength(1);
    });

    it('resolves a question as unavailable when it cannot be posted', async () => {
        const t = setup({ post: async () => { throw new Error('disconnected'); } });
        const [response] = await t.ask([{ question: 'Ok?', type: 'yes-no' }]);
        expect(response).toMatchObject({ skipped: true, reason: 'unavailable' });
    });

    it('does not relay requests no connector owns', async () => {
        const t = setup({ owned: false });
        void t.ask([{ question: 'Ok?', type: 'yes-no' }]);
        await vi.waitFor(() => expect(t.relayed).toHaveBeenCalledWith(false));
        expect(t.posted).toEqual([]);
        t.tool.cancelAll();
    });

    it('clears pending questions on cancel and answers late replies with "no longer active"', async () => {
        const t = setup();
        const result = t.ask([{ question: 'A?', type: 'text' }, { question: 'B?', type: 'text' }]);
        await vi.waitFor(() => expect(t.posted).toHaveLength(1));
        await vi.waitFor(() => expect(t.hub.pendingCount()).toBe(1));
        t.tool.cancelAll();
        expect((await result).map(r => r.reason)).toEqual(['cancelled', 'cancelled']);
        await flush();
        expect(t.posted).toHaveLength(1);
        expect(t.hub.pendingCount()).toBe(0);
        expect(await t.answer('late', 'l1', 'question-1')).toBe(true);
        expect(await t.answer('late', 'l2', 'old-question')).toBe(true);
        expect(t.replies).toEqual([QUESTION_RELAY_TEXT.inactive, QUESTION_RELAY_TEXT.inactive]);
        expect(await t.answer('plain', 'l3')).toBe(false);
    });

    it('treats a plain message as a normal request when two questions are pending', async () => {
        const t = setup();
        const a = setup();
        // Two independent turns posting into the same chat.
        const shared = new AskUserQuestionRelayHub({ store: t.store as any });
        let n = 0;
        shared.register({ platform: 'whatsapp', locate: () => ({ chatKey: 'group' }), post: async () => `q${++n}` });
        for (const s of [t, a]) {
            const tool = createAskUserTool({
                computeTurnIndex: () => 1,
                emitQuestions: (payloads, control) => { shared.relay({ processId: 'p', requestId: 'r', questions: payloads, control }); },
            });
            void (tool.tool.handler as any)({ questions: [{ question: 'Q?', type: 'text' }] });
        }
        await vi.waitFor(() => expect(shared.pendingCount('group')).toBe(2));
        const inbound = { chatKey: 'group', messageId: 'plain', text: 'hi', reply: vi.fn(), acknowledge: vi.fn() };
        expect(await shared.tryAnswer('whatsapp', inbound)).toBe(false);
        expect(await shared.tryAnswer('whatsapp', { ...inbound, messageId: 'quoted', replyToId: 'q2' })).toBe(true);
        expect(shared.pendingCount('group')).toBe(1);
    });
});
