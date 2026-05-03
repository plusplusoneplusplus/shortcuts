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

  it('calls db browser endpoints with correct paths and bodies', async () => {
    const adapter = createMockAdapter({});
    const client = new AdminClient(adapter, {
      baseUrl: '',
      apiBasePath: '/api',
      fetch: globalThis.fetch,
      wsPath: '/ws',
    });

    await client.db.listTables();
    await client.db.getTable('processes', { page: 2, pageSize: 25, sort: 'id', order: 'asc' });
    await client.db.updateRow('processes', { pkColumns: { id: 'p-1' }, updates: { status: 'done' } });
    await client.db.deleteRow('processes', { pkColumns: { id: 'p-1' } });
    await client.db.deleteBulk('processes', { rows: [{ id: 'p-1' }, { id: 'p-2' }] });

    expect(adapter.calls).toMatchObject([
      { path: '/admin/db/tables' },
      {
        path: '/admin/db/tables/processes',
        options: { query: { page: 2, pageSize: 25, sort: 'id', order: 'asc' } },
      },
      {
        path: '/admin/db/tables/processes/rows',
        options: { method: 'PUT', body: { pkColumns: { id: 'p-1' }, updates: { status: 'done' } } },
      },
      {
        path: '/admin/db/tables/processes/rows',
        options: { method: 'DELETE', body: { pkColumns: { id: 'p-1' } } },
      },
      {
        path: '/admin/db/tables/processes/rows/delete-bulk',
        options: { method: 'POST', body: { rows: [{ id: 'p-1' }, { id: 'p-2' }] } },
      },
    ]);
  });
});
