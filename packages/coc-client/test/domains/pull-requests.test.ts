import { describe, expect, it } from 'vitest';
import { PullRequestsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('PullRequestsClient', () => {
  it('calls provider config endpoints with exact method, path, and body shapes', async () => {
    const adapter = createMockAdapter({ providers: {} });
    const client = new PullRequestsClient(adapter);

    await client.getProviderConfig();
    await client.saveProviderConfig({ github: { token: 'ghp_token' } });
    await client.saveProviderConfig({ ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' } });
    await client.saveProviderConfig({ tavily: { apiKey: 'tvly-key' } });

    expect(adapter.calls).toEqual([
      {
        path: '/providers/config',
        options: undefined,
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { github: { token: 'ghp_token' } },
        },
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { ado: { orgUrl: 'https://dev.azure.com/org', token: 'ado-token' } },
        },
      },
      {
        path: '/providers/config',
        options: {
          method: 'PUT',
          body: { tavily: { apiKey: 'tvly-key' } },
        },
      },
    ]);
  });
});
