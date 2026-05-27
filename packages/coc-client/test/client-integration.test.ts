import * as path from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CocClient,
  EventsClient,
  GitClient,
  HealthClient,
  NotesClient,
  PreferencesClient,
  ProcessesClient,
  PullRequestsClient,
  QueueClient,
  WorkItemsClient,
  WorkspacesClient,
  SeenStateClient,
  type CocEventSource,
  type CocRequestOptions,
  type CocWebSocket,
  type RequestAdapter,
} from '../src';
import { startMockServer, type MockServer } from './mock-server';

const resolvedFetch = (() => Promise.resolve(new Response('{}', {
  headers: { 'content-type': 'application/json' },
}))) as typeof fetch;

describe('CocClient integration wiring', () => {
  let mock: MockServer | undefined;

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    RecordingWebSocket.urls = [];
    RecordingEventSource.instances = [];
    await mock?.close();
    mock = undefined;
  });

  it('uses default Node fetch options and reaches the mock server', async () => {
    mock = await startMockServer();
    mock.on('GET', '/api/health', {
      body: { status: 'ok', uptime: 12, processCount: 3 },
    });
    const client = new CocClient({ baseUrl: mock.url });

    await expect(client.health.get()).resolves.toEqual({
      status: 'ok',
      uptime: 12,
      processCount: 3,
    });

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      method: 'GET',
      path: '/api/health',
      query: {},
    });
  });

  it('applies default headers and custom API base paths across domain requests', async () => {
    mock = await startMockServer();
    mock.on('GET', '/custom-api/health', {
      body: { status: 'ok', uptime: 1, processCount: 0 },
    });
    mock.on('GET', '/custom-api/workspaces', { body: { workspaces: [] } });
    const client = new CocClient({
      baseUrl: mock.url,
      apiBasePath: 'custom-api/',
      fetch: globalThis.fetch,
      defaultHeaders: {
        authorization: 'Bearer test-token',
        'x-coc-client': 'integration',
      },
    });

    await client.health.get();
    await client.workspaces.list();

    expect(mock.requests.map(request => request.path)).toEqual([
      '/custom-api/health',
      '/custom-api/workspaces',
    ]);
    for (const request of mock.requests) {
      expect(request.headers.authorization).toBe('Bearer test-token');
      expect(request.headers['x-coc-client']).toBe('integration');
    }
  });

  it('constructs every domain client and keeps repos as the workspaces alias', () => {
    const client = new CocClient({
      baseUrl: 'http://example.test',
      fetch: resolvedFetch,
      WebSocket: RecordingWebSocket,
      EventSource: RecordingEventSource,
    });

    expect(client.health).toBeInstanceOf(HealthClient);
    expect(client.git).toBeInstanceOf(GitClient);
    expect(client.notes).toBeInstanceOf(NotesClient);
    expect(client.preferences).toBeInstanceOf(PreferencesClient);
    expect(client.processes).toBeInstanceOf(ProcessesClient);
    expect(client.pullRequests).toBeInstanceOf(PullRequestsClient);
    expect(client.queue).toBeInstanceOf(QueueClient);
    expect(client.seenState).toBeInstanceOf(SeenStateClient);
    expect(client.workItems).toBeInstanceOf(WorkItemsClient);
    expect(client.workspaces).toBeInstanceOf(WorkspacesClient);
    expect(client.repos).toBe(client.workspaces);
    expect(client.events).toBeInstanceOf(EventsClient);
  });

  it('routes all domain requests and direct requests through one shared transport', async () => {
    const client = new CocClient({
      baseUrl: 'http://example.test',
      fetch: resolvedFetch,
    });
    const transport = readPrivateProperty<RequestAdapter>(client, 'transport');
    const requestSpy = vi.spyOn(transport, 'request').mockResolvedValue({} as never);
    const httpDomains = [
      client.health,
      client.git,
      client.notes,
      client.preferences,
      client.processes,
      client.pullRequests,
      client.queue,
      client.seenState,
      client.workItems,
      client.workspaces,
    ];

    for (const domain of httpDomains) {
      expect(readPrivateProperty<RequestAdapter>(domain, 'transport')).toBe(transport);
    }
    expect(readPrivateProperty<unknown>(client.processes, 'options')).toBe(client.options);
    expect(readPrivateProperty<unknown>(client.events, 'options')).toBe(client.options);

    await client.health.get();
    await client.git.getBranchRange('repo-a');
    await client.notes.getTree('repo-a');
    await client.preferences.getGlobal();
    await client.processes.list();
    await client.pullRequests.getProviderConfig();
    await client.queue.list();
    await client.seenState.getMap('repo-a');
    await client.workItems.list('repo-a');
    await client.workspaces.list();
    await client.request('/direct', { query: { source: 'client' } });

    expect(requestSpy.mock.calls.map(call => call[0])).toEqual([
      '/health',
      '/workspaces/repo-a/git/branch-range',
      '/workspaces/repo-a/notes/tree',
      '/preferences',
      '/processes',
      '/providers/config',
      '/queue',
      '/workspaces/repo-a/seen-state',
      '/workspaces/repo-a/work-items',
      '/workspaces',
      '/direct',
    ]);
    expect(requestSpy.mock.calls.at(-1)?.[1]).toEqual({ query: { source: 'client' } });
  });

  it('lets client.request bypass domains while preserving transport options', async () => {
    mock = await startMockServer();
    mock.on('PATCH', '/api/direct', { body: { ok: true } });
    const client = new CocClient({
      baseUrl: mock.url,
      fetch: globalThis.fetch,
      defaultHeaders: { 'x-default': 'default' },
    });
    const controller = new AbortController();

    await expect(client.request('/direct', {
      method: 'PATCH',
      query: { workspace: 'repo-a', limit: 2 },
      headers: { 'x-request': 'request' },
      body: { value: 1 },
      signal: controller.signal,
      timeoutMs: 5_000,
    })).resolves.toEqual({ ok: true });

    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]).toMatchObject({
      method: 'PATCH',
      path: '/api/direct',
      query: { workspace: 'repo-a', limit: '2' },
      body: { value: 1 },
    });
    expect(mock.requests[0].headers).toMatchObject({
      'content-type': 'application/json',
      'x-default': 'default',
      'x-request': 'request',
    });
  });

  it('applies client-level timeouts to domain calls unless a request overrides them', async () => {
    vi.useFakeTimers();
    const fetchMock = createNeverSettlingFetch();
    const client = new CocClient({
      baseUrl: 'http://example.test',
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 1_000,
    });

    const domainRequest = client.health.get();
    const directRequest = client.request('/direct', { timeoutMs: 25 });
    const domainAssertion = expect(domainRequest).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'TIMEOUT',
      message: 'CoC API request timed out after 1000ms',
    });
    const directAssertion = expect(directRequest).rejects.toMatchObject({
      name: 'CocNetworkError',
      code: 'TIMEOUT',
      message: 'CoC API request timed out after 25ms',
    });

    await vi.advanceTimersByTimeAsync(25);
    await directAssertion;
    await vi.advanceTimersByTimeAsync(975);
    await domainAssertion;
  });

  it('propagates realtime WebSocket and EventSource options from the top-level client', () => {
    const client = new CocClient({
      baseUrl: 'http://example.test/root/',
      apiBasePath: 'custom-api',
      fetch: resolvedFetch,
      WebSocket: RecordingWebSocket,
      EventSource: RecordingEventSource,
      wsPath: 'socket',
    });

    const connection = client.events.connect({
      workspaceId: 'repo/a',
      onMessage: vi.fn(),
    });
    expect(RecordingWebSocket.urls).toEqual(['ws://example.test/socket?workspaceId=repo%2Fa']);
    connection.close();

    const stream = client.processes.stream('proc/1', {
      workspaceId: 'repo/a',
      withCredentials: true,
      onEvent: vi.fn(),
    });
    expect(RecordingEventSource.instances).toHaveLength(1);
    expect(RecordingEventSource.instances[0].url).toBe(
      'http://example.test/root/custom-api/processes/proc%2F1/stream?workspace=repo%2Fa',
    );
    expect(RecordingEventSource.instances[0].init).toEqual({ withCredentials: true });
    stream.close();
    expect(RecordingEventSource.instances[0].closed).toBe(true);
  });

  it('threads AbortSignal through stream-capable domains', () => {
    const client = new CocClient({
      baseUrl: 'http://example.test',
      fetch: resolvedFetch,
      EventSource: RecordingEventSource,
    });
    const controller = new AbortController();

    const stream = client.processes.stream('proc-1', {
      signal: controller.signal,
      onEvent: vi.fn(),
    });

    expect(RecordingEventSource.instances).toHaveLength(1);
    expect(RecordingEventSource.instances[0].closed).toBe(false);
    controller.abort();
    expect(RecordingEventSource.instances[0].closed).toBe(true);
    stream.close();
  });

  it('pins the current lifecycle surface without top-level dispose or close methods', () => {
    const client = new CocClient({
      baseUrl: 'http://example.test',
      fetch: resolvedFetch,
    });

    expect('dispose' in client).toBe(false);
    expect('close' in client).toBe(false);
  });
});

describe('CocClient public surface', () => {
  it('type-checks the expected public exports from src/index.ts', () => {
    expect(typeCheckPublicSurface()).toBe('');
  });
});

function readPrivateProperty<T>(target: object, property: string): T {
  return Reflect.get(target, property) as T;
}

function createNeverSettlingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    if (init?.signal?.aborted) {
      reject(init.signal.reason);
      return;
    }
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
}

class RecordingWebSocket implements CocWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static urls: string[] = [];

  readyState = RecordingWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    RecordingWebSocket.urls.push(url);
  }

  send(_data: string): void {}

  close(): void {
    if (this.readyState === RecordingWebSocket.CLOSED) return;
    this.readyState = RecordingWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

class RecordingEventSource implements CocEventSource {
  static instances: RecordingEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();

  constructor(readonly url: string, readonly init?: EventSourceInit) {
    RecordingEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MessageEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
}

function typeCheckPublicSurface(): string {
  const testFile = path.join(__dirname, '__public_surface__.ts');
  const source = `
    import {
      CocClient,
      GitClient,
      HealthClient,
      PreferencesClient,
      ProcessesClient,
      QueueClient,
      SeenStateClient,
      WorkItemsClient,
      WorkspacesClient,
      EventsClient,
      ProcessSseClient,
      ProcessWebSocketConnection,
      HttpTransport,
      CocApiError,
      CocNetworkError,
      buildApiUrl,
      buildQueryString,
      buildWebSocketUrl,
      encodePathSegment,
      normalizeApiBasePath,
      normalizeBaseUrl,
      normalizeOptions,
      type AIProcess,
      type CocClientOptions,
      type CocEventSource,
      type CocRequestOptions,
      type CocWebSocket,
      type ConnectEventsOptions,
      type EventSourceConstructor,
      type GitBranchRangeResponse,
      type GitCommit,
      type GlobalPreferences,
      type HealthResponse,
      type MemoryConfig,
      type ModelInfo,
      type NormalizedCocClientOptions,
      type ProcessStreamOptions,
      type QueueListResponse,
      type RequestAdapter,
      type SeenStateEntry,
      type SeenStateMap,
      type UnseenCountResponse,
      type WebSocketConstructor,
      type WorkItem,
      type WorkspaceInfo,
    } from '../src';

    const constructors = [
      CocClient,
      GitClient,
      HealthClient,
      PreferencesClient,
      ProcessesClient,
      QueueClient,
      SeenStateClient,
      WorkItemsClient,
      WorkspacesClient,
      EventsClient,
      ProcessSseClient,
      ProcessWebSocketConnection,
      HttpTransport,
      CocApiError,
      CocNetworkError,
    ];
    const options: CocClientOptions = { baseUrl: 'http://example.test', fetch: globalThis.fetch };
    const normalized: NormalizedCocClientOptions = normalizeOptions(options);
    const adapter: RequestAdapter = {
      request: async <T = unknown>(_path: string, _options?: CocRequestOptions): Promise<T> => ({}) as T,
    };
    const client: CocClient = new CocClient(options);
    const commit: GitCommit = {
      hash: 'abc123',
      shortHash: 'abc123',
      subject: 'Fix app',
      author: 'Test Author',
      date: '2026-01-01T00:00:00.000Z',
      parentHashes: [],
    };
    const branchRange: GitBranchRangeResponse = {
      baseRef: 'main',
      headRef: 'feature',
      commitCount: 1,
      additions: 2,
      deletions: 1,
      mergeBase: 'abc123',
      fileCount: 1,
    };
    const health: HealthResponse = { status: 'ok', uptime: 1, processCount: 0 };
    const memoryConfig: MemoryConfig = { storageDir: 'C:\\\\memory', backend: 'file' };
    const model: ModelInfo = { id: 'gpt-test', enabled: true };
    const process: AIProcess = {
      id: 'proc-1',
      type: 'chat',
      promptPreview: 'Test',
      status: 'completed',
      startTime: '2026-01-01T00:00:00.000Z',
    };
    const workspace: WorkspaceInfo = {
      id: 'repo-a',
      name: 'Repo A',
      rootPath: 'C:\\\\repos\\\\repo-a',
    };
    const workItem: WorkItem = {
      id: 'wi-1',
      repoId: 'repo-a',
      title: 'Title',
      description: 'Description',
      status: 'planning',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const queue: QueueListResponse = {
      queued: [],
      running: [],
      stats: {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        total: 0,
        isPaused: false,
        isDraining: false,
        isAutopilotPaused: false,
      },
    };
    const seenEntry: SeenStateEntry = {
      processId: 'proc-1',
      seenAt: '2026-01-01T00:00:00.000Z',
    };
    const seenMap: SeenStateMap = { [seenEntry.processId]: seenEntry.seenAt };
    const unseenCount: UnseenCountResponse = { unseenCount: 1 };
    const preferences: GlobalPreferences = { theme: 'auto' };
    const socket: CocWebSocket | undefined = undefined;
    const source: CocEventSource | undefined = undefined;
    const wsConstructor: WebSocketConstructor | undefined = normalized.WebSocket;
    const eventSourceConstructor: EventSourceConstructor | undefined = normalized.EventSource;
    const connectOptions: ConnectEventsOptions = { onMessage: () => undefined };
    const streamOptions: ProcessStreamOptions = { onEvent: () => undefined };
    const url: string = buildApiUrl(normalized.baseUrl, normalized.apiBasePath, '/health');
    const query: string = buildQueryString({ workspace: 'repo-a' });
    const wsUrl: string = buildWebSocketUrl(normalized.baseUrl, normalized.wsPath);
    const encoded: string = encodePathSegment('repo/a');
    const apiBasePath: string = normalizeApiBasePath('api');
    const baseUrl: string = normalizeBaseUrl('http://example.test/');
    void [
      constructors,
      adapter,
      client,
      commit,
      branchRange,
      health,
      memoryConfig,
      model,
      process,
      workspace,
      workItem,
      queue,
      seenEntry,
      seenMap,
      unseenCount,
      preferences,
      socket,
      source,
      wsConstructor,
      eventSourceConstructor,
      connectOptions,
      streamOptions,
      url,
      query,
      wsUrl,
      encoded,
      apiBasePath,
      baseUrl,
    ];
  `;
  const compilerOptions: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    esModuleInterop: true,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const normalizedTestFile = normalizeFileName(testFile);

  host.fileExists = fileName => normalizeFileName(fileName) === normalizedTestFile || originalFileExists(fileName);
  host.readFile = fileName => normalizeFileName(fileName) === normalizedTestFile
    ? source
    : originalReadFile(fileName);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    if (normalizeFileName(fileName) === normalizedTestFile) {
      return ts.createSourceFile(fileName, source, languageVersion, true);
    }
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram([testFile], compilerOptions, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length === 0) return '';
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: fileName => fileName,
    getCurrentDirectory: () => path.resolve(__dirname, '..'),
    getNewLine: () => '\n',
  });
}

function normalizeFileName(fileName: string): string {
  return path.resolve(fileName).toLowerCase();
}
