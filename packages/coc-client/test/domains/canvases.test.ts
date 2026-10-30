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

describe('CanvasesClient (Copilot extensions)', () => {
  it('reopens the saved canvas using encoded owner and canvas segments', async () => {
    const response = {
      success: true, canvasId: 'canvas/2', instanceId: 'instance-1',
      title: 'Extension', extensionKey: 'ws/1:board', embed: 'canvas://canvas/2',
      url: 'http://127.0.0.1:3210/',
    };
    const adapter = createMockAdapter(response);
    const client = new CanvasesClient(adapter);
    expect(await client.openCopilotExtension('ws/1', 'canvas/2')).toEqual(response);
    expect(adapter.calls[0]).toMatchObject({
      path: '/workspaces/ws%2F1/canvases/canvas%2F2/copilot-extension/open',
      options: { method: 'POST', body: {} },
    });
  });

  it('preserves a reopening response without a URL', async () => {
    const response = {
      success: true, canvasId: 'canvas-1', instanceId: 'instance-1',
      title: 'Extension', extensionKey: 'global:board', embed: 'canvas://canvas-1',
    };
    const client = new CanvasesClient(createMockAdapter(response));
    expect(await client.openCopilotExtension('ws one', 'canvas-1')).toEqual(response);
  });

  it('lists discovered extensions for the "+" menu', async () => {
    const extensions = [{ extensionKey: 'ws/1:board', name: 'board', description: 'Board' }];
    const adapter = createMockAdapter({ extensions });
    const client = new CanvasesClient(adapter);
    expect(await client.listCopilotExtensions('ws/1')).toEqual(extensions);
    expect(adapter.calls[0]).toMatchObject({ path: '/workspaces/ws%2F1/canvas-extensions' });
  });

  it('opens an extension by key in a chat', async () => {
    const response = {
      success: true, canvasId: 'canvas-1', instanceId: 'instance-1',
      title: 'Board', extensionKey: 'ws:board', embed: 'canvas://canvas-1',
    };
    const adapter = createMockAdapter(response);
    const client = new CanvasesClient(adapter);
    expect(await client.openCopilotExtensionByKey('ws/1', { processId: 'chat-1', extensionKey: 'ws:board' })).toEqual(response);
    expect(adapter.calls[0]).toMatchObject({
      path: '/workspaces/ws%2F1/canvas-extensions/open',
      options: { method: 'POST', body: { processId: 'chat-1', extensionKey: 'ws:board' } },
    });
  });
});

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
