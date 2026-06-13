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
