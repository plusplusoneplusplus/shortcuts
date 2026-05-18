import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocClient, type ProcessEvent, type WebSocketConstructor } from '../../src';
import { startMockServer, type MockServer } from '../mock-server';

const NodeWebSocket = WebSocket as unknown as WebSocketConstructor;

describe('EventsClient WebSocket mock server behavior', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await mock?.close();
    mock = undefined;
  });

  it('connects with workspace query, custom path, provided constructor, and lifecycle statuses', async () => {
    mock = await startMockServer();
    const serverConnected = deferred<void>();
    let upgradeUrl = '';

    mock.onWs('/realtime', (_socket, request) => {
      upgradeUrl = request.url ?? '';
      serverConnected.resolve();
    });

    const statuses: string[] = [];
    const opened = deferred<void>();
    const client = createClient(mock, { wsPath: '/ws-default' });
    const connection = client.events.connect({
      workspaceId: 'repo/a',
      wsPath: 'realtime',
      onMessage: vi.fn(),
      onOpen: opened.resolve,
      onStatusChange: status => statuses.push(status),
    });

    await Promise.all([serverConnected.promise, opened.promise]);

    expect(upgradeUrl).toBe('/realtime?workspaceId=repo%2Fa');
    expect(statuses).toEqual(['connecting', 'open']);

    connection.close();
    await expectEventually(() => {
      expect(statuses).toEqual(['connecting', 'open', 'closing', 'closed']);
    });
  });

  it('derives ws and wss schemes and throws a helpful error when no constructor is available', () => {
    CapturingWebSocket.urls = [];
    const secureClient = new CocClient({
      baseUrl: 'https://example.test/api-base',
      fetch: resolvedFetch,
      WebSocket: CapturingWebSocket,
    });

    const secureConnection = secureClient.events.connect({
      workspaceId: 'repo/a',
      wsPath: '/realtime',
      onMessage: vi.fn(),
    });

    expect(CapturingWebSocket.urls).toEqual(['wss://example.test/realtime?workspaceId=repo%2Fa']);
    secureConnection.close();

    CapturingWebSocket.urls = [];
    const insecureClient = new CocClient({
      baseUrl: 'http://example.test',
      fetch: resolvedFetch,
      WebSocket: CapturingWebSocket,
    });

    const insecureConnection = insecureClient.events.connect({ onMessage: vi.fn() });

    expect(CapturingWebSocket.urls).toEqual(['ws://example.test/ws']);
    insecureConnection.close();

    vi.stubGlobal('WebSocket', undefined);
    const missingConstructorClient = new CocClient({
      baseUrl: 'http://example.test',
      fetch: resolvedFetch,
    });

    expect(() => missingConstructorClient.events.connect({ onMessage: vi.fn() }))
      .toThrow(/No WebSocket implementation is available/);
  });

  it('dispatches ordered JSON events and reports malformed or binary frames without closing', async () => {
    mock = await startMockServer();
    const messages: ProcessEvent[] = [];
    const errors: unknown[] = [];
    const opened = deferred<void>();

    mock.onWs('/ws', (socket, _request, helpers) => {
      helpers.sendJson({ type: 'first', seq: 1 });
      socket.send('{bad json');
      socket.send(Buffer.from([0, 1, 2]));
      helpers.sendJson({ type: 'second', seq: 2 });
    });

    const connection = createClient(mock).events.connect({
      onMessage: event => messages.push(event),
      onError: error => errors.push(error),
      onOpen: opened.resolve,
    });

    await opened.promise;
    await expectEventually(() => {
      expect(messages.map(event => event.type)).toEqual(['first', 'second']);
      expect(errors).toHaveLength(2);
    });

    connection.close();
  });

  it('keeps multiple concurrent connections from one client independent', async () => {
    mock = await startMockServer();
    const upgrades: string[] = [];

    mock.onWs('/ws', (_socket, request, helpers) => {
      upgrades.push(request.url ?? '');
      const workspaceId = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('workspaceId');
      helpers.sendJson({ type: 'connected', workspaceId });
    });

    const client = createClient(mock);
    const repoAMessages: ProcessEvent[] = [];
    const repoBMessages: ProcessEvent[] = [];
    const repoA = client.events.connect({
      workspaceId: 'repo-a',
      onMessage: event => repoAMessages.push(event),
    });
    const repoB = client.events.connect({
      workspaceId: 'repo-b',
      onMessage: event => repoBMessages.push(event),
    });

    await expectEventually(() => {
      expect(repoAMessages).toEqual([{ type: 'connected', workspaceId: 'repo-a' }]);
      expect(repoBMessages).toEqual([{ type: 'connected', workspaceId: 'repo-b' }]);
    });

    expect(upgrades.sort()).toEqual(['/ws?workspaceId=repo-a', '/ws?workspaceId=repo-b']);

    repoA.close();
    repoB.close();
  });

  it('sends heartbeat pings on the configured interval and responds to server protocol pings', async () => {
    vi.useFakeTimers();
    mock = await startMockServer();
    const received: string[] = [];
    const opened = deferred<void>();
    const ponged = deferred<void>();

    mock.onWs('/ws', socket => {
      socket.on('message', data => received.push(data.toString()));
      socket.once('pong', () => ponged.resolve());
      socket.ping();
    });

    const connection = createClient(mock).events.connect({
      onMessage: vi.fn(),
      onOpen: opened.resolve,
      pingIntervalMs: 50,
    });

    await Promise.all([opened.promise, ponged.promise]);
    await vi.advanceTimersByTimeAsync(150);

    await expectEventually(() => {
      expect(received.length).toBeGreaterThanOrEqual(3);
      expect(received.slice(0, 3)).toEqual([
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'ping' }),
        JSON.stringify({ type: 'ping' }),
      ]);
    });

    connection.close();
  });

  it('reconnects dropped sockets with exponential backoff and cancels pending reconnect on close', async () => {
    vi.useFakeTimers();
    mock = await startMockServer();
    let connections = 0;
    const reconnecting = [deferred<void>(), deferred<void>()];

    mock.onWs('/ws', (_socket, _request, helpers) => {
      connections += 1;
      helpers.drop();
    });

    const statuses: string[] = [];
    const connection = createClient(mock).events.connect({
      onMessage: vi.fn(),
      reconnectBaseDelayMs: 100,
      reconnectMaxDelayMs: 250,
      onStatusChange: status => {
        statuses.push(status);
        if (status === 'reconnecting') reconnecting[statuses.filter(item => item === 'reconnecting').length - 1]?.resolve();
      },
    });

    await reconnecting[0].promise;
    expect(connections).toBe(1);

    await vi.advanceTimersByTimeAsync(99);
    expect(connections).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await reconnecting[1].promise;
    expect(connections).toBe(2);

    await vi.advanceTimersByTimeAsync(199);
    expect(connections).toBe(2);
    connection.close();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connections).toBe(2);
    expect(statuses).toEqual([
      'connecting',
      'open',
      'closed',
      'reconnecting',
      'connecting',
      'open',
      'closed',
      'reconnecting',
      'closed',
    ]);
  });

  it('makes manual close idempotent and suppresses late frames', async () => {
    mock = await startMockServer();
    const opened = deferred<void>();
    const statuses: string[] = [];
    let serverSocket: WebSocket | undefined;

    mock.onWs('/ws', socket => {
      serverSocket = socket;
    });

    const onMessage = vi.fn();
    const connection = createClient(mock).events.connect({
      onMessage,
      onOpen: opened.resolve,
      onStatusChange: status => statuses.push(status),
    });

    await opened.promise;
    connection.close();
    connection.close();
    if (serverSocket?.readyState === WebSocket.OPEN) {
      serverSocket.send(JSON.stringify({ type: 'late' }));
    }

    await expectEventually(() => {
      expect(statuses.filter(status => status === 'closed')).toHaveLength(1);
      expect(statuses).toEqual(['connecting', 'open', 'closing', 'closed']);
    });
    expect(onMessage).not.toHaveBeenCalled();
  });
});

function createClient(mock: MockServer, options: { wsPath?: string } = {}): CocClient {
  return new CocClient({
    baseUrl: mock.url,
    fetch: resolvedFetch,
    WebSocket: NodeWebSocket,
    wsPath: options.wsPath,
  });
}

async function expectEventually(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { interval: 5, timeout: 1_000 });
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void } {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(innerResolve => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

const resolvedFetch = (() => Promise.resolve(new Response('{}'))) as typeof fetch;

class CapturingWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static urls: string[] = [];

  readyState = CapturingWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    CapturingWebSocket.urls.push(url);
  }

  send(_data: string): void {}

  close(): void {
    if (this.readyState === CapturingWebSocket.CLOSED) return;
    this.readyState = CapturingWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}
