import type {
  ListNativeCliSessionsOptions,
  ListNativeCliSessionsResponse,
  NativeCliSessionDetailResponse,
  NativeCliSessionProviderId,
} from '../contracts';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function sessionsPath(workspaceId: string, suffix = ''): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/native-cli-sessions${suffix}`;
}

function listQuery(options: ListNativeCliSessionsOptions): Record<string, string | number | undefined> {
  return {
    provider: options.provider,
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
 * Read-only client for native Copilot, Codex, and Claude Code CLI sessions.
 * The server exposes list and detail reads only; there are no mutation endpoints.
 */
export class NativeCliSessionsClient {
  constructor(private readonly transport: RequestAdapter) {}

  list(workspaceId: string, options: ListNativeCliSessionsOptions): Promise<ListNativeCliSessionsResponse> {
    return this.transport.request<ListNativeCliSessionsResponse>(
      sessionsPath(workspaceId),
      { query: listQuery(options) },
    );
  }

  get(
    workspaceId: string,
    sessionId: string,
    provider: NativeCliSessionProviderId,
  ): Promise<NativeCliSessionDetailResponse> {
    return this.transport.request<NativeCliSessionDetailResponse>(
      sessionsPath(workspaceId, `/${encodePathSegment(sessionId)}`),
      { query: { provider } },
    );
  }
}
