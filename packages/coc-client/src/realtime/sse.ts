import type { EventSourceConstructor, NormalizedCocClientOptions, ProcessStreamOptions } from '../types';
import { buildApiUrl, encodePathSegment } from '../url';
import { CocSseError } from '../errors';

const PROCESS_STREAM_EVENT_TYPES = [
  'conversation-snapshot',
  'chunk',
  'tool-start',
  'tool-complete',
  'tool-failed',
  'permission-request',
  'workflow-phase',
  'workflow-progress',
  'item-process',
  'suggestions',
  'ask-user',
  'token-usage',
  'background-tasks',
  'status',
  'heartbeat',
  'message-queued',
  'message-steering',
  'pending-message-added',
  'hook-step',
] as const;

export class ProcessSseClient {
  constructor(private readonly options: NormalizedCocClientOptions) {}

  stream(processId: string, options: ProcessStreamOptions): { close: () => void } {
    const url = buildApiUrl(
      this.options.baseUrl,
      this.options.apiBasePath,
      `/processes/${encodePathSegment(processId)}/stream`,
      options.workspaceId ? { workspace: options.workspaceId } : undefined,
    );
    const EventSourceImpl = this.options.EventSource as EventSourceConstructor | undefined;
    if (!EventSourceImpl) {
      options.onError?.(new CocSseError('No EventSource implementation is available', { url }));
      return { close: () => {} };
    }

    const init = options.withCredentials === undefined
      ? undefined
      : { withCredentials: options.withCredentials };
    const source = new EventSourceImpl(url, init);
    let closed = false;
    let lastEventId = '';

    const updateLastEventId = (event: MessageEvent) => {
      const eventLastEventId = event.lastEventId;
      if (typeof eventLastEventId === 'string') lastEventId = eventLastEventId;
    };
    const normalizeError = (error: unknown): CocSseError => {
      if (error instanceof CocSseError) return error;
      if (error instanceof Error) {
        return new CocSseError(error.message, { url, lastEventId, cause: error });
      }
      const eventType = typeof error === 'object' && error !== null && 'type' in error
        ? String((error as { type?: unknown }).type)
        : undefined;
      const message = eventType ? `SSE stream error: ${eventType}` : 'SSE stream error';
      return new CocSseError(message, { url, lastEventId, cause: error });
    };
    const handleEvent = (event: MessageEvent, eventType?: string) => {
      updateLastEventId(event);
      try {
        const payload = JSON.parse(String(event.data));
        if (eventType) options.onTypedEvent?.(eventType, payload, event);
        options.onEvent(payload);
      } catch (error) {
        options.onError?.(normalizeError(error));
      }
    };
    const handleDone = (event: MessageEvent) => {
      updateLastEventId(event);
      options.onDone?.();
      close();
    };
    const typedListeners = PROCESS_STREAM_EVENT_TYPES.map(eventType => {
      const listener = (event: MessageEvent) => handleEvent(event, eventType);
      source.addEventListener?.(eventType, listener);
      return { eventType, listener };
    });
    const close = () => {
      if (closed) return;
      closed = true;
      for (const { eventType, listener } of typedListeners) {
        source.removeEventListener?.(eventType, listener);
      }
      source.removeEventListener?.('done', handleDone);
      options.signal?.removeEventListener('abort', close);
      source.close();
    };

    source.onmessage = (event) => {
      handleEvent(event);
    };
    source.onerror = (event) => {
      if (!closed) options.onError?.(normalizeError(event));
    };
    source.addEventListener?.('done', handleDone);

    if (options.signal) {
      if (options.signal.aborted) close();
      else options.signal.addEventListener('abort', close, { once: true });
    }

    return { close };
  }
}
