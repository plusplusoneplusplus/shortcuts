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
  MemoryAggregateRequest,
  MemoryAggregateResponse,
  MemoryConfig,
  MemoryLevel,
  MemoryOverviewResponse,
  RawDbTableData,
  RawDbTableInfo,
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

export interface RawDbTableOptions {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

function repoMemoryPath(repoId: string, suffix = ''): string {
  return `/repos/${encodePathSegment(repoId)}/memory${suffix}`;
}

function levelPath(level: MemoryLevel): string {
  return `/memory/bounded/${encodePathSegment(level)}`;
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

function rawDbQuery(options?: RawDbTableOptions): CocRequestOptions['query'] {
  return {
    page: options?.page,
    pageSize: options?.pageSize,
    sort: options?.sort,
    order: options?.order,
  };
}

function aggregateBody(request?: MemoryAggregateRequest): MemoryAggregateRequest {
  return {
    model: request?.model || undefined,
    target: request?.target || undefined,
  };
}

function responseFromConflict(error: CocApiError): MemoryAggregateResponse | undefined {
  if (error.status !== 409 || !error.body || typeof error.body !== 'object') return undefined;
  const body = error.body as Partial<MemoryAggregateResponse>;
  if (typeof body.taskId !== 'string' || typeof body.status !== 'string') return undefined;
  return {
    taskId: body.taskId,
    processId: typeof body.processId === 'string' ? body.processId : null,
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

  async aggregateRepo(repoId: string, request?: MemoryAggregateRequest): Promise<MemoryAggregateResponse> {
    try {
      return await this.transport.request<MemoryAggregateResponse>(repoMemoryPath(repoId, '/aggregate'), {
        method: 'POST',
        body: aggregateBody(request),
      });
    } catch (error) {
      if (error instanceof CocApiError) {
        const response = responseFromConflict(error);
        if (response) return response;
      }
      throw error;
    }
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

  rawDbTables(repoId: string): Promise<{ tables: RawDbTableInfo[] }> {
    return this.transport.request(repoMemoryPath(repoId, '/raw-db/tables'));
  }

  rawDbTable(repoId: string, tableName: string, options?: RawDbTableOptions): Promise<RawDbTableData> {
    return this.transport.request<RawDbTableData>(
      repoMemoryPath(repoId, `/raw-db/tables/${encodePathSegment(tableName)}`),
      { query: rawDbQuery(options) },
    );
  }
}
