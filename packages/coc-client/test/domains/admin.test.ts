import { describe, expect, it } from 'vitest';
import { AdminClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('AdminClient', () => {
  it('calls admin JSON endpoints with typed request payloads and queries', async () => {
    const adapter = createMockAdapter({});
    const client = new AdminClient(adapter, {
      baseUrl: '',
      apiBasePath: '/api',
      fetch: globalThis.fetch,
      wsPath: '/ws',
    });

    await client.getPrompts();
    await client.getDataStats({ includeWikis: true });
    await client.getConfig();
    await client.updateConfig({ parallel: 2, output: 'json', 'chat.followUpSuggestions.count': 3 });
    await client.getVersion();
    await client.previewImport({ version: 1 });
    await client.getImportToken();
    await client.importData({ version: 1 }, { token: 'import-token', mode: 'merge' });
    await client.getWipeToken();
    await client.wipeData({ token: 'wipe-token', includeWikis: false });
    await client.restart();
    await client.getStorageStatus();
    await client.getStorageMigrateToken();
    await client.cancelStorageMigration();
    await client.scanStorageDirectory({ path: 'C:\\coc\\repos' });
    await client.getStorageImportDirectoryToken();

    expect(adapter.calls).toMatchObject([
      { path: '/admin/prompts' },
      { path: '/admin/data/stats', options: { query: { includeWikis: true } } },
      { path: '/admin/config' },
      {
        path: '/admin/config',
        options: { method: 'PUT', body: { parallel: 2, output: 'json', 'chat.followUpSuggestions.count': 3 } },
      },
      { path: '/admin/version' },
      { path: '/admin/import/preview', options: { method: 'POST', body: { version: 1 } } },
      { path: '/admin/import-token' },
      {
        path: '/admin/import',
        options: { method: 'POST', query: { confirm: 'import-token', mode: 'merge' }, body: { version: 1 } },
      },
      { path: '/admin/data/wipe-token' },
      {
        path: '/admin/data',
        options: { method: 'DELETE', query: { confirm: 'wipe-token', includeWikis: false } },
      },
      { path: '/admin/restart', options: { method: 'POST' } },
      { path: '/admin/storage/status' },
      { path: '/admin/storage/migrate-token' },
      { path: '/admin/storage/migrate/cancel', options: { method: 'POST' } },
      {
        path: '/admin/storage/scan-directory',
        options: { method: 'POST', body: { path: 'C:\\coc\\repos' } },
      },
      { path: '/admin/storage/import-directory-token' },
    ]);
  });

  it('passes signal option to getVersion', async () => {
    const adapter = createMockAdapter({});
    const client = new AdminClient(adapter, {
      baseUrl: '',
      apiBasePath: '/api',
      fetch: globalThis.fetch,
      wsPath: '/ws',
    });
    const controller = new AbortController();

    await client.getVersion({ signal: controller.signal });

    expect(adapter.calls[0]).toMatchObject({
      path: '/admin/version',
      options: { signal: controller.signal },
    });
  });

  it('passes force=1 for agent provider quota refreshes', async () => {
    const adapter = createMockAdapter({});
    const client = new AdminClient(adapter, {
      baseUrl: '',
      apiBasePath: '/api',
      fetch: globalThis.fetch,
      wsPath: '/ws',
    });

    await client.getAgentProvidersQuota();
    await client.getAgentProvidersQuota({ force: true });

    expect(adapter.calls).toMatchObject([
      { path: '/agent-providers/quota', options: undefined },
      { path: '/agent-providers/quota', options: { query: { force: '1' } } },
    ]);
  });

});
