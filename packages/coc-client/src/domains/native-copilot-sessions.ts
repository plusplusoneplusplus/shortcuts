import type {
  ImportNativeCopilotSessionResponse,
  ListNativeCopilotSessionsOptions,
  ListNativeCopilotSessionsResponse,
  NativeCopilotSessionDetailResponse,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function sessionsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/native-copilot-sessions${suffix}`;
}

function listQuery(options: ListNativeCopilotSessionsOptions | undefined): Record<string, string | number | undefined> | undefined {
  if (!options) return undefined;
  return {
    q: options.q,
    sessionId: options.sessionId,
    branch: options.branch,
    from: options.from,
    to: options.to,
    limit: options.limit,
    offset: options.offset,
    scope: options.scope,
  };
}

/**
 * Client for native GitHub Copilot CLI sessions: list/detail reads plus the
 * explicit import action that snapshots a session into a workspace chat.
 * Native data itself is never modified.
 */
export class NativeCopilotSessionsClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(workspaceId: string, options?: ListNativeCopilotSessionsOptions): Promise<ListNativeCopilotSessionsResponse> {
    const query = listQuery(options);
    return this.transport.request<ListNativeCopilotSessionsResponse>(
      sessionsPath(workspaceId),
      query ? { query } : undefined,
    );
  }

  get(workspaceId: string, sessionId: string): Promise<NativeCopilotSessionDetailResponse> {
    return this.transport.request<NativeCopilotSessionDetailResponse>(
      sessionsPath(workspaceId, `/${encodePathSegment(sessionId)}`),
    );
  }

  /** Import a native session into `workspaceId`'s chat list (idempotent per workspace). */
  import(workspaceId: string, sessionId: string): Promise<ImportNativeCopilotSessionResponse> {
    return this.transport.request<ImportNativeCopilotSessionResponse>(
      sessionsPath(workspaceId, `/${encodePathSegment(sessionId)}/import`),
      { method: 'POST' },
    );
  }
}
