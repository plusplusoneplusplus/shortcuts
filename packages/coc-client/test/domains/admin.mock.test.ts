import { afterEach, describe, expect, it } from 'vitest';
import { CocApiError, CocClient } from '../../src';
import { startMockServer, type MockServer, type RecordedRequest } from '../mock-server';

describe('AdminClient mock server contract', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
  });

  it('round-trips admin configuration, stats, version, import, wipe, and restart routes', async () => {
    mock = await startMockServer();
    const config = { resolved: { model: 'gpt-5.4', parallel: 2 }, sources: { model: 'config' } };
    const preview = { valid: true, preview: { processCount: 2, workspaceCount: 1, wikiCount: 0 } };
    mock.on('GET', '/api/admin/data/stats', { body: { processCount: 2, wikiCount: 1, totalBytes: 128 } });
    mock.on('GET', '/api/admin/config', { body: config });
    mock.on('PUT', '/api/admin/config', request => ({ body: { ...config, updated: request.body } }));
    mock.on('GET', '/api/admin/version', { body: { version: '1.2.3', commit: 'abc123' } });
    mock.on('POST', '/api/admin/import/preview', { body: preview });
    mock.on('GET', '/api/admin/import-token', { body: { token: 'import-token', expiresIn: 300 } });
    mock.on('POST', '/api/admin/import', { body: { importedProcesses: 1, importedWorkspaces: 1, importedWikis: 0, importedQueueFiles: 0, importedBlobFiles: 0, importedScheduleFiles: 0, importedRepoPreferenceFiles: 0, errors: [] } });
    mock.on('GET', '/api/admin/data/wipe-token', { body: { token: 'wipe-token', expiresIn: 300 } });
    mock.on('DELETE', '/api/admin/data', { body: { deletedProcesses: 1, deletedWorkspaces: 1, deletedWikis: 0, deletedQueues: 0, deletedSchedules: 0, deletedGitOps: 0, deletedRepoPreferences: 0, deletedPreferences: false, deletedWikiDirs: [], preservedFiles: [], errors: [] } });
    mock.on('POST', '/api/admin/restart', { body: { message: 'Server is restarting...' } });
    const client = createClient(mock);

    await expect(client.admin.getDataStats({ includeWikis: true })).resolves.toMatchObject({ processCount: 2 });
    await expect(client.admin.getConfig()).resolves.toEqual(config);
    await expect(client.admin.updateConfig({ parallel: 3 })).resolves.toMatchObject({ updated: { parallel: 3 } });
    await expect(client.admin.getVersion()).resolves.toEqual({ version: '1.2.3', commit: 'abc123' });
    await expect(client.admin.previewImport({ version: 1 })).resolves.toEqual(preview);
    await expect(client.admin.getImportToken()).resolves.toEqual({ token: 'import-token', expiresIn: 300 });
    await expect(client.admin.importData({ version: 1 }, { token: 'import-token', mode: 'merge' })).resolves.toMatchObject({ importedProcesses: 1 });
    await expect(client.admin.getWipeToken()).resolves.toEqual({ token: 'wipe-token', expiresIn: 300 });
    await expect(client.admin.wipeData({ token: 'wipe-token', includeWikis: false })).resolves.toMatchObject({ deletedProcesses: 1 });
    await expect(client.admin.restart()).resolves.toEqual({ message: 'Server is restarting...' });

    expectEmptyRequest(mock.requests[0], 'GET', '/api/admin/data/stats', { includeWikis: 'true' });
    expectEmptyRequest(mock.requests[1], 'GET', '/api/admin/config');
    expectJsonRequest(mock.requests[2], 'PUT', '/api/admin/config', { parallel: 3 });
    expectJsonRequest(mock.requests[4], 'POST', '/api/admin/import/preview', { version: 1 });
    expectJsonRequest(mock.requests[6], 'POST', '/api/admin/import', { version: 1 }, { confirm: 'import-token', mode: 'merge' });
    expectEmptyRequest(mock.requests[8], 'DELETE', '/api/admin/data', { confirm: 'wipe-token', includeWikis: 'false' });
    expectEmptyRequest(mock.requests[9], 'POST', '/api/admin/restart');
  });

  it('sets up storage JSON and streaming routes with encoded confirmation tokens', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/admin/storage/status', { body: { backend: 'sqlite', stats: { processes: 2, workspaces: 1 }, dbPath: 'C:\\coc\\processes.db' } });
    mock.on('GET', '/api/admin/storage/migrate-token', { body: { token: 'migrate/token', expiresIn: 300 } });
    mock.on('POST', '/api/admin/storage/migrate', { rawBody: 'data: {"type":"done","success":true}\n\n', headers: { 'content-type': 'text/event-stream' } });
    mock.on('POST', '/api/admin/storage/migrate/cancel', { body: { success: true } });
    mock.on('POST', '/api/admin/storage/scan-directory', { body: { matched: [], unmatched: [], totalProcesses: 0, totalMatchedProcesses: 0 } });
    mock.on('GET', '/api/admin/storage/import-directory-token', { body: { token: 'dir/token', expiresIn: 300 } });
    mock.on('POST', '/api/admin/storage/import-directory', { rawBody: 'data: {"type":"done","success":true,"summary":{"imported":0,"skipped":0,"failed":0,"perWorkspace":[]}}\n\n', headers: { 'content-type': 'text/event-stream' } });
    const client = createClient(mock);

    await expect(client.admin.getStorageStatus()).resolves.toMatchObject({ backend: 'sqlite' });
    await expect(client.admin.getStorageMigrateToken()).resolves.toEqual({ token: 'migrate/token', expiresIn: 300 });
    await expect(client.admin.migrateStorageStream({ token: 'migrate/token', skipValidation: true }).then(response => response.text())).resolves.toContain('done');
    await expect(client.admin.cancelStorageMigration()).resolves.toEqual({ success: true });
    await expect(client.admin.scanStorageDirectory({ path: 'C:\\coc\\repos' })).resolves.toMatchObject({ totalProcesses: 0 });
    await expect(client.admin.getStorageImportDirectoryToken()).resolves.toEqual({ token: 'dir/token', expiresIn: 300 });
    await expect(client.admin.importStorageDirectoryStream({ token: 'dir/token', path: 'C:\\coc\\repos' }).then(response => response.text())).resolves.toContain('summary');

    expectEmptyRequest(mock.requests[0], 'GET', '/api/admin/storage/status');
    expectEmptyRequest(mock.requests[1], 'GET', '/api/admin/storage/migrate-token');
    expectEmptyRequest(mock.requests[2], 'POST', '/api/admin/storage/migrate', { confirm: 'migrate/token', skipValidation: '1' });
    expectEmptyRequest(mock.requests[3], 'POST', '/api/admin/storage/migrate/cancel');
    expectJsonRequest(mock.requests[4], 'POST', '/api/admin/storage/scan-directory', { path: 'C:\\coc\\repos' });
    expectEmptyRequest(mock.requests[5], 'GET', '/api/admin/storage/import-directory-token');
    expectJsonRequest(mock.requests[6], 'POST', '/api/admin/storage/import-directory', { path: 'C:\\coc\\repos' }, { confirm: 'dir/token' });
  });

  it('propagates admin validation errors as CocApiError instances', async () => {
    mock = await startMockServer();
    mock.on('PUT', '/api/admin/config', {
      status: 400,
      body: { error: 'parallel must be a number greater than 0' },
    });
    const client = createClient(mock);

    await expect(client.admin.updateConfig({ parallel: 0 })).rejects.toBeInstanceOf(CocApiError);
  });
});

function createClient(mock: MockServer): CocClient {
  return new CocClient({ baseUrl: mock.url, fetch: globalThis.fetch });
}

function expectEmptyRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: '',
    body: undefined,
  });
  expect(request.headers['content-type']).toBeUndefined();
}

function expectJsonRequest(
  request: RecordedRequest,
  method: string,
  path: string,
  body: unknown,
  query: Record<string, string> = {},
): void {
  expect(request).toMatchObject({
    method,
    path,
    query,
    rawBody: JSON.stringify(body),
    body,
  });
  expect(request.headers['content-type']).toBe('application/json');
}
