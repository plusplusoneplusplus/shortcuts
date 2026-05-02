import type { JsonObject } from './common';

export type WorkItemStatus =
  | 'created'
  | 'planning'
  | 'readyToExecute'
  | 'executing'
  | 'aiDone'
  | 'done'
  | 'cancelled'
  | string;
export type WorkItemPriority = 'high' | 'normal' | 'low';
export type WorkItemSource = 'manual' | 'chat' | 'schedule';
export type WorkItemType = 'work-item' | 'bug';

export interface WorkItemPlan {
  version: number;
  content: string;
  updatedAt?: string;
  resolvedBy?: 'user' | 'ai' | string;
}

export interface WorkItemPlanVersion extends WorkItemPlan {
  createdAt?: string;
  summary?: string;
}

export interface WorkItem {
  id: string;
  repoId: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  type?: WorkItemType;
  createdAt: string;
  updatedAt: string;
  source?: WorkItemSource;
  sourceId?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  autoExecute?: boolean;
  plan?: WorkItemPlan;
  [key: string]: unknown;
}

export interface WorkItemFilter {
  status?: WorkItemStatus | WorkItemStatus[];
  source?: WorkItemSource;
  priority?: WorkItemPriority;
  tags?: string[];
  type?: WorkItemType;
  q?: string;
  offset?: number;
  limit?: number;
}

export interface WorkItemListResponse {
  items: WorkItem[];
  total: number;
  hasMore: boolean;
}

export interface WorkItemGroupedResponse {
  groups: Record<string, { items: WorkItem[]; total: number; hasMore: boolean }>;
}

export interface CreateWorkItemRequest {
  id?: string;
  title: string;
  description?: string;
  type?: WorkItemType;
  source?: WorkItemSource;
  sourceId?: string;
  priority?: WorkItemPriority;
  tags?: string[];
  autoExecute?: boolean;
  plan?: { content: string; resolvedBy?: string };
}

export interface UpdateWorkItemRequest extends Partial<Pick<WorkItem, 'title' | 'description' | 'status' | 'priority' | 'tags' | 'autoExecute'>> {
  completedAt?: string;
  reviewComments?: unknown[];
}

export interface ExecuteWorkItemRequest extends JsonObject {
  model?: string;
  mode?: string;
  skillNames?: string[];
}
