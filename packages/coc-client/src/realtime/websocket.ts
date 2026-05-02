import type { ConnectionStatus, ConnectEventsOptions, NormalizedCocClientOptions, WebSocketConstructor, CocWebSocket } from '../types';
import { buildWebSocketUrl } from '../url';
import { isProcessEvent } from './events';

export class ProcessWebSocketConnection {
  private socket: CocWebSocket | undefined;
  private reconnectDelayMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private manuallyClosed = false;
  private lastStatus: ConnectionStatus | undefined;

  constructor(
    private readonly clientOptions: NormalizedCocClientOptions,
    private readonly options: ConnectEventsOptions,
  ) {
    this.reconnectDelayMs = options.reconnectBaseDelayMs ?? 1000;
    this.connect();
  }

  close(): void {
    if (this.manuallyClosed) return;
    this.manuallyClosed = true;
    this.clearTimers();
    const socket = this.socket;
    if (!socket) {
      this.emitStatus('closed');
      return;
    }

    this.emitStatus('closing');
    if (socket.readyState === this.webSocketImpl.CLOSED) {
      this.socket = undefined;
      this.emitStatus('closed');
      return;
    }
    socket.close();
  }

  private connect(): void {
    const WebSocketImpl = this.webSocketImpl;
    this.clearTimers();
    this.emitStatus('connecting');
    const socket = new WebSocketImpl(buildWebSocketUrl(
      this.clientOptions.baseUrl,
      this.options.wsPath ?? this.clientOptions.wsPath,
      this.options.workspaceId ? { workspaceId: this.options.workspaceId } : undefined,
    ));
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket || this.manuallyClosed) return;
      this.emitStatus('open');
      this.options.onOpen?.();
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocketImpl.OPEN) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      }, this.options.pingIntervalMs ?? 30_000);
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket || this.manuallyClosed) return;
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
      if (this.socket !== socket || this.manuallyClosed) return;
      this.options.onError?.(event);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.clearTimers();
      this.emitStatus('closed');
      if (!this.manuallyClosed && this.options.reconnect !== false) {
        const delay = this.reconnectDelayMs;
        this.emitStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => {
          if (this.manuallyClosed) return;
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

  private emitStatus(status: ConnectionStatus): void {
    if (this.lastStatus === status) return;
    this.lastStatus = status;
    this.options.onStatusChange?.(status);
  }

  private get webSocketImpl(): WebSocketConstructor {
    const WebSocketImpl = this.clientOptions.WebSocket as WebSocketConstructor | undefined;
    if (!WebSocketImpl) {
      throw new Error('No WebSocket implementation is available. Pass a WebSocket constructor in CocClient options when running outside a browser.');
    }
    return WebSocketImpl;
  }
}

export class EventsClient {
  constructor(private readonly options: NormalizedCocClientOptions) {}

  connect(options: ConnectEventsOptions): ProcessWebSocketConnection {
    return new ProcessWebSocketConnection(this.options, options);
  }
}
