import { afterEach, describe, expect, it } from 'vitest';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('health contract', () => {
  let harness: ContractHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('reads health and OpenAPI metadata from a real server', async () => {
    harness = await startContractHarness();

    await expect(harness.client.health.get()).resolves.toMatchObject({ status: 'ok' });
    await expect(harness.client.health.openApi()).resolves.toEqual(expect.any(Object));
  });
});
