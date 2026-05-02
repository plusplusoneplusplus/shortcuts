import type { JsonObject } from './common';
import type { QueueHistoryResponse, TaskPriority } from './queue';

export interface WorkflowDefinition {
  name: string;
  path: string;
  description?: string;
  isValid?: boolean;
  validationErrors?: string[];
}

export interface WorkflowSummaryResponse {
  workflows: WorkflowDefinition[];
  tasks?: unknown;
  [key: string]: unknown;
}

export interface WorkflowListOptions {
  folder?: string;
  showArchived?: boolean;
}

export interface WorkflowPathOptions {
  folder?: string;
}

export interface WorkflowContentResponse {
  content: string;
  path: string;
}

export interface SaveWorkflowContentResponse {
  path: string;
}

export interface CreateWorkflowRequest {
  name: string;
  template?: string;
  content?: string;
}

export interface CreateWorkflowResponse {
  name: string;
  path: string;
  template: string;
}

export interface DeleteWorkflowResponse {
  deleted: string;
}

export interface GenerateWorkflowRequest {
  description: string;
  name?: string;
  model?: string;
}

export interface GenerateWorkflowResponse {
  yaml: string;
  raw?: string;
  valid: boolean;
  validationError?: string;
  suggestedName?: string;
}

export interface RefineWorkflowRequest {
  instruction: string;
  currentYaml: string;
  model?: string;
}

export type RefineWorkflowResponse = GenerateWorkflowResponse;

export interface RunWorkflowRequest {
  model?: string;
  params?: JsonObject;
  priority?: TaskPriority;
}

export interface RunWorkflowResponse {
  taskId: string;
  pipelineName: string;
  queuedAt: number;
}

export interface WorkflowRunHistoryOptions {
  limit?: number;
}

export type WorkflowRunHistoryResponse = QueueHistoryResponse;
