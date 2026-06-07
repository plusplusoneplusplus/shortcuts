import type { ChatProvider, JsonObject, ReasoningEffort } from './common';

export type MapReduceChildMode = 'ask' | 'autopilot';

export type MapReduceRunStatus =
  | 'draft'
  | 'approved'
  | 'running'
  | 'reducing'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type MapReduceItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

export type MapReduceReduceStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type MapReduceProcessPhase = 'map' | 'reduce';

export interface MapReduceItem {
  id: string;
  title: string;
  prompt: string;
  dependsOn?: string[];
  metadata?: JsonObject;
  status: MapReduceItemStatus;
  childProcessId?: string;
  childTaskId?: string;
  output?: unknown;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface MapReduceReduceStep {
  status: MapReduceReduceStepStatus;
  childProcessId?: string;
  childTaskId?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface MapReduceRunMetadata {
  runId: string;
  workspaceId: string;
  status: MapReduceRunStatus;
  originalRequest: string;
  sharedInstructions?: string;
  reduceInstructions: string;
  maxParallel: number;
  childMode: MapReduceChildMode;
  provider?: ChatProvider;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  cancelledAt?: string;
  completedAt?: string;
  generationProcessId?: string;
  generationId?: string;
}

export interface MapReduceRun extends MapReduceRunMetadata {
  items: MapReduceItem[];
  reduceStep: MapReduceReduceStep;
}

export interface MapReduceRunSummary extends MapReduceRunMetadata {
  itemCount: number;
  itemStatusCounts: Record<MapReduceItemStatus, number>;
  reduceStatus: MapReduceReduceStepStatus;
}

export interface MapReduceAiConfig {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface GenerateMapReduceRunRequest {
  prompt: string;
  sharedInstructions?: string;
  childMode: MapReduceChildMode;
  provider?: ChatProvider;
  config?: MapReduceAiConfig;
}

export interface CreateMapReduceRunRequest {
  originalRequest: string;
  sharedInstructions?: string;
  reduceInstructions: string;
  maxParallel?: number;
  childMode: MapReduceChildMode;
  provider?: ChatProvider;
  config?: MapReduceAiConfig;
  generationProcessId?: string;
  generationId?: string;
  items: MapReduceItem[];
}

export interface UpdateMapReducePlanRequest {
  items: MapReduceItem[];
  sharedInstructions?: string;
  reduceInstructions?: string;
  maxParallel?: number;
  childMode?: MapReduceChildMode;
}

export interface ListMapReduceRunsResponse {
  runs: MapReduceRunSummary[];
}

export interface MapReduceRunResponse {
  run: MapReduceRun;
}

export interface MapReduceMapProcessContext {
  workspaceId: string;
  runId: string;
  phase: 'map';
  itemId: string;
  childMode: MapReduceChildMode;
}

export interface MapReduceReduceProcessContext {
  workspaceId: string;
  runId: string;
  phase: 'reduce';
  childMode: MapReduceChildMode;
}

export interface MapReduceGenerationLatestPlan {
  turnIndex: number;
  items: MapReduceItem[];
  childMode: MapReduceChildMode;
  sharedInstructions?: string;
  reduceInstructions: string;
  maxParallel: number;
  rawJson?: string;
  updatedAt?: string;
}

export interface MapReduceGenerationContext {
  kind: 'generation';
  workspaceId: string;
  generationId: string;
  childMode: MapReduceChildMode;
  originalRequest: string;
  status: 'draft' | 'approved';
  runId?: string;
  latestItemCount?: number;
  latestPlanTurnIndex?: number;
  latestPlan?: MapReduceGenerationLatestPlan;
  lastPlanError?: string;
  lastPlanErrorTurnIndex?: number;
}

export type MapReduceProcessContext = MapReduceMapProcessContext | MapReduceReduceProcessContext | MapReduceGenerationContext;

export const DEFAULT_MAP_REDUCE_MAX_PARALLEL = 3;
