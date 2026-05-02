import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocClient, type CocEventSource } from '../../src';
import { startMockServer, SseStream, type MockServer } from '../mock-server';

class RecordingEventSource implements CocEventSource {
  static instances: RecordingEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(readonly url: string, readonly init?: EventSourceInit) {
    RecordingEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MessageEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

class FetchEventSource implements CocEventSource {
  static instances: FetchEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  retryMs = 10;
  private controller: AbortController | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private lastEventId = '';
  private eventName = 'message';
  private pendingEventId: string | undefined;
  private dataLines: string[] = [];
  private readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(readonly url: string, readonly init?: EventSourceInit) {
    FetchEventSource.instances.push(this);
    void this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.controller?.abort();
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MessageEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const headers: Record<string, string> = {};
      if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;
      const response = await fetch(this.url, { headers, signal: controller.signal });
      if (this.closed) return;
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        this.dispatchError(new Error(`SSE connection failed: ${response.status} ${response.statusText}`.trim()));
        this.scheduleReconnect();
        return;
      }
      if (!contentType.toLowerCase().includes('text/event-stream')) {
        this.dispatchError(new Error(`Expected text/event-stream response but received ${contentType || 'no content-type'}`));
        this.scheduleReconnect();
        return;
      }
      await this.readBody(response);
      if (!this.closed) this.scheduleReconnect();
    } catch (error) {
      if (!this.closed) {
        this.dispatchError(error instanceof Error ? error : new Error(String(error)));
        this.scheduleReconnect();
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  private async readBody(response: Response): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('SSE response body is not readable');
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = this.processBufferedLines(buffer);
    }
    buffer += decoder.decode();
    this.processBufferedLines(buffer);
  }

  private processBufferedLines(buffer: string): string {
    const lines = buffer.split(/\r\n|\r|\n/);
    const remainder = lines.pop() ?? '';
    for (const line of lines) this.processLine(line);
    return remainder;
  }

  private processLine(line: string): void {
    if (line === '') {
      this.dispatchBufferedEvent();
      return;
    }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1
      ? ''
      : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'event') this.eventName = value || 'message';
    else if (field === 'data') this.dataLines.push(value);
    else if (field === 'id' && !value.includes('\0')) this.pendingEventId = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retryMs = Number(value);
  }

  private dispatchBufferedEvent(): void {
    if (this.pendingEventId !== undefined) this.lastEventId = this.pendingEventId;
    if (this.dataLines.length > 0) {
      const event = {
        data: this.dataLines.join('\n'),
        type: this.eventName,
        lastEventId: this.lastEventId,
      } as MessageEvent;
      if (this.eventName === 'message') this.onmessage?.(event);
      for (const listener of this.listeners.get(this.eventName) ?? []) listener(event);
    }
    this.eventName = 'message';
    this.pendingEventId = undefined;
    this.dataLines = [];
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    this.reconnectTimer = setTimeout(() => void this.connect(), this.retryMs);
  }

  private dispatchError(error: Error): void {
    this.onerror?.(error as unknown as Event);
  }
}

describe('ProcessSseClient mock SSE behavior', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    await mock?.close();
    mock = undefined;
    RecordingEventSource.instances = [];
    FetchEventSource.instances = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a helpful error when no EventSource implementation is available', () => {
    vi.stubGlobal('EventSource', undefined);
    const errors: unknown[] = [];
    const client = new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
    });

    const stream = client.processes.stream('proc/missing', {
      onEvent: vi.fn(),
      onError: error => errors.push(error),
    });

    expect(stream).toMatchObject({ close: expect.any(Function) });
    expect(errors[0]).toMatchObject({
      name: 'CocSseError',
      message: 'No EventSource implementation is available',
      url: 'http://localhost:4000/api/processes/proc%2Fmissing/stream',
      lastEventId: '',
    });
  });

  it('builds stream URLs with api prefix and propagates withCredentials', () => {
    const client = new CocClient({
      baseUrl: 'http://localhost:4000/root/',
      apiBasePath: 'custom-api',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      EventSource: RecordingEventSource,
    });

    const stream = client.processes.stream('proc/with/slashes', {
      workspaceId: 'repo with/slashes',
      withCredentials: true,
      onEvent: vi.fn(),
    });

    expect(RecordingEventSource.instances).toHaveLength(1);
    expect(RecordingEventSource.instances[0].url).toBe(
      'http://localhost:4000/root/custom-api/processes/proc%2Fwith%2Fslashes/stream?workspace=repo+with%2Fslashes',
    );
    expect(RecordingEventSource.instances[0].init).toEqual({ withCredentials: true });
    stream.close();
    expect(RecordingEventSource.instances[0].closed).toBe(true);
  });

  it('parses named events, comments, multiline data, retry, and rapid event ordering', async () => {
    mock = await startMockServer();
    mock.onSse('/api/processes/proc-1/stream', async stream => {
      await stream.flush();
      await stream.send({ comment: 'heartbeat' });
      await stream.send({ id: 'evt-1', event: 'chunk', retry: 7, data: '{\n  "content": "hello"\n}' });
      for (let index = 0; index < 25; index++) {
        await stream.send({ event: 'chunk', data: { index } });
      }
      await stream.send({ event: 'done', data: { processId: 'proc-1' } });
      stream.end();
    });
    const events: unknown[] = [];
    const typedEvents: Array<{ type: string; event: unknown }> = [];
    const client = createSseClient(mock);

    await withTimeout(new Promise<void>((resolve, reject) => {
      client.processes.stream('proc-1', {
        workspaceId: 'repo-1',
        onEvent: event => events.push(event),
        onTypedEvent: (type, event) => typedEvents.push({ type, event }),
        onDone: resolve,
        onError: reject,
      });
    }));

    expect(mock.requests[0]).toMatchObject({
      path: '/api/processes/proc-1/stream',
      query: { workspace: 'repo-1' },
    });
    expect(events).toEqual([
      { content: 'hello' },
      ...Array.from({ length: 25 }, (_, index) => ({ index })),
    ]);
    expect(typedEvents.map(event => event.type)).toEqual(Array(26).fill('chunk'));
    expect(FetchEventSource.instances[0].retryMs).toBe(7);
  });

  it('resumes reconnects with Last-Event-ID after clean server closes', async () => {
    mock = await startMockServer();
    const lastEventIds: Array<string | string[] | undefined> = [];
    mock.onSse('/api/processes/reconnect-proc/stream', async (stream, request) => {
      lastEventIds.push(request.headers['last-event-id']);
      if (lastEventIds.length === 1) {
        await stream.send({ id: 'evt-1', event: 'chunk', retry: 1, data: { stage: 1 } });
        stream.end();
        return;
      }
      await stream.send({ event: 'chunk', data: { stage: 2 } });
      await stream.send({ event: 'done', data: { processId: 'reconnect-proc' } });
      stream.end();
    });
    const events: unknown[] = [];
    const client = createSseClient(mock);

    await withTimeout(new Promise<void>((resolve, reject) => {
      client.processes.stream('reconnect-proc', {
        onEvent: event => events.push(event),
        onDone: resolve,
        onError: reject,
      });
    }));

    expect(events).toEqual([{ stage: 1 }, { stage: 2 }]);
    expect(lastEventIds).toEqual([undefined, 'evt-1']);
  });

  it('normalizes initial 5xx errors and keeps the EventSource retry path intact', async () => {
    mock = await startMockServer();
    let attempts = 0;
    mock.onRaw('GET', '/api/processes/flaky-proc/stream', async (_request, response) => {
      attempts++;
      if (attempts === 1) {
        return {
          status: 503,
          headers: { 'content-type': 'application/json' },
          body: { error: 'busy' },
        };
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const stream = new SseStream(response);
      await stream.send({ event: 'chunk', data: { ok: true } });
      await stream.send({ event: 'done', data: { processId: 'flaky-proc' } });
      stream.end();
    });
    const events: unknown[] = [];
    const errors: unknown[] = [];
    const client = createSseClient(mock);

    await withTimeout(new Promise<void>(resolve => {
      client.processes.stream('flaky-proc', {
        onEvent: event => events.push(event),
        onDone: resolve,
        onError: error => errors.push(error),
      });
    }));

    expect(attempts).toBe(2);
    expect(events).toEqual([{ ok: true }]);
    expect(errors[0]).toMatchObject({
      name: 'CocSseError',
      url: `${mock.url}/api/processes/flaky-proc/stream`,
      lastEventId: '',
    });
    expect(String((errors[0] as Error).message)).toContain('503');
  });

  it('surfaces non-event-stream responses and allows callers to stop retries', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/processes/wrong-content-type/stream', {
      headers: { 'content-type': 'application/json' },
      body: { ok: false },
    });
    const client = createSseClient(mock);
    let stream: { close: () => void } | undefined;

    const error = await withTimeout(new Promise<unknown>(resolve => {
      stream = client.processes.stream('wrong-content-type', {
        onEvent: vi.fn(),
        onError: event => {
          resolve(event);
          stream?.close();
        },
      });
    }));

    stream?.close();
    expect(error).toMatchObject({
      name: 'CocSseError',
      url: `${mock.url}/api/processes/wrong-content-type/stream`,
      lastEventId: '',
    });
    expect(String((error as Error).message)).toContain('Expected text/event-stream');
  });

  it('stops reconnecting when the caller closes the stream', async () => {
    mock = await startMockServer();
    mock.onSse('/api/processes/manual-close/stream', async stream => {
      await stream.send({ id: 'evt-1', event: 'chunk', retry: 1, data: { stage: 1 } });
      stream.end();
    });
    const client = createSseClient(mock);
    let handle: { close: () => void } | undefined;

    await withTimeout(new Promise<void>((resolve, reject) => {
      handle = client.processes.stream('manual-close', {
        onEvent: () => {
          handle?.close();
          resolve();
        },
        onError: reject,
      });
    }));
    await delay(25);

    expect(mock.requests).toHaveLength(1);
  });
});

function createSseClient(mock: MockServer): CocClient {
  return new CocClient({
    baseUrl: mock.url,
    fetch: globalThis.fetch,
    EventSource: FetchEventSource,
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
