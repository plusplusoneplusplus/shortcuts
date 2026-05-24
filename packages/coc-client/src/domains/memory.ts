import { CocApiError } from '../errors';
import type {
  AggregateToolCallsResponse,
  BoundedMemoryDeleteResponse,
  BoundedMemoryLevelsOverview,
  BoundedMemoryResponse,
  BoundedMemorySaveResponse,
  ConsolidatedEntryWithAnswer,
  ExploreCacheConsolidatedListResponse,
  ExploreCacheLevelsOverview,
  ExploreCacheRawListResponse,
  ListFactsOptions,
  MemoryPromoteRequest,
  MemoryPromoteResponse,
  MemoryConfig,
  MemoryEpisode,
  MemoryFact,
  MemoryLevel,
  MemoryOverviewResponse,
  MemoryV2ExportData,
  RepoMemoryDeleteResponse,
  ToolCallCacheStats,
  ToolCallQAEntry,
} from '../contracts';
import type { CocRequestOptions, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

export interface MemoryHashOptions {
  hash?: string;
}

export interface MemoryDeleteOptions extends MemoryHashOptions {
  token?: string;
}

function repoMemoryPath(repoId: string, suffix = ''): string {
  return `/repos/${encodePathSegment(repoId)}/memory${suffix}`;
}

function levelPath(level: MemoryLevel): string {
  return `/memory/bounded/${encodePathSegment(level)}`;
}

function memoryV2Path(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/memory/v2${suffix}`;
}

function queryWithHash(options?: MemoryHashOptions): CocRequestOptions['query'] {
  return options?.hash ? { hash: options.hash } : undefined;
}

function queryWithDeleteOptions(options?: MemoryDeleteOptions): CocRequestOptions['query'] {
  return {
    hash: options?.hash,
    token: options?.token,
  };
}

function promoteBody(request?: MemoryPromoteRequest): MemoryPromoteRequest {
  return {
    model: request?.model || undefined,
    target: request?.target || undefined,
  };
}

function listFactsPath(workspaceId: string, options: ListFactsOptions = {}): string {
  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (Array.isArray(options.status)) {
    options.status.forEach(status => params.append('status', status));
  } else if (options.status) {
    params.set('status', options.status);
  }
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const query = params.toString();
  return `${memoryV2Path(workspaceId, '/facts')}${query ? `?${query}` : ''}`;
}

function responseFromConflict(error: CocApiError): MemoryPromoteResponse | undefined {
  if (error.status !== 409 || !error.body || typeof error.body !== 'object') return undefined;
  const body = error.body as Partial<MemoryPromoteResponse>;
  if (typeof body.taskId !== 'string' || typeof body.status !== 'string') return undefined;
  return {
    taskId: body.taskId,
    processId: typeof body.processId === 'string' ? body.processId : null,
    operation: body.operation === 'promotion' ? 'promotion' : undefined,
    status: body.status,
  };
}

export class MemoryClient {
  constructor(private readonly transport: RequestAdapter) {}

  getConfig(): Promise<MemoryConfig> {
    return this.transport.request<MemoryConfig>('/memory/config');
  }

  replaceConfig(config: MemoryConfig): Promise<MemoryConfig> {
    return this.transport.request<MemoryConfig>('/memory/config', { method: 'PUT', body: { ...config } });
  }

  getBoundedLevels(): Promise<BoundedMemoryLevelsOverview> {
    return this.transport.request<BoundedMemoryLevelsOverview>('/memory/bounded/levels');
  }

  getBoundedLevel(level: MemoryLevel, options?: MemoryHashOptions): Promise<BoundedMemoryResponse> {
    return this.transport.request<BoundedMemoryResponse>(levelPath(level), { query: queryWithHash(options) });
  }

  saveBoundedLevel(level: MemoryLevel, content: string, options?: MemoryHashOptions): Promise<BoundedMemorySaveResponse> {
    return this.transport.request<BoundedMemorySaveResponse>(levelPath(level), {
      method: 'PUT',
      query: queryWithHash(options),
      body: { content },
    });
  }

  deleteBoundedLevel(level: MemoryLevel, options?: MemoryDeleteOptions): Promise<BoundedMemoryDeleteResponse> {
    return this.transport.request<BoundedMemoryDeleteResponse>(levelPath(level), {
      method: 'DELETE',
      query: queryWithDeleteOptions(options),
    });
  }

  getExploreCacheLevels(): Promise<ExploreCacheLevelsOverview> {
    return this.transport.request<ExploreCacheLevelsOverview>('/memory/explore-cache/levels');
  }

  listExploreCacheRaw(level: MemoryLevel = 'system', options?: MemoryHashOptions): Promise<ExploreCacheRawListResponse> {
    return this.transport.request<ExploreCacheRawListResponse>('/memory/explore-cache/raw', {
      query: { level, hash: options?.hash },
    });
  }

  getExploreCacheRaw(filename: string, level: MemoryLevel = 'system', options?: MemoryHashOptions): Promise<ToolCallQAEntry> {
    return this.transport.request<ToolCallQAEntry>(`/memory/explore-cache/raw/${encodePathSegment(filename)}`, {
      query: { level, hash: options?.hash },
    });
  }

  listExploreCacheConsolidated(level: MemoryLevel = 'system', options?: MemoryHashOptions): Promise<ExploreCacheConsolidatedListResponse> {
    return this.transport.request<ExploreCacheConsolidatedListResponse>('/memory/explore-cache/consolidated', {
      query: { level, hash: options?.hash },
    });
  }

  getExploreCacheConsolidated(id: string, level: MemoryLevel = 'system', options?: MemoryHashOptions): Promise<ConsolidatedEntryWithAnswer> {
    return this.transport.request<ConsolidatedEntryWithAnswer>(`/memory/explore-cache/consolidated/${encodePathSegment(id)}`, {
      query: { level, hash: options?.hash },
    });
  }

  getToolCallCacheStats(): Promise<ToolCallCacheStats> {
    return this.transport.request<ToolCallCacheStats>('/memory/aggregate-tool-calls/stats');
  }

  aggregateToolCalls(): Promise<AggregateToolCallsResponse> {
    return this.transport.request<AggregateToolCallsResponse>('/memory/aggregate-tool-calls', { method: 'POST' });
  }

  getRepoOverview(repoId: string): Promise<MemoryOverviewResponse> {
    return this.transport.request<MemoryOverviewResponse>(repoMemoryPath(repoId, '/overview'));
  }

  async promoteRepo(repoId: string, request?: MemoryPromoteRequest): Promise<MemoryPromoteResponse> {
    try {
      return await this.transport.request<MemoryPromoteResponse>(repoMemoryPath(repoId, '/aggregate'), {
        method: 'POST',
        body: promoteBody(request),
      });
    } catch (error) {
      if (error instanceof CocApiError) {
        const response = responseFromConflict(error);
        if (response) return response;
      }
      throw error;
    }
  }

  async aggregateRepo(repoId: string, request?: MemoryPromoteRequest): Promise<MemoryPromoteResponse> {
    return this.promoteRepo(repoId, request);
  }

  getRepoBounded(repoId: string): Promise<BoundedMemoryResponse> {
    return this.transport.request<BoundedMemoryResponse>(repoMemoryPath(repoId, '/bounded'));
  }

  saveRepoBounded(repoId: string, content: string): Promise<BoundedMemorySaveResponse> {
    return this.transport.request<BoundedMemorySaveResponse>(repoMemoryPath(repoId, '/bounded'), {
      method: 'PUT',
      body: { content },
    });
  }

  deleteRepoMemory(repoId: string): Promise<RepoMemoryDeleteResponse> {
    return this.transport.request<RepoMemoryDeleteResponse>(repoMemoryPath(repoId), { method: 'DELETE' });
  }

}

export class MemoryV2Client {
  constructor(private readonly transport: RequestAdapter) {}

  async listFacts(workspaceId: string, options: ListFactsOptions = {}): Promise<MemoryFact[]> {
    const response = await this.transport.request<{ facts: MemoryFact[] }>(listFactsPath(workspaceId, options));
    return response.facts;
  }

  async createFact(
    workspaceId: string,
    content: string,
    options: { importance?: number; tags?: string[]; sourceProcessId?: string } = {},
  ): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(memoryV2Path(workspaceId, '/facts'), {
      method: 'POST',
      body: {
        content,
        importance: options.importance,
        tags: options.tags ?? [],
        sourceProcessId: options.sourceProcessId,
      },
    });
    return response.fact;
  }

  async updateFact(
    workspaceId: string,
    factId: string,
    updates: Partial<Pick<MemoryFact, 'content' | 'importance' | 'tags' | 'status'>>,
  ): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(
      memoryV2Path(workspaceId, `/facts/${encodePathSegment(factId)}`),
      { method: 'PATCH', body: { ...updates } },
    );
    return response.fact;
  }

  async deleteFact(workspaceId: string, factId: string): Promise<void> {
    await this.transport.request<{ deleted: boolean }>(
      memoryV2Path(workspaceId, `/facts/${encodePathSegment(factId)}`),
      { method: 'DELETE' },
    );
  }

  async listReview(workspaceId: string): Promise<MemoryFact[]> {
    const response = await this.transport.request<{ facts: MemoryFact[] }>(memoryV2Path(workspaceId, '/review'));
    return response.facts;
  }

  async approveReview(workspaceId: string, factId: string, editedContent?: string): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(
      memoryV2Path(workspaceId, `/review/${encodePathSegment(factId)}/approve`),
      {
        method: 'POST',
        body: editedContent !== undefined ? { content: editedContent } : {},
      },
    );
    return response.fact;
  }

  async rejectReview(workspaceId: string, factId: string): Promise<MemoryFact> {
    const response = await this.transport.request<{ fact: MemoryFact }>(
      memoryV2Path(workspaceId, `/review/${encodePathSegment(factId)}/reject`),
      { method: 'POST' },
    );
    return response.fact;
  }

  async listEpisodes(workspaceId: string, limit = 50): Promise<MemoryEpisode[]> {
    const response = await this.transport.request<{ episodes: MemoryEpisode[] }>(
      memoryV2Path(workspaceId, '/episodes'),
      { query: { limit } },
    );
    return response.episodes;
  }

  exportData(workspaceId: string): Promise<MemoryV2ExportData> {
    return this.transport.request<MemoryV2ExportData>(memoryV2Path(workspaceId, '/export'));
  }

  async wipe(workspaceId: string): Promise<void> {
    await this.transport.request<{ wiped: boolean }>(memoryV2Path(workspaceId, '/wipe'), {
      method: 'DELETE',
      body: { confirm: true },
    });
  }
}
