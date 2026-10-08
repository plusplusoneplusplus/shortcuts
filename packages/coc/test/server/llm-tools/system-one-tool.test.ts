import { describe, it, expect, vi } from 'vitest';
import type { DecisionResponse } from '@plusplusoneplusplus/coc-client';
import { createSystemOneTool } from '../../../src/server/llm-tools/system-one-tool';
import { DecisionBackendError } from '../../../src/server/decisions/decision-backend';
import type { LedgerEntry } from '../../../src/server/executors/tool-call-ledger';

const RESPONSE: DecisionResponse = {
    model: 'gpt-6-luna',
    backend: 'copilot',
    answers: { is_breaking: { type: 'noul', value: 0.12, confidence: 0.8 } },
    usage: { inputTokens: 100, outputTokens: 10 },
    metadata: { confidenceKind: 'self_reported', attempts: 1, durationMs: 1830 },
};

const QUESTIONS = { is_breaking: { type: 'noul' as const, instructions: 'Does this break the API?' } };

function setup(entries: LedgerEntry[] = [], evaluate = vi.fn(async () => RESPONSE)) {
    const list = vi.fn(async ({ excludeId }: { excludeId?: string }) => entries.filter(e => e.id !== excludeId));
    const { tool } = createSystemOneTool({
        service: { evaluate },
        workspaceId: 'ws-1',
        workingDirectory: '/repo',
        getLedger: () => ({ list }),
    });
    const call = (args: unknown, invocation: Partial<{ toolCallId: string; signal: AbortSignal }> = {}) =>
        tool.handler!(args as any, { sessionId: 's', toolCallId: 'self', toolName: 'system_one', arguments: args, ...invocation } as any);
    return { tool, evaluate, list, call };
}

const bash = (id: string, result: string): LedgerEntry => ({ id, name: 'bash', status: 'completed', result, current: true });

describe('system_one tool', () => {
    it('resolves sources into labeled state and passes questions through', async () => {
        const { call, evaluate } = setup([bash('b1', 'diff output')]);
        const signal = new AbortController().signal;

        const raw = await call({ sources: [{ tool: 'bash' }, { text: 'targets release/3.4' }], questions: QUESTIONS }, { signal });

        expect(evaluate).toHaveBeenCalledWith(
            {
                backend: 'copilot',
                state: '### [1] tool bash #-1 (toolCallId b1, 11 bytes)\ndiff output\n\n### [2] text\ntargets release/3.4',
                questions: QUESTIONS,
            },
            { workspaceId: 'ws-1', workingDirectory: '/repo', signal },
        );
        expect(JSON.parse(raw as string)).toEqual({
            answers: RESPONSE.answers,
            sources: [{ ref: 'bash#-1', bytes: 11, toolCallId: 'b1' }, { ref: 'text', bytes: 19 }],
            model: 'gpt-6-luna',
            durationMs: 1830,
        });
    });

    it('excludes its own call using the invocation toolCallId', async () => {
        const { call, list } = setup([bash('b1', 'older'), bash('mine', 'self')]);
        const raw = await call({ sources: [{ tool: 'bash' }], questions: QUESTIONS }, { toolCallId: 'mine' });
        expect(list).toHaveBeenCalledWith(expect.objectContaining({ excludeId: 'mine' }));
        expect(JSON.parse(raw as string).sources[0].toolCallId).toBe('b1');
    });

    it('uses the workspace from deps, ignoring any workspace in args', async () => {
        const { call, evaluate } = setup();
        await call({ sources: [{ text: 'x' }], questions: QUESTIONS, workspaceId: 'other-ws' });
        expect(evaluate.mock.calls[0][1]).toMatchObject({ workspaceId: 'ws-1' });
    });

    it('returns source errors without calling the service', async () => {
        const { call, evaluate } = setup();
        const raw = await call({ sources: [{ tool: 'bash' }], questions: QUESTIONS });
        expect(JSON.parse(raw as string)).toMatchObject({ error: 'SOURCE_NOT_FOUND', source: 0 });
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('returns DECISION_INVALID_REQUEST for malformed args', async () => {
        const { call } = setup();
        expect(JSON.parse(await call({ questions: QUESTIONS }) as string).error).toBe('DECISION_INVALID_REQUEST');
        expect(JSON.parse(await call(undefined) as string).error).toBe('DECISION_INVALID_REQUEST');
    });

    it('maps decision errors to { error } results instead of throwing', async () => {
        const { call } = setup([], vi.fn(async () => {
            throw new DecisionBackendError({ code: 'DECISION_BACKEND_UNAVAILABLE', status: 503, message: 'Copilot is not configured.' });
        }));
        const raw = await call({ sources: [{ text: 'x' }], questions: QUESTIONS });
        expect(JSON.parse(raw as string)).toEqual({ error: 'DECISION_BACKEND_UNAVAILABLE', message: 'Copilot is not configured.' });
    });

    it('maps unexpected errors to DECISION_UPSTREAM_FAILED', async () => {
        const { call } = setup([], vi.fn(async () => { throw new Error('socket closed'); }));
        const raw = await call({ sources: [{ text: 'x' }], questions: QUESTIONS });
        expect(JSON.parse(raw as string)).toEqual({ error: 'DECISION_UPSTREAM_FAILED', message: 'socket closed' });
    });
});
