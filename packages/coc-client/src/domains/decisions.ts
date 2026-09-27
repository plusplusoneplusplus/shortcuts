import type { DecisionRequest, DecisionResponse } from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

/** Typed transport for the decision API. Model choice, normalization, and retries stay on the server. */
export class DecisionsClient {
  constructor(private readonly transport: RequestAdapter) {}

  evaluate(workspaceId: string, request: DecisionRequest, options: { signal?: AbortSignal } = {}): Promise<DecisionResponse> {
    return this.transport.request<DecisionResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/decisions/evaluate`,
      { method: 'POST', body: request, signal: options.signal },
    );
  }
}
