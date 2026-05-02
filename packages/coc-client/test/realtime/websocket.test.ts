import { afterEach, describe, expect, it, vi } from 'vitest';
import { CocClient } from '../../src';

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  message(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent);
  }
}

describe('EventsClient WebSocket', () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.useRealTimers();
  });

  it('builds WebSocket URL and dispatches JSON events', () => {
    const onMessage = vi.fn();
    const statuses: string[] = [];
    const client = new CocClient({
      baseUrl: 'https://example.test',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      WebSocket: FakeWebSocket,
    });

    const conn = client.events.connect({
      workspaceId: 'repo/a',
      onMessage,
      onStatusChange: status => statuses.push(status),
    });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.message({ type: 'process-updated', workspaceId: 'repo/a' });

    expect(socket.url).toBe('wss://example.test/ws?workspaceId=repo%2Fa');
    expect(statuses).toEqual(['connecting', 'open']);
    expect(onMessage).toHaveBeenCalledWith({ type: 'process-updated', workspaceId: 'repo/a' });

    conn.close();
  });

  it('manual close prevents reconnect', () => {
    vi.useFakeTimers();
    const client = new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      WebSocket: FakeWebSocket,
    });

    const conn = client.events.connect({ onMessage: vi.fn() });
    conn.close();
    vi.advanceTimersByTime(10_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reconnects with increasing delay and pings only while open', () => {
    vi.useFakeTimers();
    const client = new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      WebSocket: FakeWebSocket,
    });

    client.events.connect({ onMessage: vi.fn(), reconnectBaseDelayMs: 100, pingIntervalMs: 50 });
    const first = FakeWebSocket.instances[0];
    first.open();
    vi.advanceTimersByTime(50);
    expect(first.sent).toEqual([JSON.stringify({ type: 'ping' })]);

    first.onclose?.({} as CloseEvent);
    vi.advanceTimersByTime(99);
    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('surfaces invalid JSON without crashing', () => {
    const onError = vi.fn();
    const client = new CocClient({
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      WebSocket: FakeWebSocket,
    });

    client.events.connect({ onMessage: vi.fn(), onError });
    FakeWebSocket.instances[0].message('{bad json');

    expect(onError).toHaveBeenCalled();
  });
});
