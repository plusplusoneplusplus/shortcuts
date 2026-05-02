import { afterEach, describe, expect, it } from 'vitest';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('processes contract', () => {
  let harness: ContractHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('lists processes through the real route', async () => {
    harness = await startContractHarness();

    await expect(harness.client.processes.list({ limit: 10 })).resolves.toMatchObject({
      processes: expect.any(Array),
      total: expect.any(Number),
      limit: 10,
      offset: 0,
    });
  });
});
