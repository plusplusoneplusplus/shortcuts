import * as http from 'http';
import type * as net from 'net';
import { HttpRouter, type MockHttpMethod, type MockPathMatcher, type MockRawRouteHandler, type MockResponse, type MockRouteHandler, type RecordedRequest } from './http-router';
import { writeSseResponse, type SseHandler } from './sse-server';
import { MockWebSocketRouter, type MockWsHandler, type MockWsScriptStep } from './ws-server';

/**
 * Lightweight coc-client test harness for HTTP, WebSocket, and SSE behavior:
 * const mock = await startMockServer();
 * mock.on('GET', '/api/health', { body: { ok: true } });
 * mock.onWs('/ws', socket => socket.send(JSON.stringify({ type: 'connected' })));
 * await mock.close();
 */
export interface MockServer {
  url: string;
  requests: RecordedRequest[];
  on: (method: MockHttpMethod, path: MockPathMatcher, handler: MockRouteHandler) => void;
  onRaw: (method: MockHttpMethod, path: MockPathMatcher, handler: MockRawRouteHandler) => void;
  onDefault: (handler: MockRouteHandler) => void;
  onSse: (path: MockPathMatcher, handler: SseHandler) => void;
  onWs: (path: string | RegExp, handler: MockWsHandler) => void;
  scriptWs: (path: string | RegExp, steps: MockWsScriptStep[]) => void;
  close: () => Promise<void>;
}

export type {
  MockHttpMethod,
  MockPathMatcher,
  MockRawRouteHandler,
  MockResponse,
  MockRouteHandler,
  RecordedRequest,
  SseHandler,
  MockWsHandler,
  MockWsScriptStep,
};

export { SseStream, type SseMessage } from './sse-server';
export { type MockWebSocketHelpers } from './ws-server';
export * from './fixtures';

export async function startMockServer(): Promise<MockServer> {
  const httpRouter = new HttpRouter();
  const wsRouter = new MockWebSocketRouter();
  const sockets = new Set<net.Socket>();
  let closed = false;

  const server = http.createServer((req, res) => {
    void httpRouter.handle(req, res).catch(error => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });

  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    if (!wsRouter.handleUpgrade(req, socket, head)) {
      socket.destroy();
    }
  });

  const url = await listen(server);

  return {
    url,
    requests: httpRouter.requests,
    on: (method, path, handler) => httpRouter.on(method, path, handler),
    onRaw: (method, path, handler) => httpRouter.onRaw(method, path, handler),
    onDefault: handler => httpRouter.onDefault(handler),
    onSse: (path, handler) => {
      httpRouter.onRaw('GET', path, async (request, response) => {
        await writeSseResponse(response, request, handler);
      });
    },
    onWs: (path, handler) => wsRouter.on(path, handler),
    scriptWs: (path, steps) => wsRouter.script(path, steps),
    close: async () => {
      if (closed) return;
      closed = true;
      httpRouter.abortPending();
      wsRouter.close();
      const closePromise = new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
      server.closeAllConnections();
      for (const socket of sockets) socket.destroy();
      await closePromise.catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') throw error;
      });
    },
  };
}

function listen(server: http.Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Mock server did not bind to a TCP port'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
