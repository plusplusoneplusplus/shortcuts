import type { JsonObject } from './common';

export type TaskPriority = 'low' | 'normal' | 'high' | string;
export type QueueStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;

export interface QueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  isPaused: boolean;
  isDraining: boolean;
  pausedRepos?: string[];
  isAutopilotPaused: boolean;
  pauseReason?: JsonObject;
}

export interface QueuedTask {
  id: string;
  repoId?: string;
  folderPath?: string;
  type: string;
  priority: TaskPriority;
  status: QueueStatus;
  createdAt: number;
  payload: JsonObject;
  config: JsonObject;
  displayName?: string;
  processId?: string;
  [key: string]: unknown;
}

export interface QueueListResponse {
  queued: JsonObject[];
  running: JsonObject[];
  stats: QueueStats;
}

export interface QueueStatsResponse {
  stats: QueueStats;
}

export interface EnqueueTaskRequest {
  type: string;
  priority?: TaskPriority;
  repoId?: string;
  folderPath?: string;
  payload: JsonObject;
  config?: JsonObject;
  displayName?: string;
  [key: string]: unknown;
}

export interface EnqueueTaskResponse {
  task: Partial<QueuedTask> & { id: string };
}

export interface QueueModelsResponse {
  models: string[];
}
