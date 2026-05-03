import { createApiError, CocNetworkError } from './errors';
import type { CocClientOptions, CocRequestOptions, NormalizedCocClientOptions } from './types';
import { buildApiUrl, normalizeApiBasePath, normalizeBaseUrl } from './url';

export function normalizeOptions(options: CocClientOptions = {}): NormalizedCocClientOptions {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new CocNetworkError('No fetch implementation is available', {
      url: options.baseUrl ?? '',
      code: 'NETWORK_ERROR',
    });
  }
  return {
    baseUrl: normalizeBaseUrl(options.baseUrl),
    apiBasePath: normalizeApiBasePath(options.apiBasePath),
    fetch: fetchImpl.bind(globalThis),
    defaultHeaders: options.defaultHeaders,
    timeoutMs: options.timeoutMs,
    WebSocket: options.WebSocket ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket,
    EventSource: options.EventSource ?? (globalThis as { EventSource?: typeof EventSource }).EventSource,
    wsPath: options.wsPath ?? '/ws',
  };
}

function mergeHeaders(defaultHeaders?: HeadersInit, requestHeaders?: HeadersInit): Headers {
  const headers = new Headers(defaultHeaders);
  if (requestHeaders) {
    new Headers(requestHeaders).forEach((value, key) => headers.set(key, value));
  }
  return headers;
}

function composeSignal(signal: AbortSignal | undefined, timeoutMs: number | undefined): {
  signal?: AbortSignal;
  dispose: () => void;
  timedOut: () => boolean;
} {
  if (!signal && !timeoutMs) return { signal: undefined, dispose: () => {}, timedOut: () => false };
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutFired = false;

  const abortFromCaller = () => {
    controller.abort(signal?.reason ?? new Error('Request aborted'));
  };
  if (signal) {
    if (signal.aborted) abortFromCaller();
    else signal.addEventListener('abort', abortFromCaller, { once: true });
  }

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timeoutFired = true;
      controller.abort(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timeoutId) clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortFromCaller);
    },
    timedOut: () => timeoutFired,
  };
}

export class HttpTransport {
  constructor(private readonly options: NormalizedCocClientOptions) {}

  async request<T = unknown>(path: string, requestOptions: CocRequestOptions = {}): Promise<T> {
    const response = await this.fetch(path, requestOptions);

    if (response.status === 204) return undefined as T;

    const contentType = response.headers?.get?.('content-type') ?? '';
    if (contentType.includes('application/json') || typeof response.text !== 'function') {
      return await response.json() as T;
    }
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  async requestText(path: string, requestOptions: CocRequestOptions = {}): Promise<string> {
    const response = await this.fetch(path, requestOptions);

    if (response.status === 204) return '';
    return await response.text();
  }

  private async fetch(path: string, requestOptions: CocRequestOptions): Promise<Response> {
    const url = buildApiUrl(this.options.baseUrl, this.options.apiBasePath, path, requestOptions.query);
    const headers = mergeHeaders(this.options.defaultHeaders, requestOptions.headers);
    const method = requestOptions.method ?? (requestOptions.body !== undefined || requestOptions.rawBody !== undefined ? 'POST' : 'GET');

    let body: BodyInit | null | undefined;
    if (requestOptions.rawBody !== undefined) {
      body = requestOptions.rawBody;
    } else if (requestOptions.body !== undefined) {
      body = JSON.stringify(requestOptions.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }

    const timeoutMs = requestOptions.timeoutMs ?? this.options.timeoutMs;
    const signalState = composeSignal(requestOptions.signal, timeoutMs);
    let response: Response;
    try {
      response = await this.options.fetch(url, { method, headers, body, signal: signalState.signal });
    } catch (cause) {
      if (signalState.timedOut()) {
        throw new CocNetworkError(`CoC API request timed out after ${timeoutMs}ms`, { url, code: 'TIMEOUT', cause });
      }
      if (requestOptions.signal?.aborted) {
        throw new CocNetworkError('CoC API request was aborted', { url, code: 'ABORTED', cause: requestOptions.signal.reason ?? cause });
      }
      throw new CocNetworkError('CoC API request failed before receiving a response', { url, cause });
    } finally {
      signalState.dispose();
    }

    if (!response || typeof response.ok !== 'boolean') {
      throw new CocNetworkError('CoC API request did not return a valid Response', { url, code: 'NETWORK_ERROR' });
    }

    if (!response.ok) {
      throw await createApiError(response, url);
    }
    return response;
  }
}
