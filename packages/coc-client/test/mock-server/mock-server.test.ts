import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockServer, type MockServer } from './index';

describe('mock server harness', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    await mock?.close();
    mock = undefined;
  });

  it('matches routes, records requests, and echoes parsed query and JSON body', async () => {
    mock = await startMockServer();
    mock.on('POST', '/api/echo', request => ({
      status: 201,
      headers: { 'x-mock': 'echo' },
      body: {
        method: request.method,
        path: request.path,
        query: request.query,
        body: request.body,
      },
    }));

    const response = await fetch(`${mock.url}/api/echo?a=1&a=2&b=x`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });

    await expect(response.json()).resolves.toEqual({
      method: 'POST',
      path: '/api/echo',
      query: { a: ['1', '2'], b: 'x' },
      body: { hello: 'world' },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('x-mock')).toBe('echo');
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      method: 'POST',
      path: '/api/echo',
      body: { hello: 'world' },
    });
  });

  it('supports response sequences, default responses, raw text, and no-content responses', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/sequence', [
      { status: 200, body: { step: 1 } },
      { status: 202, body: { step: 2 } },
    ]);
    mock.on('GET', '/api/text', { status: 200, headers: { 'content-type': 'text/plain' }, rawBody: 'plain text' });
    mock.on('DELETE', '/api/item', { noContent: true });
    mock.onDefault({ status: 418, body: { error: 'teapot' } });

    await expect(fetch(`${mock.url}/api/sequence`).then(r => r.json())).resolves.toEqual({ step: 1 });
    const secondSequence = await fetch(`${mock.url}/api/sequence`);
    await expect(secondSequence.json()).resolves.toEqual({ step: 2 });
    expect(secondSequence.status).toBe(202);
    await expect(fetch(`${mock.url}/api/sequence`).then(r => r.json())).resolves.toEqual({ step: 2 });
    await expect(fetch(`${mock.url}/api/text`).then(r => r.text())).resolves.toBe('plain text');

    const noContent = await fetch(`${mock.url}/api/item`, { method: 'DELETE' });
    expect(noContent.status).toBe(204);
    await expect(noContent.text()).resolves.toBe('');

    const fallback = await fetch(`${mock.url}/api/missing`);
    expect(fallback.status).toBe(418);
    await expect(fallback.json()).resolves.toEqual({ error: 'teapot' });
  });

  it('destroys sockets for explicit network failure responses', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/drop', { destroySocket: true });

    await expect(fetch(`${mock.url}/api/drop`)).rejects.toThrow();
  });

  it('streams SSE chunks with event, data, id, retry, comments, and explicit flushes', async () => {
    mock = await startMockServer();
    mock.onSse('/api/stream', async stream => {
      await stream.send({ id: 'evt-1', event: 'chunk', retry: 500, data: { text: 'hello' } });
      await stream.flush();
      await stream.send({ comment: 'complete' });
      stream.end();
    });

    const response = await fetch(`${mock.url}/api/stream`);
    await expect(response.text()).resolves.toBe([
      'id: evt-1',
      'event: chunk',
      'retry: 500',
      'data: {"text":"hello"}',
      '',
      ': complete',
      '',
      '',
    ].join('\n'));
  });

  it('handles scripted WebSocket messages and controlled close', async () => {
    mock = await startMockServer();
    mock.scriptWs('/ws', [
      { type: 'send-json', data: { type: 'connected' } },
      { type: 'close', code: 4000, reason: 'done', delayMs: 1 },
    ]);

    const events = await collectWebSocketEvents(`${mock.url.replace(/^http/, 'ws')}/ws`);

    expect(events.messages).toEqual(['{"type":"connected"}']);
    expect(events.close).toEqual({ code: 4000, reason: 'done' });
  });

  it('lets WebSocket handlers echo client messages and drop connections without a close frame', async () => {
    mock = await startMockServer();
    mock.onWs('/ws', (socket, _request, helpers) => {
      socket.on('message', data => {
        helpers.sendJson({ type: 'echo', data: data.toString() });
        helpers.drop();
      });
    });

    const socket = new WebSocket(`${mock.url.replace(/^http/, 'ws')}/ws`);
    const messages: string[] = [];
    const close = new Promise<{ code: number; reason: string }>((resolve, reject) => {
      socket.once('open', () => socket.send('hello'));
      socket.on('message', data => messages.push(data.toString()));
      socket.once('error', reject);
      socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    });

    await expect(close).resolves.toMatchObject({ code: 1006 });
    expect(messages).toEqual(['{"type":"echo","data":"hello"}']);
  });
});

function collectWebSocketEvents(url: string): Promise<{ messages: string[]; close: { code: number; reason: string } }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages: string[] = [];
    socket.on('message', data => messages.push(data.toString()));
    socket.once('error', reject);
    socket.once('close', (code, reason) => resolve({ messages, close: { code, reason: reason.toString() } }));
  });
}
