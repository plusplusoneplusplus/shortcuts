import type {
  EnqueueTaskRequest,
  EnqueueTaskResponse,
  QueueHistoryResponse,
  QueueImagesResponse,
  QueueListResponse,
  QueueModelsResponse,
  QueueMoveResponse,
  QueuePauseMarkerResponse,
  QueueReposResponse,
  QueueResolvedPromptResponse,
  QueueSummarizeRequest,
  QueueSummarizeResponse,
  QueueStatsResponse,
  QueueStatus,
  QueueTaskMutationResponse,
  QueueTaskResponse,
} from '../contracts';
import type { CocRequestOptions, QueryPrimitive, RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

export interface QueueQuery {
  workspace?: string;
  repoId?: string;
  type?: string;
}

export interface QueueHistoryQuery extends QueueQuery {
  limit?: number;
  status?: QueueStatus | QueueStatus[];
}

export interface QueueCancelOptions {
  reason?: string;
}

export interface QueuePauseMarkerRequest {
  afterIndex?: number;
  repoId?: string;
}

export type QueueScope = string | Pick<QueueQuery, 'workspace' | 'repoId'>;

export interface QueuePauseOptions {
  durationHours?: 1 | 2 | 3 | 4 | 8;
  until?: number | string;
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

function serializeQueueScope(scope?: QueueScope): CocRequestOptions['query'] {
  if (!scope) return undefined;
  if (typeof scope === 'string') return { workspace: scope };
  return {
    workspace: scope.workspace,
    repoId: scope.repoId,
  };
}

export class QueueClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(query?: QueueQuery): Promise<QueueListResponse> {
    return this.transport.request<QueueListResponse>('/queue', { query: serializeQueueQuery(query) });
  }

  stats(query?: Pick<QueueQuery, 'workspace' | 'repoId'>): Promise<QueueStatsResponse> {
    return this.transport.request<QueueStatsResponse>('/queue/stats', { query: serializeQueueQuery(query) });
  }

  history(query?: QueueHistoryQuery): Promise<QueueHistoryResponse> {
    return this.transport.request<QueueHistoryResponse>('/queue/history', { query: serializeQueueQuery(query) });
  }

  models(): Promise<QueueModelsResponse> {
    return this.transport.request<QueueModelsResponse>('/queue/models');
  }

  repos(): Promise<QueueReposResponse> {
    return this.transport.request<QueueReposResponse>('/queue/repos');
  }

  getTask(taskId: string): Promise<QueueTaskResponse> {
    return this.transport.request<QueueTaskResponse>(`/queue/${encodePathSegment(taskId)}`);
  }

  images(taskId: string): Promise<QueueImagesResponse> {
    return this.transport.request<QueueImagesResponse>(`/queue/${encodePathSegment(taskId)}/images`);
  }

  resolvedPrompt(taskId: string): Promise<QueueResolvedPromptResponse> {
    return this.transport.request<QueueResolvedPromptResponse>(`/queue/${encodePathSegment(taskId)}/resolved-prompt`);
  }

  enqueue(request: EnqueueTaskRequest): Promise<EnqueueTaskResponse> {
    return this.transport.request<EnqueueTaskResponse>('/queue', { method: 'POST', body: { ...request } });
  }

  /**
   * Re-run a failed or cancelled task by enqueueing a fresh copy from its
   * preserved payload/config. Used to recover when the first message of a chat
   * failed before any resumable session existed.
   */
  retry(taskId: string): Promise<EnqueueTaskResponse> {
    return this.transport.request<EnqueueTaskResponse>(`/queue/${encodePathSegment(taskId)}/retry`, { method: 'POST' });
  }

  pause(scope?: QueueScope, options?: QueuePauseOptions): Promise<QueueStatsResponse & { paused: boolean; pausedUntil?: number; workspace?: string; repoId?: string }> {
    return this.transport.request('/queue/pause', { method: 'POST', query: serializeQueueScope(scope), body: options });
  }

  resume(scope?: QueueScope): Promise<QueueStatsResponse & { paused: boolean; workspace?: string; repoId?: string }> {
    return this.transport.request('/queue/resume', { method: 'POST', query: serializeQueueScope(scope) });
  }

  pauseAutopilot(scope?: QueueScope, options?: QueuePauseOptions): Promise<QueueStatsResponse & { isAutopilotPaused: boolean; autopilotPausedUntil?: number; repoId?: string }> {
    return this.transport.request('/queue/pause-autopilot', { method: 'POST', query: serializeQueueScope(scope), body: options });
  }

  resumeAutopilot(scope?: QueueScope): Promise<QueueStatsResponse & { isAutopilotPaused: boolean; repoId?: string }> {
    return this.transport.request('/queue/resume-autopilot', { method: 'POST', query: serializeQueueScope(scope) });
  }

  insertPauseMarker(request: QueuePauseMarkerRequest = {}): Promise<QueuePauseMarkerResponse> {
    return this.transport.request<QueuePauseMarkerResponse>('/queue/pause-marker', { method: 'POST', body: request });
  }

  removePauseMarker(markerId: string): Promise<{ removed: boolean; markerId: string }> {
    return this.transport.request(`/queue/pause-marker/${encodePathSegment(markerId)}`, { method: 'DELETE' });
  }

  summarize(request: QueueSummarizeRequest): Promise<QueueSummarizeResponse> {
    return this.transport.request<QueueSummarizeResponse>('/queue/summarize', {
      method: 'POST',
      body: {
        processIds: [...request.processIds],
        workspaceId: request.workspaceId,
        userPrompt: request.userPrompt,
      },
    });
  }

  clear(scope?: QueueScope): Promise<QueueStatsResponse & { cleared: number }> {
    return this.transport.request('/queue', { method: 'DELETE', query: serializeQueueScope(scope) });
  }

  clearHistory(scope?: QueueScope): Promise<{ cleared: number | boolean }> {
    return this.transport.request('/queue/history', { method: 'DELETE', query: serializeQueueScope(scope) });
  }

  deleteHistoryEntry(taskId: string): Promise<{ deleted: boolean; taskId: string }> {
    return this.transport.request(`/queue/history/${encodePathSegment(taskId)}`, { method: 'DELETE' });
  }

  cancel(taskId: string, options?: QueueCancelOptions): Promise<unknown> {
    return this.transport.request(`/queue/${encodePathSegment(taskId)}`, {
      method: 'DELETE',
      body: options?.reason === undefined ? undefined : { reason: options.reason },
    });
  }

  forceFail(taskId: string, error?: string): Promise<QueueStatsResponse & { forceFailed: boolean }> {
    return this.transport.request(`/queue/${encodePathSegment(taskId)}/force-fail`, {
      method: 'POST',
      body: error === undefined ? undefined : { error },
    });
  }

  moveToTop(taskId: string): Promise<QueueMoveResponse> {
    return this.transport.request<QueueMoveResponse>(`/queue/${encodePathSegment(taskId)}/move-to-top`, { method: 'POST' });
  }

  moveUp(taskId: string): Promise<QueueMoveResponse> {
    return this.transport.request<QueueMoveResponse>(`/queue/${encodePathSegment(taskId)}/move-up`, { method: 'POST' });
  }

  moveDown(taskId: string): Promise<QueueMoveResponse> {
    return this.transport.request<QueueMoveResponse>(`/queue/${encodePathSegment(taskId)}/move-down`, { method: 'POST' });
  }

  moveToPosition(taskId: string, position: number): Promise<QueueMoveResponse> {
    return this.transport.request<QueueMoveResponse>(`/queue/${encodePathSegment(taskId)}/move-to/${position}`, { method: 'POST' });
  }

  freeze(taskId: string): Promise<QueueTaskMutationResponse> {
    return this.transport.request<QueueTaskMutationResponse>(`/queue/${encodePathSegment(taskId)}/freeze`, { method: 'POST' });
  }

  unfreeze(taskId: string): Promise<QueueTaskMutationResponse> {
    return this.transport.request<QueueTaskMutationResponse>(`/queue/${encodePathSegment(taskId)}/unfreeze`, { method: 'POST' });
  }

  admit(taskId: string): Promise<QueueTaskMutationResponse> {
    return this.transport.request<QueueTaskMutationResponse>(`/queue/${encodePathSegment(taskId)}/admit`, { method: 'POST' });
  }

  unadmit(taskId: string): Promise<QueueTaskMutationResponse> {
    return this.transport.request<QueueTaskMutationResponse>(`/queue/${encodePathSegment(taskId)}/unadmit`, { method: 'POST' });
  }
}
