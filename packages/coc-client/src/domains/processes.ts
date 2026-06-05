import type {
  AIProcess,
  AskUserResponseRequest,
  AskUserResponseResponse,
  CreateProcessRequest,
  ProcessDetailResponse,
  CreatePendingProcessMessageResponse,
  ProcessListQuery,
  ProcessListResponse,
  PendingProcessMessage,
  PinnedTurnsResponse,
  ProcessForkResponse,
  ProcessMessageRequest,
  ProcessMessageResponse,
  ProcessOutputQuery,
  ProcessOutputResponse,
  ProcessGroupPinResponse,
  ProcessGroupPinsResponse,
  ProcessGroupPinType,
  ProcessResumeCliResponse,
  ProcessSearchQuery,
  ProcessSearchResponse,
  ProcessSummariesResponse,
  PromoteToRalphResult,
  TurnArchiveResponse,
  TurnDeleteResponse,
  TurnPinResponse,
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
    include: Array.isArray(query.include) ? serializeArrayQuery(query.include) : query.include,
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

  search(query: ProcessSearchQuery, options?: Pick<CocRequestOptions, 'signal'>): Promise<ProcessSearchResponse> {
    return this.transport.request<ProcessSearchResponse>('/processes/search', {
      query: serializeListQuery(query),
      signal: options?.signal,
    });
  }

  create(request: CreateProcessRequest): Promise<AIProcess> {
    return this.transport.request<AIProcess>('/processes', { method: 'POST', body: request });
  }

  get(processId: string, query?: Pick<ProcessListQuery, 'workspace' | 'exclude' | 'include'>): Promise<ProcessDetailResponse> {
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

  createPendingMessage(processId: string, request: Pick<PendingProcessMessage, 'content' | 'mode'>, query?: Pick<ProcessListQuery, 'workspace'>): Promise<CreatePendingProcessMessageResponse> {
    return this.transport.request<CreatePendingProcessMessageResponse>(`/processes/${encodePathSegment(processId)}/pending-messages`, {
      method: 'POST',
      query,
      body: { ...request },
    });
  }

  deletePendingMessage(processId: string, messageId: string, query?: Pick<ProcessListQuery, 'workspace'>): Promise<void> {
    return this.transport.request<void>(
      `/processes/${encodePathSegment(processId)}/pending-messages/${encodePathSegment(messageId)}`,
      { method: 'DELETE', query },
    );
  }

  deleteTurn(processId: string, turnIndex: number): Promise<TurnDeleteResponse> {
    return this.transport.request<TurnDeleteResponse>(`/processes/${encodePathSegment(processId)}/turns/${turnIndex}`, {
      method: 'DELETE',
    });
  }

  restoreTurn(processId: string, turnIndex: number): Promise<TurnDeleteResponse> {
    return this.transport.request<TurnDeleteResponse>(`/processes/${encodePathSegment(processId)}/turns/${turnIndex}/restore`, {
      method: 'PATCH',
      body: {},
    });
  }

  pinTurn(processId: string, turnIndex: number, pinned: boolean): Promise<TurnPinResponse> {
    return this.transport.request<TurnPinResponse>(`/processes/${encodePathSegment(processId)}/turns/${turnIndex}/pin`, {
      method: 'PATCH',
      body: { pinned },
    });
  }

  archiveTurn(processId: string, turnIndex: number, archived: boolean): Promise<TurnArchiveResponse> {
    return this.transport.request<TurnArchiveResponse>(`/processes/${encodePathSegment(processId)}/turns/${turnIndex}/archive`, {
      method: 'PATCH',
      body: { archived },
    });
  }

  pin(processId: string, pinned: boolean): Promise<{ process: AIProcess }> {
    return this.transport.request<{ process: AIProcess }>(`/processes/${encodePathSegment(processId)}/pin`, {
      method: 'PATCH',
      body: { pinned },
    });
  }

  archive(processId: string, archived: boolean): Promise<{ process: AIProcess }> {
    return this.transport.request<{ process: AIProcess }>(`/processes/${encodePathSegment(processId)}/archive`, {
      method: 'PATCH',
      body: { archived },
    });
  }

  archiveBatch(ids: string[]): Promise<void> {
    return this.transport.request<void>('/processes/archive', {
      method: 'POST',
      body: { ids: [...ids] },
    });
  }

  unarchiveBatch(ids: string[]): Promise<void> {
    return this.transport.request<void>('/processes/unarchive', {
      method: 'POST',
      body: { ids: [...ids] },
    });
  }

  pinnedTurns(processId: string): Promise<PinnedTurnsResponse> {
    return this.transport.request<PinnedTurnsResponse>(`/processes/${encodePathSegment(processId)}/turns/pinned`);
  }

  listGroupPins(workspaceId: string): Promise<ProcessGroupPinsResponse> {
    return this.transport.request<ProcessGroupPinsResponse>(`/workspaces/${encodePathSegment(workspaceId)}/group-pins`);
  }

  pinGroup(workspaceId: string, type: ProcessGroupPinType, groupId: string, pinned: boolean): Promise<ProcessGroupPinResponse> {
    return this.transport.request<ProcessGroupPinResponse>(
      `/workspaces/${encodePathSegment(workspaceId)}/group-pins/${encodePathSegment(type)}/${encodePathSegment(groupId)}`,
      {
        method: 'PATCH',
        body: { pinned },
      },
    );
  }

  resumeCli(processId: string): Promise<ProcessResumeCliResponse> {
    return this.transport.request<ProcessResumeCliResponse>(`/processes/${encodePathSegment(processId)}/resume-cli`, {
      method: 'POST',
    });
  }

  fork(processId: string, query?: Pick<ProcessListQuery, 'workspace'>): Promise<ProcessForkResponse> {
    return this.transport.request<ProcessForkResponse>(`/processes/${encodePathSegment(processId)}/fork`, {
      method: 'POST',
      query,
      body: {},
    });
  }

  /**
   * Promote a completed ask-mode chat into a Ralph session in place.
   * Attaches a grilling-phase ralph context to the existing process and
   * enqueues a synthesis follow-up turn against the same processId.
   */
  promoteToRalph(
    processId: string,
    options?: { workspaceId?: string; extraGuidance?: string },
  ): Promise<PromoteToRalphResult> {
    const query = options?.workspaceId ? { workspace: options.workspaceId } : undefined;
    const body: { workspaceId?: string; extraGuidance?: string } = {};
    if (options?.workspaceId) body.workspaceId = options.workspaceId;
    if (options?.extraGuidance && options.extraGuidance.trim().length > 0) {
      body.extraGuidance = options.extraGuidance;
    }
    return this.transport.request<PromoteToRalphResult>(
      `/processes/${encodePathSegment(processId)}/promote-to-ralph`,
      { method: 'POST', query, body },
    );
  }

  output(processId: string, query?: ProcessOutputQuery): Promise<ProcessOutputResponse | string> {
    return this.transport.request<ProcessOutputResponse | string>(`/processes/${encodePathSegment(processId)}/output`, {
      query: serializeOutputQuery(query),
    });
  }

  askUserResponse(processId: string, request: AskUserResponseRequest): Promise<AskUserResponseResponse> {
    return this.transport.request<AskUserResponseResponse>(`/processes/${encodePathSegment(processId)}/ask-user-response`, {
      method: 'POST',
      body: { ...request },
    });
  }

  streamUrl(processId: string, query?: Pick<ProcessListQuery, 'workspace'>): string {
    return buildApiUrl(this.options.baseUrl, this.options.apiBasePath, `/processes/${encodePathSegment(processId)}/stream`, query);
  }

  stream(processId: string, options: ProcessStreamOptions): { close: () => void } {
    return new ProcessSseClient(this.options).stream(processId, options);
  }
}
