import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAskUserTool, type AskUserToolDeps, type AskUserSSEPayload } from '../../../src/server/llm-tools/ask-user-tool';

describe('createAskUserTool', () => {
    let emitQuestions: ReturnType<typeof vi.fn>;
    let computeTurnIndex: ReturnType<typeof vi.fn>;
    let deps: AskUserToolDeps;

    beforeEach(() => {
        emitQuestions = vi.fn();
        computeTurnIndex = vi.fn().mockReturnValue(3);
        deps = { emitQuestions, computeTurnIndex };
    });

    it('returns a list-based ask_user tool schema', () => {
        const { tool } = createAskUserTool(deps);
        expect(tool.name).toBe('ask_user');
        expect(tool.overridesBuiltInTool).toBe(true);

        const params = tool.parameters as any;
        expect(params.required).toEqual(['questions']);
        expect(params.properties.questions.type).toBe('array');
        expect(params.properties.questions.items.required).toEqual(['question', 'type']);
    });

    it('emits one SSE payload per question with a shared batchId', async () => {
        const { tool, answerQuestions } = createAskUserTool(deps);

        const handlerPromise = tool.handler({
            questions: [
                { question: 'Pick a color', type: 'select', options: [{ value: 'r', label: 'Red' }] },
                { question: 'Explain why', type: 'text' },
            ],
        });

        expect(emitQuestions).toHaveBeenCalledTimes(1);
        const payloads = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
        expect(payloads).toHaveLength(2);
        expect(payloads[0].batchId).toBe(payloads[1].batchId);
        expect(payloads.map(p => p.index)).toEqual([0, 1]);
        expect(payloads.map(p => p.batchSize)).toEqual([2, 2]);
        expect(payloads.map(p => p.turnIndex)).toEqual([3, 3]);

        expect(answerQuestions([
            { questionId: payloads[0].questionId, answer: 'r' },
            { questionId: payloads[1].questionId, skipped: true },
        ])).toBe(true);

        await expect(handlerPromise).resolves.toEqual([
            { questionId: payloads[0].questionId, answer: 'r', skipped: false },
            { questionId: payloads[1].questionId, answer: null, skipped: true, reason: 'user-skipped' },
        ]);
    });

    it('handler blocks until every answer in the batch is resolved', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);
        let resolved = false;

        const handlerPromise = tool.handler({
            questions: [
                { question: 'Q1', type: 'yes-no' },
                { question: 'Q2', type: 'confirm' },
            ],
        });
        handlerPromise.then(() => { resolved = true; });

        await new Promise(r => setTimeout(r, 10));
        expect(resolved).toBe(false);

        const payloads = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
        expect(answerQuestion(payloads[0].questionId, true)).toBe(true);
        await new Promise(r => setTimeout(r, 10));
        expect(resolved).toBe(false);

        expect(answerQuestion(payloads[1].questionId, false)).toBe(true);
        const result = await handlerPromise;
        expect(resolved).toBe(true);
        expect(result.map(r => r.answer)).toEqual([true, false]);
    });

    it('answerQuestions is all-or-nothing for unknown questions or missing answers', async () => {
        const { tool, answerQuestions, cancelAll } = createAskUserTool(deps);
        const promise = tool.handler({ questions: [{ question: 'Q1', type: 'text' }, { question: 'Q2', type: 'text' }] });
        const payloads = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];

        expect(answerQuestions([{ questionId: payloads[0].questionId, answer: 'partial' }])).toBe(false);
        expect(answerQuestions([
            { questionId: payloads[0].questionId, answer: 'duplicate' },
            { questionId: payloads[0].questionId, answer: 'duplicate' },
        ])).toBe(false);
        expect(answerQuestions([
            { questionId: 'bogus', answer: 'nope' },
            { questionId: payloads[1].questionId, answer: 'ok' },
        ])).toBe(false);
        expect(answerQuestions([
            { questionId: payloads[0].questionId },
            { questionId: payloads[1].questionId, answer: 'ok' },
        ])).toBe(false);
        expect(answerQuestions([
            { questionId: payloads[0].questionId, answer: 'ok' },
            { questionId: payloads[1].questionId, skipped: true },
        ])).toBe(true);

        await expect(promise).resolves.toEqual([
            { questionId: payloads[0].questionId, answer: 'ok', skipped: false },
            { questionId: payloads[1].questionId, answer: null, skipped: true, reason: 'user-skipped' },
        ]);
        expect(() => cancelAll()).not.toThrow();
    });

    it('resolves need-more-context responses as deferred instead of skipped', async () => {
        const { tool, answerQuestions } = createAskUserTool(deps);
        const promise = tool.handler({
            questions: [
                { question: 'Q1', type: 'text' },
                { question: 'Q2', type: 'text' },
            ],
        });
        const payloads = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];

        expect(answerQuestions([
            { questionId: payloads[0].questionId, answer: 'known' },
            { questionId: payloads[1].questionId, deferred: true, reason: 'needs-context', note: ' Need the API boundary. ' },
        ])).toBe(true);

        await expect(promise).resolves.toEqual([
            { questionId: payloads[0].questionId, answer: 'known', skipped: false },
            {
                questionId: payloads[1].questionId,
                answer: null,
                skipped: false,
                deferred: true,
                reason: 'needs-context',
                note: 'Need the API boundary.',
                guidance: expect.stringContaining('Provide the missing context'),
            },
        ]);
    });

    it('skipQuestion and cancelAll resolve pending questions as skipped', async () => {
        const { tool, skipQuestion, cancelAll } = createAskUserTool(deps);

        const skippedPromise = tool.handler({ questions: [{ question: 'Skip me', type: 'text' }] });
        const skippedPayload = (emitQuestions.mock.calls[0][0] as AskUserSSEPayload[])[0];
        expect(skipQuestion(skippedPayload.questionId)).toBe(true);
        await expect(skippedPromise).resolves.toEqual([
            { questionId: skippedPayload.questionId, answer: null, skipped: true, reason: 'user-skipped' },
        ]);

        const cancelledPromise = tool.handler({ questions: [{ question: 'Cancel me', type: 'confirm' }] });
        const cancelledPayload = (emitQuestions.mock.calls[1][0] as AskUserSSEPayload[])[0];
        cancelAll();
        await expect(cancelledPromise).resolves.toEqual([
            { questionId: cancelledPayload.questionId, answer: null, skipped: true, reason: 'cancelled' },
        ]);
    });

    it('hasPending tracks all batched questions', async () => {
        const { tool, hasPending, answerQuestions } = createAskUserTool(deps);
        expect(hasPending()).toBe(false);

        const promise = tool.handler({ questions: [{ question: 'Q1', type: 'text' }, { question: 'Q2', type: 'text' }] });
        expect(hasPending()).toBe(true);

        const payloads = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
        answerQuestions(payloads.map(payload => ({ questionId: payload.questionId, answer: 'done' })));
        expect(hasPending()).toBe(false);
        await promise;
    });

    it('rejects empty question lists', async () => {
        const { tool } = createAskUserTool(deps);
        await expect(tool.handler({ questions: [] })).rejects.toThrow(/at least one question/);
    });
});
