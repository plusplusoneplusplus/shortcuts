import type {
  EnqueueTaskRequest,
  EnqueueTaskResponse,
  QueueListResponse,
  QueueModelsResponse,
  QueueStatsResponse,
} from '../contracts';
import type { QueryPrimitive, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

export interface QueueQuery {
  repoId?: string;
  type?: string;
}

export class QueueClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(query?: QueueQuery): Promise<QueueListResponse> {
    return this.transport.request<QueueListResponse>('/queue', { query: query as Record<string, QueryPrimitive> | undefined });
  }

  stats(query?: Pick<QueueQuery, 'repoId'>): Promise<QueueStatsResponse> {
    return this.transport.request<QueueStatsResponse>('/queue/stats', { query });
  }

  history(query?: QueueQuery): Promise<{ history: unknown[] }> {
    return this.transport.request<{ history: unknown[] }>('/queue/history', { query: query as Record<string, QueryPrimitive> | undefined });
  }

  models(): Promise<QueueModelsResponse> {
    return this.transport.request<QueueModelsResponse>('/queue/models');
  }

  enqueue(request: EnqueueTaskRequest): Promise<EnqueueTaskResponse> {
    return this.transport.request<EnqueueTaskResponse>('/queue', { method: 'POST', body: { ...request } });
  }

  pause(query?: Pick<QueueQuery, 'repoId'>): Promise<QueueStatsResponse & { paused: boolean; repoId?: string }> {
    return this.transport.request('/queue/pause', { method: 'POST', query });
  }

  resume(query?: Pick<QueueQuery, 'repoId'>): Promise<QueueStatsResponse & { paused: boolean; repoId?: string }> {
    return this.transport.request('/queue/resume', { method: 'POST', query });
  }

  cancel(taskId: string): Promise<unknown> {
    return this.transport.request(`/queue/${encodePathSegment(taskId)}`, { method: 'DELETE' });
  }
}
