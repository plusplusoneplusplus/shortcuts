import { describe, expect, it } from 'vitest';
import { SuggestionsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('SuggestionsClient', () => {
  it('issues GET /prompt-suggestions with prefix in query', async () => {
    const adapter = createMockAdapter({ completion: 'rest of text', source: 'history', historySource: 'initial' });
    const client = new SuggestionsClient(adapter);

    const res = await client.promptCompletion('fix the ');

    expect(res).toEqual({ completion: 'rest of text', source: 'history', historySource: 'initial' });
    expect(adapter.calls).toEqual([
      { path: '/prompt-suggestions', options: { query: { prefix: 'fix the ' } } },
    ]);
  });

  it('issues GET /prompt-suggestions with autocomplete context in query', async () => {
    const adapter = createMockAdapter({ completion: 'tests', source: 'ai' });
    const client = new SuggestionsClient(adapter);

    const res = await client.promptCompletion({
      prefix: 'fix the ',
      workspaceId: 'ws1',
      processId: 'p1',
      surface: 'follow-up',
      mode: 'hybrid',
    });

    expect(res).toEqual({ completion: 'tests', source: 'ai' });
    expect(adapter.calls).toEqual([
      {
        path: '/prompt-suggestions',
        options: {
          query: {
            prefix: 'fix the ',
            workspaceId: 'ws1',
            processId: 'p1',
            surface: 'follow-up',
            mode: 'hybrid',
          },
        },
      },
    ]);
  });

  it('passes through null completion responses', async () => {
    const adapter = createMockAdapter({ completion: null });
    const client = new SuggestionsClient(adapter);
    const res = await client.promptCompletion('xy');
    expect(res.completion).toBeNull();
  });
});
