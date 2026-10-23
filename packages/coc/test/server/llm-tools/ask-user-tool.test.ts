import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAskUserTool, parseSensitiveInputReceipt, type AskUserToolDeps, type AskUserSSEPayload, type AskUserEmitControl } from '../../../src/server/llm-tools/ask-user-tool';

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

    // ========================================================================
    // Non-interactive turns (cron / wakeup / trigger ticks)
    // ========================================================================

    describe('non-interactive turns', () => {
        it('resolves immediately as unavailable without emitting or pending', async () => {
            const { tool, hasPending } = createAskUserTool({ ...deps, isInteractive: () => false });

            const responses = await tool.handler({ questions: [{ question: 'Proceed?', type: 'confirm' }] });

            expect(responses).toHaveLength(1);
            expect(responses[0]).toMatchObject({ answer: null, skipped: true, reason: 'unavailable' });
            expect(responses[0].questionId).toEqual(expect.any(String));
            expect(responses[0].guidance).toBeTruthy();
            expect(emitQuestions).not.toHaveBeenCalled();
            expect(hasPending()).toBe(false);
        });

        it('returns one response per question with order preserved', async () => {
            const { tool } = createAskUserTool({ ...deps, isInteractive: () => false });

            const responses = await tool.handler({
                questions: [
                    { question: 'Q1', type: 'text' },
                    { question: 'Q2', type: 'text' },
                    { question: 'Q3', type: 'yes-no' },
                ],
            });

            expect(responses).toHaveLength(3);
            expect(new Set(responses.map(r => r.questionId)).size).toBe(3);
            expect(responses.every(r => r.reason === 'unavailable')).toBe(true);
        });

        it('reports the question count through onUnavailable', async () => {
            const onUnavailable = vi.fn();
            const { tool } = createAskUserTool({ ...deps, isInteractive: () => false, onUnavailable });

            await tool.handler({ questions: [{ question: 'Q1', type: 'text' }, { question: 'Q2', type: 'text' }] });

            expect(onUnavailable).toHaveBeenCalledWith(2);
        });

        it('still blocks when isInteractive returns true', async () => {
            const { tool, answerQuestion } = createAskUserTool({ ...deps, isInteractive: () => true });

            const promise = tool.handler({ questions: [{ question: 'Pick', type: 'text' }] });
            const payload = (emitQuestions.mock.calls[0][0] as AskUserSSEPayload[])[0];
            answerQuestion(payload.questionId, 'yes');

            await expect(promise).resolves.toEqual([
                { questionId: payload.questionId, answer: 'yes', skipped: false },
            ]);
        });

        it('blocks as before when isInteractive is omitted (existing call sites)', async () => {
            const { tool, hasPending, answerQuestion } = createAskUserTool(deps);

            const promise = tool.handler({ questions: [{ question: 'Pick', type: 'text' }] });
            expect(emitQuestions).toHaveBeenCalledTimes(1);
            expect(hasPending()).toBe(true);

            const payload = (emitQuestions.mock.calls[0][0] as AskUserSSEPayload[])[0];
            answerQuestion(payload.questionId, 'ok');
            await expect(promise).resolves.toEqual([
                { questionId: payload.questionId, answer: 'ok', skipped: false },
            ]);
        });

        it('keeps the tool description mode-neutral', () => {
            const { tool } = createAskUserTool(deps);
            // The description is part of the serialized tool block. It must not
            // mention a chat mode, or the block stops being mode-invariant in
            // spirit even while it stays byte-identical.
            expect(tool.description).not.toMatch(/autopilot/i);
            expect(tool.description).toContain('never in unattended or automated runs');
        });
    });
});

describe('createAskUserTool sensitive-input', () => {
    const cookieQuestion = {
        question: 'Paste your example.com cookies',
        type: 'sensitive-input' as const,
        sink: 'browser.cookies' as const,
        sinkArgs: { domain: ' example.com ', viewId: 'view-1' },
    };

    function setup(overrides: Partial<AskUserToolDeps> = {}) {
        const emitQuestions = vi.fn();
        const deps: AskUserToolDeps = {
            emitQuestions,
            computeTurnIndex: () => 0,
            isSensitiveInputEnabled: () => true,
            ...overrides,
        };
        return { emitQuestions, ...createAskUserTool(deps) };
    }

    it('keeps the default schema unchanged when the flag is off or unset', () => {
        for (const deps of [{}, { isSensitiveInputEnabled: () => false }]) {
            const params = createAskUserTool({ emitQuestions: vi.fn(), computeTurnIndex: () => 0, ...deps }).tool.parameters as any;
            const item = params.properties.questions.items;
            expect(item.properties.type.enum).toEqual(['select', 'multi-select', 'yes-no', 'confirm', 'text', 'textarea']);
            expect(item.properties.sink).toBeUndefined();
            expect(item.properties.sinkArgs).toBeUndefined();
        }
    });

    it('lists sensitive-input with its sink and sinkArgs when the flag is on', () => {
        const { tool } = setup();
        const item = (tool.parameters as any).properties.questions.items;
        expect(item.properties.type.enum).toContain('sensitive-input');
        expect(item.properties.sink.enum).toEqual(['browser.cookies']);
        expect(item.properties.sinkArgs.required).toEqual(['domain']);
        expect(tool.description).toContain('sensitive-input');
    });

    it('refuses sensitive-input when the flag is off', async () => {
        const { tool, emitQuestions } = setup({ isSensitiveInputEnabled: () => false });
        await expect(tool.handler({ questions: [cookieQuestion] })).rejects.toThrow(/not enabled/);
        expect(emitQuestions).not.toHaveBeenCalled();
    });

    it('re-reads the flag at call time', async () => {
        let enabled = true;
        const { tool } = setup({ isSensitiveInputEnabled: () => enabled });
        enabled = false;
        await expect(tool.handler({ questions: [cookieQuestion] })).rejects.toThrow(/not enabled/);
    });

    it.each([
        ['an unknown sink', { ...cookieQuestion, sink: 'secret.store' as any }, /sink/],
        ['a missing sink', { ...cookieQuestion, sink: undefined }, /sink/],
        ['missing sinkArgs', { ...cookieQuestion, sinkArgs: undefined }, /domain/],
        ['a blank domain', { ...cookieQuestion, sinkArgs: { domain: '  ' } }, /domain/],
        ['a non-string viewId', { ...cookieQuestion, sinkArgs: { domain: 'a.com', viewId: 3 as any } }, /viewId/],
    ])('rejects %s', async (_label, question, error) => {
        const { tool, emitQuestions } = setup();
        await expect(tool.handler({ questions: [question] })).rejects.toThrow(error);
        expect(emitQuestions).not.toHaveBeenCalled();
    });

    it('emits sink and normalized sinkArgs, without options or defaultValue', async () => {
        const { tool, emitQuestions, cancelAll } = setup();
        const pending = tool.handler({
            questions: [{ ...cookieQuestion, options: [{ value: 'x', label: 'X' }], defaultValue: 'x' }],
        });
        const [payload] = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
        expect(payload.type).toBe('sensitive-input');
        expect(payload.sink).toBe('browser.cookies');
        expect(payload.sinkArgs).toEqual({ domain: 'example.com', viewId: 'view-1' });
        expect(payload).not.toHaveProperty('options');
        expect(payload).not.toHaveProperty('defaultValue');
        cancelAll();
        await pending;
    });

    it('does not add sink fields to ordinary questions', async () => {
        const { tool, emitQuestions, cancelAll } = setup();
        const pending = tool.handler({ questions: [{ question: 'Name?', type: 'text' }] });
        const [payload] = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
        expect(payload).not.toHaveProperty('sink');
        expect(payload).not.toHaveProperty('sinkArgs');
        cancelAll();
        await pending;
    });

    it('answers unavailable with desktop guidance on a non-interactive turn', async () => {
        const { tool, emitQuestions } = setup({ isInteractive: () => false });
        const [sensitive, plain] = await tool.handler({
            questions: [cookieQuestion, { question: 'Name?', type: 'text' }],
        });
        expect(emitQuestions).not.toHaveBeenCalled();
        expect(sensitive).toMatchObject({ answer: null, skipped: true, reason: 'unavailable' });
        expect(sensitive.guidance).toMatch(/CoC desktop/);
        expect(plain.guidance).not.toMatch(/CoC desktop/);
    });

    it('resolveUnavailable gives a pending sensitive-input question the desktop guidance', async () => {
        const { tool, emitQuestions } = setup();
        const pending = tool.handler({ questions: [cookieQuestion] });
        const [payloads, control] = emitQuestions.mock.calls[0] as [AskUserSSEPayload[], AskUserEmitControl];
        expect(control.resolveUnavailable(payloads[0].questionId)).toBe(true);
        const [response] = await pending;
        expect(response).toMatchObject({ questionId: payloads[0].questionId, skipped: true, reason: 'unavailable' });
        expect(response.guidance).toMatch(/CoC desktop/);
    });

    describe('receipts', () => {
        async function ask(extra: Partial<AskUserToolDeps> = {}) {
            const tools = setup(extra);
            const result = tools.tool.handler({ questions: [cookieQuestion] });
            const [payloads, control] = tools.emitQuestions.mock.calls[0] as [AskUserSSEPayload[], AskUserEmitControl];
            return { ...tools, result, questionId: payloads[0].questionId, control };
        }

        it('answers with { ok, sink, domain, count } built from the question', async () => {
            const { answerQuestions, result, questionId } = await ask();
            expect(answerQuestions([{ questionId, receipt: { ok: true, count: 2 } }])).toBe(true);
            const [response] = await result;
            expect(response).toEqual({
                questionId,
                skipped: false,
                answer: { ok: true, sink: 'browser.cookies', domain: 'example.com', count: 2 },
            });
        });

        it('answers a failed import with a reason code only', async () => {
            const { answerQuestions, result, questionId } = await ask();
            expect(answerQuestions([{ questionId, receipt: { ok: false, reason: 'invalid-input' } }])).toBe(true);
            const [response] = await result;
            expect(response.answer).toEqual({ ok: false, sink: 'browser.cookies', domain: 'example.com', reason: 'invalid-input' });
        });

        it.each([
            ['a plain answer', { answer: 'a=1; b=2' }],
            ['a receipt plus an answer', { answer: 'a=1', receipt: { ok: true, count: 1 } }],
            ['no receipt', {}],
            ['a receipt with extra keys', { receipt: { ok: true, count: 1, names: ['a'] } as any }],
            ['a negative count', { receipt: { ok: true, count: -1 } }],
            ['a fractional count', { receipt: { ok: true, count: 1.5 } }],
            ['a free-text reason', { receipt: { ok: false, reason: 'bad cookie a=1' } as any }],
            ['a count on a failure', { receipt: { ok: false, reason: 'import-failed', count: 1 } as any }],
        ])('rejects %s and keeps the question pending', async (_label, input) => {
            const { answerQuestions, cancelAll, result, questionId, control } = await ask();
            expect(answerQuestions([{ questionId, ...input }])).toBe(false);
            expect(control.isPending(questionId)).toBe(true);
            cancelAll();
            await result;
        });

        it('refuses single-answer paths so a relay cannot deliver the secret', async () => {
            const { answerQuestion, cancelAll, result, questionId, control } = await ask();
            expect(answerQuestion(questionId, 'a=1')).toBe(false);
            expect(control.answer(questionId, 'a=1')).toBe(false);
            expect(control.isPending(questionId)).toBe(true);
            cancelAll();
            await result;
        });

        it('keeps skip and need-more-context working', async () => {
            const skipped = await ask();
            expect(skipped.answerQuestions([{ questionId: skipped.questionId, skipped: true }])).toBe(true);
            expect((await skipped.result)[0]).toMatchObject({ skipped: true, reason: 'user-skipped', answer: null });

            const deferred = await ask();
            expect(deferred.answerQuestions([{ questionId: deferred.questionId, deferred: true, reason: 'needs-context' }])).toBe(true);
            expect((await deferred.result)[0]).toMatchObject({ deferred: true, reason: 'needs-context', answer: null });
        });

        it('answers unavailable with desktop guidance when the dashboard has no bridge', async () => {
            const { answerQuestions, result, questionId } = await ask();
            expect(answerQuestions([{ questionId, skipped: true, reason: 'unavailable' }])).toBe(true);
            const [response] = await result;
            expect(response).toMatchObject({ skipped: true, reason: 'unavailable', answer: null });
            expect(response.guidance).toContain('CoC desktop');
        });

        it('rejects unavailable without skipped or on an ordinary question', async () => {
            const sensitive = await ask();
            expect(sensitive.answerQuestions([{ questionId: sensitive.questionId, reason: 'unavailable' }])).toBe(false);
            expect(sensitive.control.isPending(sensitive.questionId)).toBe(true);
            sensitive.cancelAll();
            await sensitive.result;

            const { tool, emitQuestions, answerQuestions, cancelAll } = setup();
            const result = tool.handler({ questions: [{ question: 'Name?', type: 'text' }] });
            const [payload] = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
            expect(answerQuestions([{ questionId: payload.questionId, skipped: true, reason: 'unavailable' }])).toBe(false);
            cancelAll();
            await result;
        });

        it('rejects a receipt on an ordinary question', async () => {
            const { tool, emitQuestions, answerQuestions, cancelAll } = setup();
            const result = tool.handler({ questions: [{ question: 'Name?', type: 'text' }] });
            const [payload] = emitQuestions.mock.calls[0][0] as AskUserSSEPayload[];
            expect(answerQuestions([{ questionId: payload.questionId, answer: 'x', receipt: { ok: true, count: 1 } }])).toBe(false);
            cancelAll();
            await result;
        });
    });
});

describe('parseSensitiveInputReceipt', () => {
    it.each([
        [{ ok: true, count: 0 }, { ok: true, count: 0 }],
        [{ ok: false, reason: 'import-failed' }, { ok: false, reason: 'import-failed' }],
        [{ ok: true }, null],
        [{ ok: 'yes', count: 1 }, null],
        [[], null],
        ['{"ok":true,"count":1}', null],
        [null, null],
    ])('parses %j as %j', (input, expected) => {
        expect(parseSensitiveInputReceipt(input)).toEqual(expected);
    });
});


describe('textarea drafts', () => {
    it.each([123, [], null, 'é'.repeat(16385)])('rejects invalid defaultValue %j', async defaultValue => {
        const emitQuestions = vi.fn();
        const { tool } = createAskUserTool({ emitQuestions, computeTurnIndex: () => 0 });
        await expect(tool.handler({ questions: [{ type: 'textarea', question: 'Draft', defaultValue }] } as any)).rejects.toThrow(/defaultValue/);
        expect(emitQuestions).not.toHaveBeenCalled();
    });

    it('rejects options, including an empty array', async () => {
        const { tool } = createAskUserTool({ emitQuestions: vi.fn(), computeTurnIndex: () => 0 });
        await expect(tool.handler({ questions: [{ type: 'textarea', question: 'Draft', options: [] }] })).rejects.toThrow(/options/);
    });

    it.each([
        ['Hi\r\nAlex', 'Hi\nAlex', false],
        ['Hi Alex', ' Hi Alex ', true],
        [undefined, 'New\nmessage', true],
        ['é'.repeat(16384), 'é'.repeat(16384), false],
    ])('computes edited and preserves the returned text', async (defaultValue, answer, edited) => {
        let questionId = '';
        const instance = createAskUserTool({ computeTurnIndex: () => 0, emitQuestions: questions => { questionId = questions[0].questionId; } });
        const result = instance.tool.handler({ questions: [{ type: 'textarea', question: 'Draft', defaultValue: defaultValue as string | undefined }] });
        expect(instance.answerQuestion(questionId, answer as string)).toBe(true);
        await expect(result).resolves.toEqual([{ questionId, answer, skipped: false, edited }]);
    });

    it('rejects empty, non-string and oversized answers without settling any batch question', async () => {
        let ids: string[] = [];
        const instance = createAskUserTool({ computeTurnIndex: () => 0, emitQuestions: questions => { ids = questions.map(q => q.questionId); } });
        const result = instance.tool.handler({ questions: [{ type: 'text', question: 'Other' }, { type: 'textarea', question: 'Draft', defaultValue: 'Draft' }] });
        for (const answer of ['', true, [], '😀'.repeat(8193)]) {
            expect(instance.answerQuestion(ids[1], answer)).toBe(false);
            expect(instance.answerQuestions([{ questionId: ids[0], answer: 'ok' }, { questionId: ids[1], answer }])).toBe(false);
            expect(instance.hasPending()).toBe(true);
        }
        expect(instance.answerQuestions([{ questionId: ids[0], answer: 'ok' }, { questionId: ids[1], answer: 'Draft' }])).toBe(true);
        expect((await result)[1]).toMatchObject({ edited: false });
    });
});
