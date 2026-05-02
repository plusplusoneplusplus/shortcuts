import type {
  EnqueueTaskRequest,
  EnqueueTaskResponse,
  QueueHistoryResponse,
  QueueListResponse,
  QueueModelsResponse,
  QueueStatsResponse,
  QueueStatus,
} from '../contracts';
import type { CocRequestOptions, QueryPrimitive, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

export interface QueueQuery {
  workspace?: string;
  type?: string;
}

export interface QueueHistoryQuery extends QueueQuery {
  limit?: number;
  status?: QueueStatus | QueueStatus[];
}

export interface QueueCancelOptions {
  reason?: string;
}

function serializeQueueQuery(query?: QueueQuery | QueueHistoryQuery): CocRequestOptions['query'] {
  if (!query) return undefined;
  const status = 'status' in query ? query.status : undefined;
  return {
    ...query,
    status: Array.isArray(status) ? serializeArrayQuery(status) : status,
  } as Record<string, QueryPrimitive>;
}

function serializeArrayQuery<T>(value: T[]): string | undefined {
  return value.length > 0 ? value.join(',') : undefined;
}

export class QueueClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(query?: QueueQuery): Promise<QueueListResponse> {
    return this.transport.request<QueueListResponse>('/queue', { query: serializeQueueQuery(query) });
  }

  stats(query?: Pick<QueueQuery, 'workspace'>): Promise<QueueStatsResponse> {
    return this.transport.request<QueueStatsResponse>('/queue/stats', { query: serializeQueueQuery(query) });
  }

  history(query?: QueueHistoryQuery): Promise<QueueHistoryResponse> {
    return this.transport.request<QueueHistoryResponse>('/queue/history', { query: serializeQueueQuery(query) });
  }

  models(): Promise<QueueModelsResponse> {
    return this.transport.request<QueueModelsResponse>('/queue/models');
  }

  enqueue(request: EnqueueTaskRequest): Promise<EnqueueTaskResponse> {
    return this.transport.request<EnqueueTaskResponse>('/queue', { method: 'POST', body: { ...request } });
  }

  pause(workspace?: string): Promise<QueueStatsResponse & { paused: boolean; workspace?: string; repoId?: string }> {
    return this.transport.request('/queue/pause', { method: 'POST', query: workspace ? { workspace } : undefined });
  }

  resume(workspace?: string): Promise<QueueStatsResponse & { paused: boolean; workspace?: string; repoId?: string }> {
    return this.transport.request('/queue/resume', { method: 'POST', query: workspace ? { workspace } : undefined });
  }

  cancel(taskId: string, options?: QueueCancelOptions): Promise<unknown> {
    return this.transport.request(`/queue/${encodePathSegment(taskId)}`, {
      method: 'DELETE',
      body: options?.reason === undefined ? undefined : { reason: options.reason },
    });
  }
}
