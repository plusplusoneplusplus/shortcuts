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

export type RalphGrillDepth = 'light' | 'standard' | 'deep';
export type RalphGrillAgentRole =
  | 'product'
  | 'ux'
  | 'architecture-system'
  | 'interaction'
  | 'failure-edge-cases'
  | 'quality-test'
  | 'deduplication'
  | 'provenance';
export type RalphGrillAgentProvider = 'copilot' | 'codex' | 'claude';
export type RalphGrillEffortTier = 'very-low' | 'low' | 'medium' | 'high';

export interface RalphGrillAgentModelSelection {
  role: RalphGrillAgentRole;
  provider?: RalphGrillAgentProvider;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  effortTier?: RalphGrillEffortTier;
}

export interface RalphGrillSetup {
  enabled?: boolean;
  depth?: RalphGrillDepth;
  agents?: RalphGrillAgentModelSelection[];
}

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

/**
 * Group-pin type. Open union: the known literals are the legacy pin type
 * names; any registered task-group type pins under its own type string.
 */
export type ProcessGroupPinType = 'ralph-session' | 'for-each-run' | 'map-reduce-run' | (string & {});

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

/**
 * Response from `POST /processes/:id/prewarm`.
 *
 * `warming` is `true` when the provider client was warmed (or was already
 * warm/warming); `false` when prewarm was a no-op — e.g. the provider cannot
 * stay warm (Claude) or a warm-start failed. `reason` is populated only when
 * `warming` is `false`. Prewarm is best-effort, so a `false` result is never an
 * error the caller must handle.
 */
export interface ProcessPrewarmResponse {
  warming: boolean;
  /** Conversation provider that was (or would have been) warmed. */
  provider: string;
  /** Why warming was skipped, when `warming` is `false`. */
  reason?: 'unsupported' | 'error';
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
