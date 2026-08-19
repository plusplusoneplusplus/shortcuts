/**
 * Native GitHub Copilot CLI session contracts.
 *
 * Read-only, workspace-scoped views over the CoC server user's native
 * Copilot CLI session store (`~/.copilot/session-store.db`). These sessions
 * are external data: CoC never modifies them and never imports them into
 * CoC process history.
 */

/** Reason a native-session response carries no data. */
export type NativeCopilotSessionsUnavailableReason = 'feature-disabled' | 'db-missing' | 'db-invalid';

export interface NativeCopilotSessionListItem {
  id: string;
  repository: string | null;
  cwd: string | null;
  hostType: string | null;
  branch: string | null;
  summaryPreview: string;
  createdAt: string | null;
  updatedAt: string | null;
  turnCount: number;
  matchSnippets: string[];
}

export interface NativeCopilotSessionTurn {
  id: number;
  turnIndex: number;
  timestamp: string | null;
  userMessage: string;
  assistantResponse: string;
  userChars: number;
  assistantChars: number;
  searchIndexSourceId: string | null;
  searchIndexChars: number | null;
}

/**
 * One reconstructed tool call inside a {@link ReconstructedConversationTurn}.
 * Mirrors the SPA-side `ClientToolCall` so the dashboard chat components
 * (`ConversationArea` / `ConversationTurnBubble`) render it without a fork.
 */
export interface ReconstructedToolCall {
  id: string;
  toolName: string;
  /** Raw tool arguments object as recorded by the native CLI. */
  args: unknown;
  /** Tool result text (full `detailedContent`, else short `content`) when it succeeded. */
  result?: string;
  /** Error message when the tool call failed. */
  error?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime?: string;
  endTime?: string;
}

/**
 * One timeline event inside a {@link ReconstructedConversationTurn}, mirroring
 * the SPA-side `ClientTimelineItem` so the chat bubble can interleave assistant
 * text and tool cards in chronological order.
 */
export interface ReconstructedTimelineItem {
  type: 'content' | 'tool-start' | 'tool-complete' | 'tool-failed';
  timestamp: string;
  content?: string;
  toolCall?: ReconstructedToolCall;
}

/**
 * A single reconstructed conversation turn, mirroring the subset of the
 * SPA-side `ClientConversationTurn` that the read-only native-session detail
 * view populates. Built either from the rich `session-state/<id>/events.jsonl`
 * log or, as a fallback, from the flat `session-store.db` turns.
 */
export interface ReconstructedConversationTurn {
  role: 'user' | 'assistant';
  /** Primary markdown content of the turn. */
  content: string;
  timestamp?: string;
  turnIndex?: number;
  toolCalls?: ReconstructedToolCall[];
  timeline: ReconstructedTimelineItem[];
  /** Base64 data-URL strings for images attached to or produced in this turn. */
  images?: string[];
  /** Readable model reasoning/thinking for an assistant turn. */
  thinking?: string;
  /** Skills invoked during this turn. */
  skillNames?: string[];
  /** Model that produced an assistant turn (e.g. `gpt-5.5`, `claude-opus-4.8`). */
  model?: string;
  /** True when an assistant turn ended in an error. */
  isError?: boolean;
}

export interface NativeCopilotSessionDetail {
  id: string;
  repository: string | null;
  cwd: string | null;
  hostType: string | null;
  branch: string | null;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  turns: NativeCopilotSessionTurn[];
  /**
   * Reconstructed chat transcript for rich rendering: parser output from the
   * native `session-state/<id>/events.jsonl` log when available, else text-only
   * turns mapped from the flat `turns` above. Always present (possibly empty).
   */
  conversation: ReconstructedConversationTurn[];
}

export interface ListNativeCopilotSessionsOptions {
  /** Free-text query against natively indexed content. */
  q?: string;
  /** Exact or partial session ID. */
  sessionId?: string;
  /** Exact branch filter. */
  branch?: string;
  /** ISO timestamp lower bound on updated time (inclusive). */
  from?: string;
  /** ISO timestamp upper bound on updated time (inclusive). */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ListNativeCopilotSessionsResponse {
  enabled: boolean;
  /** Present when `enabled` is true; false when the native DB is missing/invalid. */
  available?: boolean;
  reason?: NativeCopilotSessionsUnavailableReason;
  items: NativeCopilotSessionListItem[];
  total: number;
  /** False when metadata tables exist but the native search index is absent. */
  searchIndexAvailable?: boolean;
  /** Count of native sessions hidden because they are already tracked as CoC processes (Activity tab). */
  deduplicatedCount?: number;
  /** Count of native sessions hidden because they are background jobs (e.g. title summarization). */
  backgroundJobCount?: number;
  limit: number;
  offset: number;
}

export interface NativeCopilotSessionDetailResponse {
  enabled: boolean;
  available?: boolean;
  reason?: NativeCopilotSessionsUnavailableReason;
  session?: NativeCopilotSessionDetail;
}

/**
 * Every native CLI session provider CoC knows about.
 *
 * Membership here does NOT mean the provider is servable — that is decided by
 * the descriptor's {@link NativeCliProviderDescriptor.status} in
 * {@link NATIVE_CLI_PROVIDER_DESCRIPTORS}, which is the single gate shared by
 * the server registry, the route parser, and the dashboard tab list.
 */
export type NativeCliSessionProviderId = 'copilot' | 'codex' | 'claude' | 'opencode';

/**
 * How a provider answers a free-text query.
 *
 * - `native-index`: the CLI's own store has a text index (Copilot's SQLite FTS).
 * - `on-demand-scan`: CoC substring-scans candidate transcripts per request.
 * - `unavailable`: the provider cannot serve text search at all.
 */
export type NativeCliSessionSearchStrategy = 'native-index' | 'on-demand-scan' | 'unavailable';

/** Whether a provider can currently be served. */
export type NativeCliProviderStatus = 'available' | 'planned';

/**
 * The authoritative description of one native CLI session provider.
 *
 * This is the only place provider identity, display copy, store location, and
 * search semantics are declared. The server builds its provider registry from
 * these descriptors and the dashboard builds its tab list from them, so a
 * provider can never be half-wired into one surface but not the other.
 */
export interface NativeCliProviderDescriptor {
  id: NativeCliSessionProviderId;
  /** Short tab/badge label, e.g. `Codex`. */
  label: string;
  /** Sentence-form label for the read-only external-record notice. */
  externalLabel: string;
  /** Human-readable default store location, shown when no concrete path is known. */
  storeHint: string;
  searchStrategy: NativeCliSessionSearchStrategy;
  status: NativeCliProviderStatus;
  /** Why a `planned` provider is not servable yet. Omitted when `available`. */
  plannedNote?: string;
}

export const NATIVE_CLI_PROVIDER_DESCRIPTORS: readonly NativeCliProviderDescriptor[] = [
  {
    id: 'copilot',
    label: 'Copilot',
    externalLabel: 'Native Copilot CLI session',
    storeHint: '~/.copilot/session-store.db',
    searchStrategy: 'native-index',
    status: 'available',
  },
  {
    id: 'codex',
    label: 'Codex',
    externalLabel: 'Native Codex CLI session',
    storeHint: '~/.codex/sessions',
    searchStrategy: 'on-demand-scan',
    status: 'available',
  },
  {
    id: 'claude',
    label: 'Claude',
    externalLabel: 'Native Claude Code session',
    storeHint: '~/.claude/projects',
    searchStrategy: 'on-demand-scan',
    status: 'available',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    externalLabel: 'Native OpenCode CLI session',
    storeHint: '~/.opencode',
    searchStrategy: 'unavailable',
    status: 'planned',
    plannedNote: 'CoC cannot read the OpenCode CLI session store yet.',
  },
];

export const NATIVE_CLI_PROVIDER_IDS: readonly NativeCliSessionProviderId[] =
  NATIVE_CLI_PROVIDER_DESCRIPTORS.map(descriptor => descriptor.id);

/** Descriptors the server can actually serve and the dashboard should offer. */
export const AVAILABLE_NATIVE_CLI_PROVIDER_DESCRIPTORS: readonly NativeCliProviderDescriptor[] =
  NATIVE_CLI_PROVIDER_DESCRIPTORS.filter(descriptor => descriptor.status === 'available');

export function isNativeCliSessionProviderId(value: unknown): value is NativeCliSessionProviderId {
  return typeof value === 'string'
    && NATIVE_CLI_PROVIDER_IDS.includes(value as NativeCliSessionProviderId);
}

export function getNativeCliProviderDescriptor(
  id: NativeCliSessionProviderId,
): NativeCliProviderDescriptor {
  const descriptor = NATIVE_CLI_PROVIDER_DESCRIPTORS.find(candidate => candidate.id === id);
  if (!descriptor) {
    throw new Error(`Unknown native CLI session provider: ${id}`);
  }
  return descriptor;
}

/** True when the provider is declared servable by the shared registry. */
export function isNativeCliProviderAvailable(id: NativeCliSessionProviderId): boolean {
  return getNativeCliProviderDescriptor(id).status === 'available';
}
export type NativeCliSessionsUnavailableReason = 'feature-disabled' | 'store-missing' | 'store-invalid';

export interface NativeCliSessionListItem extends NativeCopilotSessionListItem {
  provider: NativeCliSessionProviderId;
  storePath: string;
  searchIndexAvailable: boolean;
}

export interface NativeCliSessionDetail extends NativeCopilotSessionDetail {
  provider: NativeCliSessionProviderId;
  storePath: string;
  searchIndexAvailable: boolean;
}

export interface ListNativeCliSessionsOptions extends ListNativeCopilotSessionsOptions {
  provider: NativeCliSessionProviderId;
}

export interface ListNativeCliSessionsResponse {
  enabled: boolean;
  available?: boolean;
  reason?: NativeCliSessionsUnavailableReason;
  provider?: NativeCliSessionProviderId;
  /** How the responding provider answered (or would answer) a text query. */
  searchStrategy?: NativeCliSessionSearchStrategy;
  items: NativeCliSessionListItem[];
  total: number;
  searchIndexAvailable?: boolean;
  deduplicatedCount?: number;
  backgroundJobCount?: number;
  limit: number;
  offset: number;
}

export interface NativeCliSessionDetailResponse {
  enabled: boolean;
  available?: boolean;
  reason?: NativeCliSessionsUnavailableReason;
  provider?: NativeCliSessionProviderId;
  searchStrategy?: NativeCliSessionSearchStrategy;
  session?: NativeCliSessionDetail;
}
