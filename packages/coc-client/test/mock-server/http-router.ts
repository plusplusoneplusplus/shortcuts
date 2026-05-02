import type * as http from 'http';

export type MockHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | string;

export type MockPathMatcher = string | RegExp | ((request: RecordedRequest) => boolean);

export type MockResponseBody = string | Buffer | object | unknown[] | number | boolean | null;

export interface RecordedRequest {
  method: string;
  path: string;
  url: string;
  query: Record<string, string | string[]>;
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  body: unknown;
}

export interface MockResponse {
  status?: number;
  headers?: http.OutgoingHttpHeaders;
  body?: MockResponseBody;
  rawBody?: string | Buffer;
  delayMs?: number;
  noContent?: boolean;
  destroySocket?: boolean;
}

export type MockRouteHandler = MockResponse | MockResponse[] | ((request: RecordedRequest) => MockResponse | Promise<MockResponse>);
export type MockRawRouteHandler = (
  request: RecordedRequest,
  response: http.ServerResponse,
  nodeRequest: http.IncomingMessage,
) => void | MockResponse | Promise<void | MockResponse>;

interface RegisteredRoute {
  method: string;
  matcher: MockPathMatcher;
  handler: MockRouteHandler | MockRawRouteHandler;
  callCount: number;
  raw: boolean;
}

export class HttpRouter {
  readonly requests: RecordedRequest[] = [];
  private readonly routes: RegisteredRoute[] = [];
  private defaultHandler: MockRouteHandler = { status: 404, body: { error: 'Not found' } };
  private readonly pendingTimers = new Set<NodeJS.Timeout>();

  on(method: MockHttpMethod, matcher: MockPathMatcher, handler: MockRouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), matcher, handler, callCount: 0, raw: false });
  }

  onRaw(method: MockHttpMethod, matcher: MockPathMatcher, handler: MockRawRouteHandler): void {
    this.routes.push({ method: method.toUpperCase(), matcher, handler, callCount: 0, raw: true });
  }

  onDefault(handler: MockRouteHandler): void {
    this.defaultHandler = handler;
  }

  abortPending(): void {
    for (const timer of this.pendingTimers) clearTimeout(timer);
    this.pendingTimers.clear();
  }

  async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const recorded = await this.recordRequest(req);
    this.requests.push(recorded);

    const route = this.routes.find(candidate => this.matches(candidate, recorded));
    if (route?.raw) {
      route.callCount += 1;
      const response = await (route.handler as MockRawRouteHandler)(recorded, res, req);
      if (response !== undefined) await this.sendResponse(req, res, response);
      return;
    }
    const response = await this.resolveResponse(route, recorded);
    await this.sendResponse(req, res, response);
  }

  private async recordRequest(req: http.IncomingMessage): Promise<RecordedRequest> {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const contentType = req.headers['content-type'] ?? '';

    return {
      method: (req.method ?? 'GET').toUpperCase(),
      path: requestUrl.pathname,
      url: `${requestUrl.pathname}${requestUrl.search}`,
      query: parseQuery(requestUrl.searchParams),
      headers: req.headers,
      rawBody,
      body: parseBody(rawBody, Array.isArray(contentType) ? contentType.join(',') : contentType),
    };
  }

  private matches(route: RegisteredRoute, request: RecordedRequest): boolean {
    if (route.method !== request.method) return false;
    if (typeof route.matcher === 'string') return route.matcher === request.path;
    if (route.matcher instanceof RegExp) return route.matcher.test(request.path);
    return route.matcher(request);
  }

  private async resolveResponse(route: RegisteredRoute | undefined, request: RecordedRequest): Promise<MockResponse> {
    const handler = route?.handler ?? this.defaultHandler;
    if (route) route.callCount += 1;

    if (typeof handler === 'function') {
      return await handler(request);
    }
    if (Array.isArray(handler)) {
      const index = Math.min((route?.callCount ?? 1) - 1, handler.length - 1);
      return handler[index] ?? { status: 500, body: { error: 'Empty mock response sequence' } };
    }
    return handler;
  }

  private async sendResponse(req: http.IncomingMessage, res: http.ServerResponse, response: MockResponse): Promise<void> {
    if (response.delayMs && response.delayMs > 0) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
          this.pendingTimers.delete(timer);
          resolve();
        }, response.delayMs);
        this.pendingTimers.add(timer);
      });
    }

    if (res.destroyed) return;
    if (response.destroySocket) {
      req.socket.destroy();
      return;
    }

    const status = response.noContent ? 204 : response.status ?? 200;
    const headers: http.OutgoingHttpHeaders = { ...(response.headers ?? {}) };
    const body = response.noContent || status === 204 ? undefined : serializeBody(response, headers);
    if (body !== undefined && !hasHeader(headers, 'content-length')) {
      headers['content-length'] = Buffer.byteLength(body);
    }
    if (!hasHeader(headers, 'connection')) headers.connection = 'close';
    res.writeHead(status, headers);
    res.end(body);
  }
}

function parseQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[key] = [existing, value];
  }
  return query;
}

function parseBody(rawBody: string, contentType: string): unknown {
  if (!rawBody) return undefined;
  if (!contentType.includes('application/json')) return rawBody;
  try {
    return JSON.parse(rawBody);
  } catch {
    return rawBody;
  }
}

function serializeBody(response: MockResponse, headers: http.OutgoingHttpHeaders): string | Buffer | undefined {
  if (response.rawBody !== undefined) return response.rawBody;
  if (response.body === undefined) return undefined;
  if (Buffer.isBuffer(response.body) || typeof response.body === 'string') return response.body;
  if (!hasHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
  return JSON.stringify(response.body);
}

function hasHeader(headers: http.OutgoingHttpHeaders, name: string): boolean {
  const normalized = name.toLowerCase();
  return Object.keys(headers).some(key => key.toLowerCase() === normalized);
}
