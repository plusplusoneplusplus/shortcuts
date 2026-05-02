import { describe, expect, it } from 'vitest';
import { ModelsClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('ModelsClient', () => {
  it('lists models and updates enabled models without mutating caller input', async () => {
    const adapter = createMockAdapter({ enabledModels: ['a'] });
    const client = new ModelsClient(adapter);
    const enabled = ['a'];

    await client.list();
    await client.setEnabled(enabled);
    enabled.push('b');

    expect(adapter.calls[0]).toMatchObject({ path: '/models' });
    expect(adapter.calls[1]).toMatchObject({
      path: '/models/enabled',
      options: { method: 'PUT', body: { enabledModels: ['a'] } },
    });
  });
});
