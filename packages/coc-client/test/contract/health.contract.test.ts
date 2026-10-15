import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { startContractHarness, type ContractHarness } from './server-harness';

describe('health contract', () => {
  let harness: ContractHarness | undefined;

  afterEach(async () => {
    await harness?.close();
    harness = undefined;
  });

  it('reads health and OpenAPI metadata from a real server', async () => {
    harness = await startContractHarness();

    const savedIdentity = JSON.parse(fs.readFileSync(path.join(harness.dataDir, 'server-identity.json'), 'utf8'));
    expect(savedIdentity.serverIdentity).toMatch(/^[0-9a-f-]{36}$/);
    await expect(harness.client.health.get()).resolves.toMatchObject({
      status: 'ok', serverIdentity: savedIdentity.serverIdentity,
    });
    await expect(harness.client.health.openApi()).resolves.toEqual(expect.any(Object));
  });
});
