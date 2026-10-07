/**
 * Copilot-backed decision evaluation through the one-shot `transform()`
 * primitive (same isolation pattern as title generation): no session visible
 * to callers, no MCP servers or tools, permissions denied, workspace root as
 * `cwd`, and a fixed model with no silent fallback.
 */

import { denyAllPermissions, type ISDKService } from '@plusplusoneplusplus/forge';
import type { DecisionResponse, DecisionUsage } from '@plusplusoneplusplus/coc-client';
import {
    DecisionBackendError,
    type DecisionBackend,
    type DecisionContext,
    type ValidatedDecisionRequest,
} from './decision-backend';
import { buildDecisionPrompt, buildRepairPrompt } from './decision-prompt';
import { parseDecisionOutput } from './decision-validation';

/** Fixed decision model. Intentionally absent from the user-facing model registry. */
export const COPILOT_DECISION_MODEL = 'gpt-5.4-mini';
export const COPILOT_DECISION_TIMEOUT_MS = 120_000;
/** Initial prompt plus at most one repair attempt. */
export const COPILOT_DECISION_MAX_ATTEMPTS = 2;

type TransformResult = Awaited<ReturnType<ISDKService['transform']>>;

export interface CopilotDecisionBackendOptions {
    timeoutMs?: number;
}

function addUsage(total: DecisionUsage | undefined, result: TransformResult): DecisionUsage | undefined {
    const usage = result.tokenUsage ?? result.providerDiagnostics?.tokenCounts;
    if (!usage) return total;
    return {
        inputTokens: (total?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
        outputTokens: (total?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
        totalTokens: (total?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
    };
}

export class CopilotDecisionBackend implements DecisionBackend {
    readonly name = 'copilot' as const;
    private readonly timeoutMs: number;

    constructor(private readonly service: ISDKService | undefined, options: CopilotDecisionBackendOptions = {}) {
        this.timeoutMs = options.timeoutMs ?? COPILOT_DECISION_TIMEOUT_MS;
    }

    async evaluate(request: ValidatedDecisionRequest, context: DecisionContext): Promise<DecisionResponse> {
        await this.requireAvailable();

        let prompt = buildDecisionPrompt(request);
        let usage: DecisionUsage | undefined;
        for (let attempt = 1; attempt <= COPILOT_DECISION_MAX_ATTEMPTS; attempt++) {
            const result = await this.invoke(prompt, context);
            usage = addUsage(usage, result);
            const parsed = parseDecisionOutput(result.text, request);
            if (parsed.ok) {
                return {
                    model: COPILOT_DECISION_MODEL,
                    backend: this.name,
                    answers: parsed.answers,
                    ...(usage ? { usage } : {}),
                    metadata: { confidenceKind: 'self_reported', attempts: attempt, durationMs: 0 },
                };
            }
            if (attempt === COPILOT_DECISION_MAX_ATTEMPTS) {
                throw new DecisionBackendError({
                    code: 'DECISION_INVALID_OUTPUT',
                    status: 502,
                    message: `Copilot returned invalid decision output after ${attempt} attempts.`,
                    details: { errors: parsed.errors },
                });
            }
            prompt = buildRepairPrompt(request, result.text, parsed.errors);
        }
        throw new Error('unreachable');
    }

    private async requireAvailable(): Promise<void> {
        const availability = this.service && typeof this.service.isTransformAvailable === 'function'
            ? await this.service.isTransformAvailable({ model: COPILOT_DECISION_MODEL, loadDefaultMcpConfig: false })
            : undefined;
        if (!availability?.available) {
            throw new DecisionBackendError({
                code: 'DECISION_BACKEND_UNAVAILABLE',
                status: 503,
                message: `Copilot is unavailable${availability?.error ? `: ${availability.error}` : '.'}`,
                details: availability?.errorCode ? { providerErrorCode: availability.errorCode } : undefined,
            });
        }
    }

    /** One isolated `transform()` call bounded by the backend timeout and the caller's signal. */
    private async invoke(prompt: string, context: DecisionContext): Promise<TransformResult> {
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error('Decision request timed out'));
        }, this.timeoutMs);
        const onCallerAbort = () => controller.abort(context.signal?.reason);
        if (context.signal?.aborted) onCallerAbort();
        else context.signal?.addEventListener('abort', onCallerAbort, { once: true });

        let result: TransformResult | undefined;
        try {
            const aborted = new Promise<undefined>(resolve => {
                if (controller.signal.aborted) resolve(undefined);
                else controller.signal.addEventListener('abort', () => resolve(undefined), { once: true });
            });
            result = await Promise.race([
                this.service!.transform(prompt, {
                    model: COPILOT_DECISION_MODEL,
                    cwd: context.workingDirectory,
                    timeoutMs: this.timeoutMs,
                    signal: controller.signal,
                    loadDefaultMcpConfig: false,
                    onPermissionRequest: denyAllPermissions,
                }),
                aborted,
            ]);
        } catch (error) {
            if (!controller.signal.aborted) {
                throw new DecisionBackendError({
                    code: 'DECISION_UPSTREAM_FAILED',
                    status: 502,
                    message: `Copilot decision call failed: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        } finally {
            clearTimeout(timer);
            context.signal?.removeEventListener('abort', onCallerAbort);
        }

        if (timedOut) {
            throw new DecisionBackendError({
                code: 'DECISION_TIMEOUT',
                status: 504,
                message: `Copilot decision call timed out after ${this.timeoutMs}ms.`,
            });
        }
        if (controller.signal.aborted || !result) {
            throw new DecisionBackendError({ code: 'DECISION_CANCELLED', status: 499, message: 'Decision request was cancelled.' });
        }
        if (!result.success) {
            throw new DecisionBackendError({
                code: 'DECISION_UPSTREAM_FAILED',
                status: 502,
                message: `Copilot decision call failed: ${result.error || 'unknown error'}`,
                details: { providerErrorCode: result.errorCode, requestId: result.requestId, inferenceDispatched: result.inferenceDispatched },
            });
        }
        if (result.effectiveModel && result.effectiveModel !== COPILOT_DECISION_MODEL) {
            throw new DecisionBackendError({
                code: 'DECISION_MODEL_MISMATCH',
                status: 502,
                message: `Copilot used unexpected model '${result.effectiveModel}' (expected '${COPILOT_DECISION_MODEL}').`,
            });
        }
        return result;
    }
}
