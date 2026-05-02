import type { EventSourceConstructor, NormalizedCocClientOptions, ProcessStreamOptions } from '../types';
import { buildApiUrl, encodePathSegment } from '../url';

export class ProcessSseClient {
  constructor(private readonly options: NormalizedCocClientOptions) {}

  stream(processId: string, options: ProcessStreamOptions): { close: () => void } {
    const EventSourceImpl = this.options.EventSource as EventSourceConstructor | undefined;
    if (!EventSourceImpl) {
      options.onError?.(new Error('No EventSource implementation is available'));
      return { close: () => {} };
    }

    const url = buildApiUrl(
      this.options.baseUrl,
      this.options.apiBasePath,
      `/processes/${encodePathSegment(processId)}/stream`,
      options.workspaceId ? { workspace: options.workspaceId } : undefined,
    );
    const source = new EventSourceImpl(url);
    let closed = false;
    const close = () => {
      closed = true;
      source.close();
    };

    if (options.signal) {
      if (options.signal.aborted) close();
      else options.signal.addEventListener('abort', close, { once: true });
    }

    source.onmessage = (event) => {
      try {
        options.onEvent(JSON.parse(String(event.data)));
      } catch (error) {
        options.onError?.(error);
      }
    };
    source.onerror = (event) => {
      if (!closed) options.onError?.(event);
    };
    source.addEventListener?.('done', () => {
      options.onDone?.();
      close();
    });

    return { close };
  }
}
