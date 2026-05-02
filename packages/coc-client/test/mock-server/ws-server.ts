import type * as http from 'http';
import type * as net from 'net';
import WebSocket, { WebSocketServer } from 'ws';

export type MockWsHandler = (
  socket: WebSocket,
  request: http.IncomingMessage,
  helpers: MockWebSocketHelpers,
) => void | Promise<void>;

export interface MockWsScriptStep {
  type: 'send' | 'send-json' | 'close' | 'drop' | 'pause' | 'resume';
  data?: unknown;
  code?: number;
  reason?: string;
  delayMs?: number;
}

export interface MockWebSocketHelpers {
  sendJson: (data: unknown) => void;
  close: (code?: number, reason?: string) => void;
  drop: () => void;
  pauseSocket: (durationMs?: number) => void;
  resumeSocket: () => void;
}

interface RegisteredWsRoute {
  path: string | RegExp;
  handler: MockWsHandler;
}

export class MockWebSocketRouter {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly routes: RegisteredWsRoute[] = [];
  private readonly sockets = new Set<WebSocket>();

  on(path: string | RegExp, handler: MockWsHandler): void {
    this.routes.push({ path, handler });
  }

  script(path: string | RegExp, steps: MockWsScriptStep[]): void {
    this.on(path, async (socket, _request, helpers) => {
      for (const step of steps) {
        if (step.delayMs && step.delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, step.delayMs));
        }
        if (socket.readyState !== WebSocket.OPEN) return;
        if (step.type === 'send') socket.send(String(step.data ?? ''));
        else if (step.type === 'send-json') helpers.sendJson(step.data);
        else if (step.type === 'close') helpers.close(step.code, step.reason);
        else if (step.type === 'drop') helpers.drop();
        else if (step.type === 'pause') helpers.pauseSocket(step.delayMs);
        else if (step.type === 'resume') helpers.resumeSocket();
      }
    });
  }

  handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): boolean {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const route = this.routes.find(candidate => matchesPath(candidate.path, path));
    if (!route) return false;

    this.server.handleUpgrade(req, socket, head, ws => {
      this.sockets.add(ws);
      ws.once('close', () => this.sockets.delete(ws));
      this.server.emit('connection', ws, req);
      void route.handler(ws, req, createHelpers(ws));
    });
    return true;
  }

  close(): void {
    for (const socket of this.sockets) socket.terminate();
    this.sockets.clear();
    this.server.close();
  }
}

function createHelpers(socket: WebSocket): MockWebSocketHelpers {
  return {
    sendJson: data => socket.send(JSON.stringify(data)),
    close: (code, reason) => socket.close(code, reason),
    drop: () => socket.terminate(),
    pauseSocket: durationMs => {
      socket.pause();
      if (durationMs && durationMs > 0) {
        setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) socket.resume();
        }, durationMs);
      }
    },
    resumeSocket: () => socket.resume(),
  };
}

function matchesPath(matcher: string | RegExp, path: string): boolean {
  return typeof matcher === 'string' ? matcher === path : matcher.test(path);
}
