import type {
  AIProcess,
  CreateProcessRequest,
  ProcessDetailResponse,
  ProcessListQuery,
  ProcessListResponse,
  ProcessMessageRequest,
  ProcessMessageResponse,
  ProcessOutputQuery,
  ProcessOutputResponse,
  ProcessSummariesResponse,
} from '../contracts';
import { ProcessSseClient } from '../realtime/sse';
import type { CocRequestOptions, NormalizedCocClientOptions, ProcessStreamOptions, QueryPrimitive, RequestAdapter } from '../types';
import { buildApiUrl, encodePathSegment } from '../url';

function serializeListQuery(query?: ProcessListQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    ...query,
    status: Array.isArray(query.status) ? serializeArrayQuery(query.status) : query.status,
    exclude: Array.isArray(query.exclude) ? serializeArrayQuery(query.exclude) : query.exclude,
  } as Record<string, QueryPrimitive>;
}

function serializeArrayQuery<T>(value: T[]): string | undefined {
  return value.length > 0 ? value.join(',') : undefined;
}

function serializeOutputQuery(query?: ProcessOutputQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  return {
    workspace: query.workspace,
    range: query.range,
    offset: query.offset,
  };
}

export class ProcessesClient {
  constructor(
    private readonly transport: RequestAdapter,
    private readonly options: NormalizedCocClientOptions,
  ) {}

  list(query?: ProcessListQuery): Promise<ProcessListResponse> {
    return this.transport.request<ProcessListResponse>('/processes', { query: serializeListQuery(query) });
  }

  summaries(query?: ProcessListQuery): Promise<ProcessSummariesResponse> {
    return this.transport.request<ProcessSummariesResponse>('/processes/summaries', { query: serializeListQuery(query) });
  }

  create(request: CreateProcessRequest): Promise<AIProcess> {
    return this.transport.request<AIProcess>('/processes', { method: 'POST', body: request });
  }

  get(processId: string, query?: Pick<ProcessListQuery, 'workspace' | 'exclude'>): Promise<ProcessDetailResponse> {
    return this.transport.request<ProcessDetailResponse>(`/processes/${encodePathSegment(processId)}`, {
      query: serializeListQuery(query),
    });
  }

  update(processId: string, updates: Partial<AIProcess>, query?: Pick<ProcessListQuery, 'workspace'>): Promise<{ process: AIProcess }> {
    return this.transport.request<{ process: AIProcess }>(`/processes/${encodePathSegment(processId)}`, {
      method: 'PATCH',
      query,
      body: updates,
    });
  }

  delete(processId: string, query?: Pick<ProcessListQuery, 'workspace'>): Promise<void> {
    return this.transport.request<void>(`/processes/${encodePathSegment(processId)}`, { method: 'DELETE', query });
  }

  cancel(processId: string, query?: Pick<ProcessListQuery, 'workspace'>): Promise<{ process: AIProcess }> {
    return this.transport.request<{ process: AIProcess }>(`/processes/${encodePathSegment(processId)}/cancel`, {
      method: 'POST',
      query,
    });
  }

  sendMessage(processId: string, request: ProcessMessageRequest, query?: Pick<ProcessListQuery, 'workspace'>): Promise<ProcessMessageResponse> {
    return this.transport.request<ProcessMessageResponse>(`/processes/${encodePathSegment(processId)}/message`, {
      method: 'POST',
      query,
      body: { ...request },
    });
  }

  output(processId: string, query?: ProcessOutputQuery): Promise<ProcessOutputResponse | string> {
    return this.transport.request<ProcessOutputResponse | string>(`/processes/${encodePathSegment(processId)}/output`, {
      query: serializeOutputQuery(query),
    });
  }

  streamUrl(processId: string, query?: Pick<ProcessListQuery, 'workspace'>): string {
    return buildApiUrl(this.options.baseUrl, this.options.apiBasePath, `/processes/${encodePathSegment(processId)}/stream`, query);
  }

  stream(processId: string, options: ProcessStreamOptions): { close: () => void } {
    return new ProcessSseClient(this.options).stream(processId, options);
  }
}
