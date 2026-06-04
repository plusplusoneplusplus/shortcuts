import type { ChatProvider, JsonObject, ReasoningEffort } from './common';

export type ForEachChildMode = 'ask' | 'autopilot';

export type ForEachRunStatus =
  | 'draft'
  | 'approved'
  | 'running'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type ForEachItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ForEachItem {
  id: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
  metadata?: JsonObject;
  status: ForEachItemStatus;
  childProcessId?: string;
  childTaskId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ForEachRunMetadata {
  runId: string;
  workspaceId: string;
  status: ForEachRunStatus;
  originalRequest: string;
  sharedInstructions?: string;
  childMode: ForEachChildMode;
  provider?: ChatProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
}

export interface ForEachRun extends ForEachRunMetadata {
  items: ForEachItem[];
}

export interface ForEachRunSummary extends ForEachRunMetadata {
  itemCount: number;
  itemStatusCounts: Record<ForEachItemStatus, number>;
}

export interface ForEachAiConfig {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface GenerateForEachRunRequest {
  prompt: string;
  sharedInstructions?: string;
  childMode: ForEachChildMode;
  provider?: ChatProvider;
  config?: ForEachAiConfig;
}

export interface UpdateForEachPlanRequest {
  items: ForEachItem[];
  sharedInstructions?: string;
  childMode?: ForEachChildMode;
}

export interface ListForEachRunsResponse {
  runs: ForEachRunSummary[];
}

export interface ForEachRunResponse {
  run: ForEachRun;
}
