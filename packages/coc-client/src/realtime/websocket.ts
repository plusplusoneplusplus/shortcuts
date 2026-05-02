import type { ConnectEventsOptions, NormalizedCocClientOptions, WebSocketConstructor, CocWebSocket } from '../types';
import { buildWebSocketUrl } from '../url';
import { isProcessEvent } from './events';

export class ProcessWebSocketConnection {
  private socket: CocWebSocket | undefined;
  private reconnectDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private manuallyClosed = false;

  constructor(
    private readonly clientOptions: NormalizedCocClientOptions,
    private readonly options: ConnectEventsOptions,
  ) {
    this.reconnectDelayMs = options.reconnectBaseDelayMs ?? 1000;
    this.connect();
  }

  close(): void {
    this.manuallyClosed = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = undefined;
    this.options.onStatusChange?.('closed');
  }

  private connect(): void {
    const WebSocketImpl = this.clientOptions.WebSocket as WebSocketConstructor | undefined;
    if (!WebSocketImpl) {
      this.options.onError?.(new Error('No WebSocket implementation is available'));
      this.options.onStatusChange?.('closed');
      return;
    }

    this.clearTimers();
    this.options.onStatusChange?.('connecting');
    const socket = new WebSocketImpl(buildWebSocketUrl(
      this.clientOptions.baseUrl,
      this.options.wsPath ?? this.clientOptions.wsPath,
      this.options.workspaceId ? { workspaceId: this.options.workspaceId } : undefined,
    ));
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectDelayMs = this.options.reconnectBaseDelayMs ?? 1000;
      this.options.onStatusChange?.('open');
      this.options.onOpen?.();
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocketImpl.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, this.options.pingIntervalMs ?? 30_000);
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data));
        if (isProcessEvent(parsed)) {
          this.options.onMessage(parsed);
        } else {
          this.options.onError?.(new Error('WebSocket message is not a CoC process event'));
        }
      } catch (error) {
        this.options.onError?.(error);
      }
    };

    socket.onerror = (event) => {
      this.options.onError?.(event);
    };

    socket.onclose = () => {
      this.clearTimers();
      this.options.onStatusChange?.('closed');
      if (!this.manuallyClosed && this.options.reconnect !== false) {
        const delay = this.reconnectDelayMs;
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.options.reconnectMaxDelayMs ?? 30_000);
          this.connect();
        }, delay);
      }
    };
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.reconnectTimer = undefined;
    this.pingTimer = undefined;
  }
}

export class EventsClient {
  constructor(private readonly options: NormalizedCocClientOptions) {}

  connect(options: ConnectEventsOptions): ProcessWebSocketConnection {
    return new ProcessWebSocketConnection(this.options, options);
  }
}
