import type { JsonObject } from './common';

export type AIProcessStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string | Date;
  turnIndex: number;
  [key: string]: unknown;
}

export interface AIProcess {
  id: string;
  type: string;
  promptPreview: string;
  fullPrompt?: string;
  status: AIProcessStatus | string;
  startTime: string | Date;
  endTime?: string | Date;
  error?: string;
  result?: string;
  metadata?: JsonObject;
  conversationTurns?: ConversationTurn[];
  title?: string;
  [key: string]: unknown;
}

export interface ProcessListQuery {
  workspace?: string;
  status?: AIProcessStatus | AIProcessStatus[] | string;
  type?: string;
  parentProcessId?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  exclude?: 'conversation' | 'toolCalls' | Array<'conversation' | 'toolCalls'>;
  sdkSessionId?: string;
  archived?: boolean;
  q?: string;
}

export interface ProcessListResponse {
  processes: AIProcess[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProcessSummariesResponse {
  summaries: JsonObject[];
  total: number;
  limit: number;
  offset: number;
}

export interface ProcessDetailResponse {
  process: AIProcess;
  children: AIProcess[];
  total: number;
}

export interface CreateProcessRequest extends Partial<AIProcess> {
  id: string;
  promptPreview: string;
  status: AIProcessStatus | string;
  startTime: string;
  workspaceId?: string;
}

export interface ProcessMessageRequest {
  content: string;
  mode?: 'ask' | 'plan' | 'autopilot';
  deliveryMode?: 'immediate' | 'enqueue' | 'steer';
  images?: string[];
  skillNames?: string[];
  model?: string;
  [key: string]: unknown;
}

export interface ProcessMessageResponse extends JsonObject {}

export interface ProcessOutputResponse {
  content: string;
  format: string;
}

export interface ProcessOutputQuery {
  workspace?: string;
  range?: string;
  offset?: number;
}
