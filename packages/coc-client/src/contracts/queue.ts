import type { JsonObject, ReasoningEffort } from './common';

export type TaskPriority = 'low' | 'normal' | 'high' | string;
export type QueueStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | string;
export type EffortTierKey = 'very-low' | 'low' | 'medium' | 'high';

export interface QueueStats {
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
  isPaused: boolean;
  pausedUntil?: number;
  isDraining: boolean;
  pausedRepos?: string[];
  isAutopilotPaused: boolean;
  autopilotPausedUntil?: number;
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

export interface QueueTaskSummary extends Partial<QueuedTask> {
  id: string;
}

export interface QueuePauseMarker {
  kind: 'pause-marker';
  id: string;
  createdAt: number;
  durationHours?: 1 | 2 | 3 | 4 | 8;
  [key: string]: unknown;
}

export interface QueueListResponse {
  queued: Array<QueueTaskSummary | QueuePauseMarker>;
  running: QueueTaskSummary[];
  stats: QueueStats;
}

export interface QueueStatsResponse {
  stats: QueueStats;
}

export interface QueueTaskResponse {
  task: QueueTaskSummary;
}

export interface QueueImagesResponse {
  images: string[];
}

export interface QueueResolvedPromptResponse {
  taskId: string;
  type: string;
  planFilePath?: string;
  planFileContent?: string;
  promptFilePath?: string;
  promptFileContent?: string;
  resolvedPrompt?: string;
  [key: string]: unknown;
}

export interface QueueReposResponse {
  repos: Array<{
    repoId: string;
    rootPath: string;
    isPaused: boolean;
    taskCount: number;
    queuedCount: number;
    runningCount: number;
  }>;
}

export interface EnqueueTaskRequest {
  type: string;
  priority?: TaskPriority;
  repoId?: string;
  folderPath?: string;
  payload: JsonObject;
  config?: JsonObject & {
    effortTier?: EffortTierKey;
    model?: string;
    reasoningEffort?: ReasoningEffort;
  };
  displayName?: string;
  [key: string]: unknown;
}

export interface EnqueueTaskResponse {
  task: QueueTaskSummary;
}

export interface QueueHistoryResponse {
  history: QueueTaskSummary[];
}

export interface QueueModelsResponse {
  models: string[];
}

export interface QueuePauseMarkerResponse {
  markerId: string;
  afterIndex: number;
  durationHours?: 1 | 2 | 3 | 4 | 8;
}

export interface QueueMoveResponse {
  moved: boolean;
  position?: number;
}

export interface QueueTaskMutationResponse {
  task?: QueueTaskSummary;
  cancelled?: boolean;
  frozen?: boolean;
  unfrozen?: boolean;
  admitted?: boolean;
  unadmitted?: boolean;
  [key: string]: unknown;
}

export interface QueueSummarizeRequest {
  processIds: string[];
  workspaceId: string;
  userPrompt?: string;
  lensChat?: {
    inherited: true;
    source: 'features.commitChatLens';
  };
}

export interface QueueSummarizeResponse {
  taskId: string;
}
