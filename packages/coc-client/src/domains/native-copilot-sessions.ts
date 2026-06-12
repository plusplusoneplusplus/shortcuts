import type {
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
  };
}

/**
 * Read-only client for native GitHub Copilot CLI sessions. The server exposes
 * list and detail reads only; there are no mutation endpoints for this domain.
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
}
