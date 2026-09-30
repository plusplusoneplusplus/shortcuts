/**
 * Selects a decision backend and owns shared validation, timing, error
 * normalization, and telemetry.
 */

import type { DecisionBackendName, DecisionResponse } from '@plusplusoneplusplus/coc-client';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import { getServerLogger } from '../logging/server-logger';
import { DecisionBackendError, type DecisionBackend, type DecisionContext } from './decision-backend';
import { validateDecisionRequest } from './decision-validation';
import { CopilotDecisionBackend } from './copilot-decision-backend';
import { TypeSafeDecisionBackend } from './typesafe-decision-backend';

export class DecisionService {
    private readonly backends: Map<DecisionBackendName, DecisionBackend>;

    constructor(backends: DecisionBackend[], private readonly now: () => number = Date.now) {
        this.backends = new Map(backends.map(backend => [backend.name, backend]));
    }

    async evaluate(body: unknown, context: DecisionContext): Promise<DecisionResponse> {
        const request = validateDecisionRequest(body);
        const backend = this.backends.get(request.backend);
        if (!backend) {
            throw new DecisionBackendError({
                code: 'DECISION_BACKEND_NOT_IMPLEMENTED',
                status: 501,
                message: `The ${request.backend} decision backend is not registered.`,
            });
        }

        const startedAt = this.now();
        const telemetry = {
            workspaceId: context.workspaceId,
            backend: backend.name,
            questionCount: request.questions.length,
        };
        try {
            const response = await backend.evaluate(request, context);
            const durationMs = this.now() - startedAt;
            getServerLogger().info({ ...telemetry, attempts: response.metadata.attempts, durationMs, outcome: 'ok' }, 'Decision evaluated');
            return { ...response, metadata: { ...response.metadata, durationMs } };
        } catch (error) {
            const normalized = error instanceof DecisionBackendError
                ? error
                : new DecisionBackendError({
                    code: 'DECISION_UPSTREAM_FAILED',
                    status: 502,
                    message: `Decision backend failed: ${error instanceof Error ? error.message : String(error)}`,
                });
            getServerLogger().warn(
                { ...telemetry, durationMs: this.now() - startedAt, outcome: normalized.code },
                'Decision evaluation failed',
            );
            throw normalized;
        }
    }
}

/**
 * The server's decision service — explicitly Copilot-backed, never the
 * workspace's default chat provider. One instance is shared by the decision
 * route and the `system_one` chat tool.
 */
export function createDecisionService(copilotService: ISDKService | undefined): DecisionService {
    return new DecisionService([
        new CopilotDecisionBackend(copilotService),
        new TypeSafeDecisionBackend(),
    ]);
}
