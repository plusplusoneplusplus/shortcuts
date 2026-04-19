import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAskUserTool, type AskUserToolDeps, type AskUserSSEPayload, type AskUserResponse } from '../../../src/server/llm-tools/ask-user-tool';

describe('createAskUserTool', () => {
    let emitQuestion: ReturnType<typeof vi.fn>;
    let computeTurnIndex: ReturnType<typeof vi.fn>;
    let deps: AskUserToolDeps;

    beforeEach(() => {
        emitQuestion = vi.fn();
        computeTurnIndex = vi.fn().mockReturnValue(3);
        deps = { emitQuestion, computeTurnIndex };
    });

    // ========================================================================
    // Tool structure
    // ========================================================================

    it('returns a tool with name "ask_user"', () => {
        const { tool } = createAskUserTool(deps);
        expect(tool.name).toBe('ask_user');
    });

    it('has description, parameters, and handler', () => {
        const { tool } = createAskUserTool(deps);
        expect(tool.description).toBeDefined();
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
    });

    it('sets overridesBuiltInTool to true', () => {
        const { tool } = createAskUserTool(deps);
        expect(tool.overridesBuiltInTool).toBe(true);
    });

    it('parameters match the expected JSON schema', () => {
        const { tool } = createAskUserTool(deps);
        const params = tool.parameters as Record<string, unknown>;
        expect(params.type).toBe('object');
        expect(params.required).toEqual(['question', 'type']);
        const props = params.properties as Record<string, unknown>;
        expect(props.question).toBeDefined();
        expect(props.type).toBeDefined();
        expect(props.options).toBeDefined();
        expect(props.defaultValue).toBeDefined();
    });

    // ========================================================================
    // Handler emits SSE and returns a Promise
    // ========================================================================

    it('handler emits an SSE event with the question payload', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);

        const handlerPromise = tool.handler({
            question: 'Pick a color',
            type: 'select',
            options: [{ value: 'r', label: 'Red' }, { value: 'b', label: 'Blue' }],
        });

        expect(emitQuestion).toHaveBeenCalledTimes(1);
        const payload: AskUserSSEPayload = emitQuestion.mock.calls[0][0];
        expect(payload.question).toBe('Pick a color');
        expect(payload.type).toBe('select');
        expect(payload.options).toHaveLength(2);
        expect(payload.turnIndex).toBe(3);
        expect(payload.questionId).toBeDefined();

        // Resolve so the Promise completes
        answerQuestion(payload.questionId, 'r');
        const result = await handlerPromise;
        expect(result.answer).toBe('r');
        expect(result.skipped).toBe(false);
    });

    it('handler blocks until answerQuestion is called', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);
        let resolved = false;

        const handlerPromise = tool.handler({
            question: 'Yes or no?',
            type: 'yes-no',
        });
        handlerPromise.then(() => { resolved = true; });

        // Give microtasks time to flush
        await new Promise(r => setTimeout(r, 10));
        expect(resolved).toBe(false);

        const payload: AskUserSSEPayload = emitQuestion.mock.calls[0][0];
        answerQuestion(payload.questionId, true);

        const result = await handlerPromise;
        expect(resolved).toBe(true);
        expect(result.answer).toBe(true);
    });

    // ========================================================================
    // answerQuestion
    // ========================================================================

    it('answerQuestion resolves the pending question', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);

        const promise = tool.handler({ question: 'Name?', type: 'text' });
        const payload: AskUserSSEPayload = emitQuestion.mock.calls[0][0];

        const ok = answerQuestion(payload.questionId, 'Alice');
        expect(ok).toBe(true);

        const result = await promise;
        expect(result.questionId).toBe(payload.questionId);
        expect(result.answer).toBe('Alice');
        expect(result.skipped).toBe(false);
    });

    it('answerQuestion returns false for unknown questionId', () => {
        const { answerQuestion } = createAskUserTool(deps);
        expect(answerQuestion('non-existent-id', 'x')).toBe(false);
    });

    it('answerQuestion returns false if called twice on the same question', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);

        const promise = tool.handler({ question: 'Q', type: 'confirm' });
        const qid = (emitQuestion.mock.calls[0][0] as AskUserSSEPayload).questionId;

        expect(answerQuestion(qid, true)).toBe(true);
        expect(answerQuestion(qid, true)).toBe(false);

        await promise;
    });

    // ========================================================================
    // skipQuestion
    // ========================================================================

    it('skipQuestion resolves with skipped=true and answer=null', async () => {
        const { tool, skipQuestion } = createAskUserTool(deps);

        const promise = tool.handler({ question: 'Skip me', type: 'text' });
        const qid = (emitQuestion.mock.calls[0][0] as AskUserSSEPayload).questionId;

        const ok = skipQuestion(qid);
        expect(ok).toBe(true);

        const result = await promise;
        expect(result.answer).toBeNull();
        expect(result.skipped).toBe(true);
        expect(result.reason).toBe('user-skipped');
    });

    it('skipQuestion returns false for unknown questionId', () => {
        const { skipQuestion } = createAskUserTool(deps);
        expect(skipQuestion('bogus')).toBe(false);
    });

    // ========================================================================
    // cancelAll
    // ========================================================================

    it('cancelAll resolves all pending questions with cancelled reason', async () => {
        const { tool, cancelAll } = createAskUserTool(deps);

        const p1 = tool.handler({ question: 'Q1', type: 'text' });
        const p2 = tool.handler({ question: 'Q2', type: 'confirm' });

        cancelAll();

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.skipped).toBe(true);
        expect(r1.reason).toBe('cancelled');
        expect(r1.answer).toBeNull();
        expect(r2.skipped).toBe(true);
        expect(r2.reason).toBe('cancelled');
    });

    it('cancelAll is safe to call when nothing is pending', () => {
        const { cancelAll } = createAskUserTool(deps);
        expect(() => cancelAll()).not.toThrow();
    });

    // ========================================================================
    // hasPending
    // ========================================================================

    it('hasPending returns false initially', () => {
        const { hasPending } = createAskUserTool(deps);
        expect(hasPending()).toBe(false);
    });

    it('hasPending returns true after handler is called', async () => {
        const { tool, hasPending, answerQuestion } = createAskUserTool(deps);

        tool.handler({ question: 'Q', type: 'text' });
        expect(hasPending()).toBe(true);

        const qid = (emitQuestion.mock.calls[0][0] as AskUserSSEPayload).questionId;
        answerQuestion(qid, 'done');
        expect(hasPending()).toBe(false);
    });

    it('hasPending becomes false after cancelAll', async () => {
        const { tool, hasPending, cancelAll } = createAskUserTool(deps);

        tool.handler({ question: 'Q', type: 'text' });
        expect(hasPending()).toBe(true);

        cancelAll();
        expect(hasPending()).toBe(false);
    });

    // ========================================================================
    // Multiple concurrent questions
    // ========================================================================

    it('supports multiple concurrent questions', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);

        const p1 = tool.handler({ question: 'Q1', type: 'select', options: [{ value: 'a', label: 'A' }] });
        const p2 = tool.handler({ question: 'Q2', type: 'text' });

        const qid1 = (emitQuestion.mock.calls[0][0] as AskUserSSEPayload).questionId;
        const qid2 = (emitQuestion.mock.calls[1][0] as AskUserSSEPayload).questionId;

        answerQuestion(qid2, 'second');
        answerQuestion(qid1, 'a');

        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1.answer).toBe('a');
        expect(r2.answer).toBe('second');
    });

    // ========================================================================
    // defaultValue and options passthrough
    // ========================================================================

    it('passes defaultValue through to the SSE payload', async () => {
        const { tool, answerQuestion } = createAskUserTool(deps);

        tool.handler({
            question: 'Multi',
            type: 'multi-select',
            options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
            defaultValue: ['a'],
        });

        const payload: AskUserSSEPayload = emitQuestion.mock.calls[0][0];
        expect(payload.defaultValue).toEqual(['a']);

        answerQuestion(payload.questionId, ['a', 'b']);
    });

    it('uses computeTurnIndex for each question', async () => {
        computeTurnIndex.mockReturnValueOnce(5).mockReturnValueOnce(7);
        const { tool, cancelAll } = createAskUserTool(deps);

        tool.handler({ question: 'Q1', type: 'text' });
        tool.handler({ question: 'Q2', type: 'text' });

        expect((emitQuestion.mock.calls[0][0] as AskUserSSEPayload).turnIndex).toBe(5);
        expect((emitQuestion.mock.calls[1][0] as AskUserSSEPayload).turnIndex).toBe(7);

        cancelAll();
    });
});
