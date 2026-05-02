import type { ProcessEvent } from './realtime/events';

export type QueryPrimitive = string | number | boolean | undefined | null;

export interface CocClientOptions {
  baseUrl?: string;
  apiBasePath?: string;
  fetch?: typeof fetch;
  defaultHeaders?: HeadersInit;
  timeoutMs?: number;
  WebSocket?: WebSocketConstructor;
  EventSource?: EventSourceConstructor;
  wsPath?: string;
}

export interface CocRequestOptions {
  method?: string;
  query?: Record<string, QueryPrimitive | QueryPrimitive[]>;
  body?: unknown;
  rawBody?: BodyInit | null;
  headers?: HeadersInit;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface NormalizedCocClientOptions {
  baseUrl: string;
  apiBasePath: string;
  fetch: typeof fetch;
  defaultHeaders?: HeadersInit;
  timeoutMs?: number;
  WebSocket?: WebSocketConstructor;
  EventSource?: EventSourceConstructor;
  wsPath: string;
}

export interface RequestAdapter {
  request<T = unknown>(path: string, options?: CocRequestOptions): Promise<T>;
}

export interface CocWebSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface WebSocketConstructor {
  readonly CONNECTING: number;
  readonly OPEN: number;
  readonly CLOSING: number;
  readonly CLOSED: number;
  new (url: string): CocWebSocket;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting';

export interface CocEventSource {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(): void;
  addEventListener?(type: string, listener: (event: MessageEvent) => void): void;
  removeEventListener?(type: string, listener: (event: MessageEvent) => void): void;
}

export interface EventSourceConstructor {
  new (url: string, eventSourceInitDict?: EventSourceInit): CocEventSource;
}

export interface ConnectEventsOptions {
  workspaceId?: string;
  wsPath?: string;
  reconnect?: boolean;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  pingIntervalMs?: number;
  onMessage: (event: ProcessEvent) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onOpen?: () => void;
  onError?: (error: unknown) => void;
}

export interface ProcessStreamOptions {
  workspaceId?: string;
  signal?: AbortSignal;
  withCredentials?: boolean;
  onEvent: (event: unknown) => void;
  onTypedEvent?: (eventType: string, event: unknown, rawEvent: MessageEvent) => void;
  onDone?: () => void;
  onError?: (error: unknown) => void;
}
