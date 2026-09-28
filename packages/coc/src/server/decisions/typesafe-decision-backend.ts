import type { DecisionResponse } from '@plusplusoneplusplus/coc-client';
import { DecisionBackendError, type DecisionBackend } from './decision-backend';

/**
 * Placeholder for the TypeSafe backend. Accepting `backend: "typesafe"` now
 * keeps the future implementation an internal change. Performs no I/O.
 */
export class TypeSafeDecisionBackend implements DecisionBackend {
    readonly name = 'typesafe' as const;

    async evaluate(): Promise<DecisionResponse> {
        throw new DecisionBackendError({
            code: 'DECISION_BACKEND_NOT_IMPLEMENTED',
            status: 501,
            message: 'The TypeSafe decision backend is not implemented.',
        });
    }
}
