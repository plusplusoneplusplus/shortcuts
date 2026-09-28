import { describe, expect, it, vi } from 'vitest';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import { COPILOT_DECISION_MODEL, CopilotDecisionBackend } from '../../../src/server/decisions/copilot-decision-backend';
import { DecisionBackendError } from '../../../src/server/decisions/decision-backend';
import { validateDecisionRequest } from '../../../src/server/decisions/decision-validation';
import { DecisionService } from '../../../src/server/decisions/decision-service';
import { TypeSafeDecisionBackend } from '../../../src/server/decisions/typesafe-decision-backend';

const body = {
    state: { text: 'hello' },
    questions: {
        greet: { type: 'noul', instructions: 'Is this a greeting?' },
        tone: { type: 'choice', instructions: 'Tone?', criteria: { friendly: null, hostile: null } },
    },
};
const request = validateDecisionRequest(body);
const validText = JSON.stringify({
    answers: {
        greet: { type: 'noul', value: 0.9 },
        tone: { type: 'choice', probabilities: { friendly: 0.9, hostile: 0.1 } },
    },
});
const context = { workspaceId: 'ws-1', workingDirectory: '/repo/one' };

type TransformFn = ISDKService['transform'];

function ok(text: string, extra: Record<string, unknown> = {}) {
    return { success: true, text, effectiveModel: COPILOT_DECISION_MODEL, ...extra };
}

function createService(transform: TransformFn, available = true): ISDKService & { transform: ReturnType<typeof vi.fn> } {
    return {
        isAvailable: vi.fn().mockResolvedValue(available ? { available: true } : { available: false, error: 'SDK missing' }),
        transform: vi.fn(transform),
    } as unknown as ISDKService & { transform: ReturnType<typeof vi.fn> };
}

async function expectDecisionError(promise: Promise<unknown>, code: string, status: number): Promise<DecisionBackendError> {
    const error = await promise.then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(DecisionBackendError);
    expect(error).toMatchObject({ code, status });
    return error as DecisionBackendError;
}

describe('CopilotDecisionBackend', () => {
    it('evaluates all questions in one isolated transform call with the fixed model and workspace cwd', async () => {
        const service = createService(async () => ok(validText, { tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }));
        const response = await new CopilotDecisionBackend(service).evaluate(request, context);

        expect(service.transform).toHaveBeenCalledTimes(1);
        const [prompt, options] = service.transform.mock.calls[0];
        expect(prompt).toContain('"id": "greet"');
        expect(prompt).toContain('"id": "tone"');
        expect(options).toMatchObject({
            model: 'gpt-5.4-mini',
            cwd: '/repo/one',
            timeoutMs: 30_000,
            loadDefaultMcpConfig: false,
        });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        expect(options.onPermissionRequest({ kind: 'shell' }, { sessionId: 's' })).toEqual({ kind: 'reject' });

        expect(response).toMatchObject({
            model: 'gpt-5.4-mini',
            backend: 'copilot',
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            metadata: { confidenceKind: 'self_reported', attempts: 1 },
        });
        expect(response.answers.tone).toMatchObject({ type: 'choice', choice: 'friendly' });
    });

    it('does not retry after a valid response', async () => {
        const service = createService(async () => ok(validText));
        await new CopilotDecisionBackend(service).evaluate(request, context);
        expect(service.transform).toHaveBeenCalledTimes(1);
    });

    it('makes exactly one repair attempt with the invalid output and errors, and sums usage', async () => {
        const service = createService(async () => ok('oops', { tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }));
        service.transform
            .mockResolvedValueOnce(ok('{"answers":{"greet":{"type":"noul","value":0.9}}}', { tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }))
            .mockResolvedValueOnce(ok(validText, { tokenUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } }));
        const response = await new CopilotDecisionBackend(service).evaluate(request, context);

        expect(service.transform).toHaveBeenCalledTimes(2);
        const repairPrompt = service.transform.mock.calls[1][0] as string;
        expect(repairPrompt).toContain('{"answers":{"greet":{"type":"noul","value":0.9}}}');
        expect(repairPrompt).toContain("answers is missing question id 'tone'");
        expect(repairPrompt).toContain('REQUIRED OUTPUT SHAPE');
        expect(service.transform.mock.calls[1][1]).toMatchObject({ model: 'gpt-5.4-mini', loadDefaultMcpConfig: false });
        expect(response.metadata.attempts).toBe(2);
        expect(response.usage).toEqual({ inputTokens: 4, outputTokens: 3, totalTokens: 7 });
    });

    it('returns a typed 502 after the second invalid response and never tries a third time', async () => {
        const service = createService(async () => ok('still not json'));
        const error = await expectDecisionError(new CopilotDecisionBackend(service).evaluate(request, context), 'DECISION_INVALID_OUTPUT', 502);
        expect(service.transform).toHaveBeenCalledTimes(2);
        expect((error.details as { errors: string[] }).errors[0]).toContain('not valid JSON');
    });

    it('rejects an effective-model mismatch without falling back or retrying', async () => {
        const service = createService(async () => ok(validText, { effectiveModel: 'gpt-4.1' }));
        await expectDecisionError(new CopilotDecisionBackend(service).evaluate(request, context), 'DECISION_MODEL_MISMATCH', 502);
        expect(service.transform).toHaveBeenCalledTimes(1);
    });

    it('maps unavailable and missing services to 503', async () => {
        const unavailable = createService(async () => ok(validText), false);
        const error = await expectDecisionError(new CopilotDecisionBackend(unavailable).evaluate(request, context), 'DECISION_BACKEND_UNAVAILABLE', 503);
        expect(error.message).toContain('SDK missing');
        expect(unavailable.transform).not.toHaveBeenCalled();
        await expectDecisionError(new CopilotDecisionBackend(undefined).evaluate(request, context), 'DECISION_BACKEND_UNAVAILABLE', 503);
    });

    it('maps failed and throwing invocations to 502', async () => {
        const failed = createService(async () => ({ success: false, text: '', error: 'rate limited' }));
        const error = await expectDecisionError(new CopilotDecisionBackend(failed).evaluate(request, context), 'DECISION_UPSTREAM_FAILED', 502);
        expect(error.message).toContain('rate limited');
        const throwing = createService(async () => { throw new Error('socket closed'); });
        await expectDecisionError(new CopilotDecisionBackend(throwing).evaluate(request, context), 'DECISION_UPSTREAM_FAILED', 502);
    });

    it('times out with 504 and aborts the in-flight transform', async () => {
        let seenSignal: AbortSignal | undefined;
        const service = createService((_prompt, options) => {
            seenSignal = options?.signal;
            return new Promise(() => {});
        });
        await expectDecisionError(new CopilotDecisionBackend(service, { timeoutMs: 20 }).evaluate(request, context), 'DECISION_TIMEOUT', 504);
        expect(seenSignal?.aborted).toBe(true);
    });

    it('cancels when the caller signal aborts', async () => {
        const controller = new AbortController();
        let seenSignal: AbortSignal | undefined;
        const service = createService((_prompt, options) => {
            seenSignal = options?.signal;
            setTimeout(() => controller.abort(), 5);
            return new Promise(() => {});
        });
        await expectDecisionError(
            new CopilotDecisionBackend(service).evaluate(request, { ...context, signal: controller.signal }),
            'DECISION_CANCELLED',
            499,
        );
        expect(seenSignal?.aborted).toBe(true);
    });

    it('cancels immediately when the caller signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const service = createService(async () => ok(validText));
        await expectDecisionError(
            new CopilotDecisionBackend(service).evaluate(request, { ...context, signal: controller.signal }),
            'DECISION_CANCELLED',
            499,
        );
    });
});

describe('TypeSafeDecisionBackend', () => {
    it('returns a stable 501 without any I/O', async () => {
        const error = await expectDecisionError(new TypeSafeDecisionBackend().evaluate(), 'DECISION_BACKEND_NOT_IMPLEMENTED', 501);
        expect(error.message).toBe('The TypeSafe decision backend is not implemented.');
    });
});

describe('DecisionService', () => {
    it('selects the requested backend, defaulting to copilot, and stamps durationMs', async () => {
        const service = createService(async () => ok(validText));
        let now = 1_000;
        const decisions = new DecisionService([new CopilotDecisionBackend(service), new TypeSafeDecisionBackend()], () => (now += 250));
        const response = await decisions.evaluate(body, context);
        expect(response.backend).toBe('copilot');
        expect(response.metadata.durationMs).toBe(250);

        await expectDecisionError(decisions.evaluate({ ...body, backend: 'typesafe' }, context), 'DECISION_BACKEND_NOT_IMPLEMENTED', 501);
        expect(service.transform).toHaveBeenCalledTimes(1);
    });

    it('validates before calling any backend', async () => {
        const service = createService(async () => ok(validText));
        const decisions = new DecisionService([new CopilotDecisionBackend(service)]);
        await expectDecisionError(decisions.evaluate({ state: 's', questions: {} }, context), 'DECISION_INVALID_REQUEST', 400);
        expect(service.transform).not.toHaveBeenCalled();
    });

    it('normalizes unexpected backend errors to 502', async () => {
        const decisions = new DecisionService([{ name: 'copilot', evaluate: async () => { throw new Error('boom'); } }]);
        const error = await expectDecisionError(decisions.evaluate(body, context), 'DECISION_UPSTREAM_FAILED', 502);
        expect(error.message).toContain('boom');
    });
});
