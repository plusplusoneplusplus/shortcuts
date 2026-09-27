import { describe, expect, it } from 'vitest';
import { CocClient, DecisionsClient, type DecisionRequest, type DecisionResponse } from '../../src';
import { createMockAdapter } from './helpers';

const request: DecisionRequest = {
  state: { ticket: 'Login fails' },
  questions: {
    isBug: { type: 'noul', instructions: 'Is this a bug?' },
    area: { type: 'choice', instructions: 'Area?', criteria: { auth: 'Login', ui: null } },
    urgency: { type: 'score', instructions: 'Urgency?', criteria: ['low', 'high'] },
  },
};

const response: DecisionResponse = {
  model: 'gpt-5.4-mini',
  backend: 'copilot',
  answers: {
    isBug: { type: 'noul', value: 0.9, confidence: 0.53 },
    area: { type: 'choice', choice: 'auth', probabilities: { auth: 0.8, ui: 0.2 }, confidence: 0.28 },
    urgency: { type: 'score', score: 0.5, legend: { 0: 'low', 1: 'high' }, probabilities: { 0: 0.5, 1: 0.5 }, confidence: 0 },
  },
  metadata: { confidenceKind: 'self_reported', attempts: 1, durationMs: 12 },
};

describe('DecisionsClient', () => {
  it('POSTs the request to the encoded workspace-scoped path and returns the typed response', async () => {
    const adapter = createMockAdapter(response);
    const controller = new AbortController();
    const result = await new DecisionsClient(adapter).evaluate('ws/one é', request, { signal: controller.signal });

    expect(result).toEqual(response);
    expect(adapter.calls).toEqual([{
      path: '/workspaces/ws%2Fone%20%C3%A9/decisions/evaluate',
      options: { method: 'POST', body: request, signal: controller.signal },
    }]);
  });

  it('is exposed on CocClient', () => {
    expect(new CocClient({ baseUrl: 'http://localhost:4000', fetch: globalThis.fetch }).decisions).toBeInstanceOf(DecisionsClient);
  });
});
