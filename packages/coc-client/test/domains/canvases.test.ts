import { describe, expect, it } from 'vitest';
import { CanvasesClient } from '../../src';
import type { Canvas } from '../../src';
import { createMockAdapter } from './helpers';

const KUSTO_CANVAS: Canvas = {
  id: 'kusto-abc123',
  workspaceId: 'ws-1',
  title: 'Kusto Query',
  type: 'kusto',
  revision: 2,
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T00:00:01.000Z',
  lastEditor: 'user',
  content: '{"query":"StormEvents | take 10","clusterUrl":"https://help.kusto.windows.net","database":"Samples","columns":[],"rows":[],"truncated":false}',
};

describe('CanvasesClient (Kusto)', () => {
  it('create() posts the encoded canvas route with type "kusto" and body fields', async () => {
    const adapter = createMockAdapter({ canvas: KUSTO_CANVAS });
    const client = new CanvasesClient(adapter);

    const canvas = await client.create('ws one', {
      type: 'kusto',
      title: 'Kusto Query',
      content: '{"query":""}',
      processId: 'proc-1',
    });

    expect(adapter.calls[0].path).toBe('/workspaces/ws%20one/canvases');
    expect(adapter.calls[0].options?.method).toBe('POST');
    expect(adapter.calls[0].options?.body).toEqual({
      type: 'kusto',
      title: 'Kusto Query',
      content: '{"query":""}',
      processId: 'proc-1',
    });
    // Typed response preserves the discriminator.
    expect(canvas.type).toBe('kusto');
  });

  it('run() posts the encoded /:canvasId/run route with KQL overrides', async () => {
    const adapter = createMockAdapter({ canvas: KUSTO_CANVAS });
    const client = new CanvasesClient(adapter);

    const canvas = await client.run('ws/1', 'canvas/2', {
      query: 'StormEvents | take 10',
      clusterUrl: 'https://help.kusto.windows.net',
      database: 'Samples',
    });

    expect(adapter.calls[0].path).toBe('/workspaces/ws%2F1/canvases/canvas%2F2/run');
    expect(adapter.calls[0].options?.method).toBe('POST');
    expect(adapter.calls[0].options?.body).toEqual({
      query: 'StormEvents | take 10',
      clusterUrl: 'https://help.kusto.windows.net',
      database: 'Samples',
    });
    expect(canvas.type).toBe('kusto');
  });

  it('run() sends an empty body when no overrides are provided', async () => {
    const adapter = createMockAdapter({ canvas: KUSTO_CANVAS });
    const client = new CanvasesClient(adapter);

    await client.run('ws-1', 'kusto-abc123');

    expect(adapter.calls[0].path).toBe('/workspaces/ws-1/canvases/kusto-abc123/run');
    expect(adapter.calls[0].options?.body).toEqual({});
  });
});

/**
 * Read-only canvas files. The path encoding is the interesting part: the route
 * takes a whole RELATIVE path, so `/` must survive while every other character
 * in a segment is escaped.
 */
describe('CanvasesClient (files)', () => {
  const FILE = { path: 'data.csv', size: 4, encoding: 'utf-8' as const, content: 'a,b\n' };

  it('listFiles() GETs the files route and unwraps the array', async () => {
    const adapter = createMockAdapter({ files: [{ path: 'data.csv', size: 4, encoding: 'utf-8' }] });
    const client = new CanvasesClient(adapter);

    const files = await client.listFiles('ws one', 'board-1');

    expect(adapter.calls[0].path).toBe('/workspaces/ws%20one/canvases/board-1/files');
    expect(adapter.calls[0].options?.method ?? 'GET').toBe('GET');
    expect(files).toEqual([{ path: 'data.csv', size: 4, encoding: 'utf-8' }]);
  });

  it('listFiles() tolerates a response with no files array', async () => {
    const client = new CanvasesClient(createMockAdapter({}));
    await expect(client.listFiles('ws-1', 'board-1')).resolves.toEqual([]);
  });

  it('readFile() keeps separators and escapes everything else', async () => {
    const adapter = createMockAdapter({ file: FILE });
    const client = new CanvasesClient(adapter);

    const file = await client.readFile('ws-1', 'board-1', 'raw/my report.csv');

    expect(adapter.calls[0].path).toBe('/workspaces/ws-1/canvases/board-1/files/raw/my%20report.csv');
    expect(file).toEqual(FILE);
  });

  it('readFile() appends ?encoding=base64 only when asked', async () => {
    const adapter = createMockAdapter({ file: FILE });
    const client = new CanvasesClient(adapter);

    await client.readFile('ws-1', 'board-1', 'logo.png', { encoding: 'base64' });
    expect(adapter.calls[0].path).toBe('/workspaces/ws-1/canvases/board-1/files/logo.png?encoding=base64');

    await client.readFile('ws-1', 'board-1', 'logo.png');
    expect(adapter.calls[1].path).toBe('/workspaces/ws-1/canvases/board-1/files/logo.png');
  });

  it('readFile() escapes a canvas id and a path that need it', async () => {
    const adapter = createMockAdapter({ file: FILE });
    const client = new CanvasesClient(adapter);

    await client.readFile('ws/1', 'canvas/2', 'a b/c#d.csv');

    expect(adapter.calls[0].path).toBe('/workspaces/ws%2F1/canvases/canvas%2F2/files/a%20b/c%23d.csv');
  });
});
