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
  customTitle?: string;
  lastMessagePreview?: string;
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
  include?: 'children' | Array<'children'>;
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

export interface ProcessSearchResult {
  processId: string;
  turnIndex: number;
  role: string;
  snippet: string;
  rank: number;
  processTitle?: string;
  promptPreview: string;
  processStatus: string;
  processType: string;
  workspaceId: string;
  startTime: string;
}

export interface ProcessSearchQuery {
  q: string;
  workspace?: string;
  status?: AIProcessStatus | AIProcessStatus[] | string;
  type?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface ProcessSearchResponse {
  results: ProcessSearchResult[];
  total: number;
  query: string;
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
  mode?: 'ask' | 'autopilot';
  deliveryMode?: 'immediate' | 'enqueue' | 'steer';
  images?: string[];
  skillNames?: string[];
  model?: string;
  /**
   * Optional per-turn reasoning-effort override. One of
   * `'low' | 'medium' | 'high' | 'xhigh'`. When omitted, the executor
   * falls back to the per-model persisted preference, then the SDK
   * default. Sent as `body.reasoningEffort` to `POST /api/processes/:id/message`.
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  [key: string]: unknown;
}

export interface ProcessMessageResponse extends JsonObject {}

export interface PendingProcessMessage {
  id: string;
  content: string;
  displayContent?: string;
  mode?: 'ask' | 'autopilot' | string;
  model?: string;
  /**
   * Optional per-turn reasoning-effort override captured at message-buffer
   * time, replayed when the message is drained as a follow-up.
   */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  images?: string[];
  pasteExternalized?: boolean;
  attachments?: unknown[];
  imageTempDir?: string;
  fileAttachmentMeta?: Array<{
    name: string;
    mimeType: string;
    size: number;
    category: 'image' | 'text' | 'binary';
  }>;
  skillNames?: string[];
  createdAt: string;
}

export interface CreatePendingProcessMessageResponse {
  message: PendingProcessMessage;
}

export interface TurnDeleteResponse {
  id: string;
  turnIndex: number;
  deletedAt: string | null;
}

export interface TurnPinResponse {
  id: string;
  turnIndex: number;
  pinnedAt: string | null;
  archived?: boolean;
}

export interface TurnArchiveResponse {
  id: string;
  turnIndex: number;
  archived: boolean;
}

export interface PinnedTurnsResponse {
  turns: ConversationTurn[];
}

export type ProcessGroupPinType = 'ralph-session' | 'for-each-run' | 'map-reduce-run';

export interface ProcessGroupPin {
  type: ProcessGroupPinType;
  groupId: string;
  pinnedAt: string;
}

export interface ProcessGroupPinsResponse {
  pins: ProcessGroupPin[];
}

export interface ProcessGroupPinResponse {
  pin: ProcessGroupPin | null;
}

export interface ProcessForkResponse {
  process: AIProcess;
}

export interface PromoteToRalphResult {
  promoted: true;
  /** Queue-prefixed ID of the promoted process (now grilling-phase). */
  processId: string;
  /** Newly minted Ralph session ID grouping the promoted process. */
  sessionId: string;
  /** Queue-prefixed ID of the enqueued synthesis follow-up turn. */
  synthesisTaskId: string;
}

export interface ProcessResumeCliResponse extends JsonObject {
  launched?: boolean;
  command?: string;
}

export interface ProcessOutputResponse {
  content: string;
  format: string;
}

export interface ProcessOutputQuery {
  workspace?: string;
  range?: string;
  offset?: number;
}

export interface AskUserResponseRequest {
  batchId: string;
  answers: Array<{
    questionId: string;
    answer?: string | string[] | boolean;
    skipped?: boolean;
    deferred?: boolean;
    reason?: 'needs-context';
    note?: string;
  }>;
}

export interface AskUserResponseResponse {
  ok: boolean;
}
