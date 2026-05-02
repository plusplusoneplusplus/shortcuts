import { describe, expect, it, vi } from 'vitest';
import { CocClient } from '../../src';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  listeners = new Map<string, (event: MessageEvent) => void>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }
}

describe('ProcessSseClient', () => {
  it('dispatches stream events and closes on done', () => {
    FakeEventSource.instances = [];
    const onEvent = vi.fn();
    const onDone = vi.fn();
    const client = new CocClient({
      baseUrl: 'http://localhost:4000',
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      EventSource: FakeEventSource,
    });

    client.processes.stream('proc/1', { workspaceId: 'repo/a', onEvent, onDone });
    const source = FakeEventSource.instances[0];
    source.onmessage?.({ data: JSON.stringify({ type: 'chunk', text: 'hello' }) } as MessageEvent);
    source.listeners.get('done')?.({ data: '' } as MessageEvent);

    expect(source.url).toBe('http://localhost:4000/api/processes/proc%2F1/stream?workspace=repo%2Fa');
    expect(onEvent).toHaveBeenCalledWith({ type: 'chunk', text: 'hello' });
    expect(onDone).toHaveBeenCalled();
    expect(source.closed).toBe(true);
  });

  it('close aborts the underlying EventSource', () => {
    FakeEventSource.instances = [];
    const client = new CocClient({
      fetch: (() => Promise.resolve(new Response('{}'))) as typeof fetch,
      EventSource: FakeEventSource,
    });

    const stream = client.processes.stream('p1', { onEvent: vi.fn() });
    stream.close();

    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
