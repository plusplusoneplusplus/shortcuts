/**
 * Decision backend contract.
 *
 * A decision backend answers a batch of bounded Noul/Choice/Score questions
 * about caller-supplied state. It is deliberately separate from
 * `SDKServiceRegistry`, which holds conversational providers with sessions,
 * streaming, and tools.
 */

import type {
    ChoiceDecisionQuestion,
    DecisionBackendName,
    DecisionErrorCode,
    DecisionResponse,
    NoulDecisionQuestion,
    ScoreDecisionQuestion,
} from '@plusplusoneplusplus/coc-client';

export type ValidatedDecisionQuestion =
    | (NoulDecisionQuestion & { id: string })
    | (ChoiceDecisionQuestion & { id: string; options: string[] })
    | (ScoreDecisionQuestion & { id: string });

/** A request that passed `validateDecisionRequest()`. Questions keep request order. */
export interface ValidatedDecisionRequest {
    backend: DecisionBackendName;
    state: unknown;
    questions: ValidatedDecisionQuestion[];
}

export interface DecisionContext {
    workspaceId: string;
    workingDirectory: string;
    signal?: AbortSignal;
}

export interface DecisionBackend {
    readonly name: DecisionBackendName;
    evaluate(request: ValidatedDecisionRequest, context: DecisionContext): Promise<DecisionResponse>;
}

export class DecisionBackendError extends Error {
    readonly code: DecisionErrorCode;
    readonly status: number;
    readonly details?: unknown;

    constructor(init: { code: DecisionErrorCode; status: number; message: string; details?: unknown }) {
        super(init.message);
        this.name = 'DecisionBackendError';
        this.code = init.code;
        this.status = init.status;
        this.details = init.details;
    }
}
