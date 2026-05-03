import { describe, expect, it } from 'vitest';
import { DbBrowserClient } from '../../src';
import { createMockAdapter } from './helpers';

describe('DbBrowserClient', () => {
  it('calls generic source-based db browser endpoints with safe paths and queries', async () => {
    const adapter = createMockAdapter({});
    const client = new DbBrowserClient(adapter);

    await client.listSources();
    await client.listTables('process-db');
    await client.listTables('repo-raw-memory-db', { repoId: 'repo/a' });
    await client.getTable('repo-raw-memory-db', 'raw_memory_records', {
      repoId: 'repo/a',
      page: 2,
      pageSize: 25,
      sort: 'content',
      order: 'asc',
    });
    await client.updateRow('process-db', 'processes', { pkColumns: { id: 'p-1' }, updates: { status: 'done' } });
    await client.deleteRow('process-db', 'processes', { pkColumns: { id: 'p-1' } });
    await client.deleteBulk('process-db', 'processes', { rows: [{ id: 'p-1' }, { id: 'p-2' }] });

    expect(adapter.calls).toEqual([
      { path: '/db-browser/sources', options: undefined },
      { path: '/db-browser/process-db/tables', options: { query: undefined } },
      { path: '/db-browser/repo-raw-memory-db/tables', options: { query: { repoId: 'repo/a' } } },
      {
        path: '/db-browser/repo-raw-memory-db/tables/raw_memory_records',
        options: { query: { repoId: 'repo/a', page: 2, pageSize: 25, sort: 'content', order: 'asc' } },
      },
      {
        path: '/db-browser/process-db/tables/processes/rows',
        options: { method: 'PUT', query: undefined, body: { pkColumns: { id: 'p-1' }, updates: { status: 'done' } } },
      },
      {
        path: '/db-browser/process-db/tables/processes/rows',
        options: { method: 'DELETE', query: undefined, body: { pkColumns: { id: 'p-1' } } },
      },
      {
        path: '/db-browser/process-db/tables/processes/rows/delete-bulk',
        options: { method: 'POST', query: undefined, body: { rows: [{ id: 'p-1' }, { id: 'p-2' }] } },
      },
    ]);
  });
});
