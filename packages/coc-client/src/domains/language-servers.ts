import type {
  LanguageServerConfigRejection,
  LanguageServerConfigResponse,
  LanguageServerConfigUpdate,
} from '../contracts';
import { CocApiError } from '../errors';
import type { RequestAdapter } from '../types';
import { encodePathSegment } from '../url';

function configPath(workspaceId: string): string {
  return `/workspaces/${encodePathSegment(workspaceId)}/language-servers`;
}

/**
 * Workspace-scoped language-server configuration.
 *
 * Every call is addressed by workspace id, so the caller routes the request to
 * the host that owns the files rather than to whichever host is on screen.
 */
export class LanguageServersClient {
  constructor(private readonly transport: RequestAdapter) {}

  get(workspaceId: string): Promise<LanguageServerConfigResponse> {
    return this.transport.request<LanguageServerConfigResponse>(configPath(workspaceId));
  }

  /** Replace the config. Omitted fields fall back to the disabled default. */
  replace(workspaceId: string, config: LanguageServerConfigUpdate): Promise<LanguageServerConfigResponse> {
    return this.transport.request<LanguageServerConfigResponse>(configPath(workspaceId), {
      method: 'PUT',
      body: { ...config },
    });
  }

  /** Merge into the stored config. Omitted fields keep their stored values. */
  update(workspaceId: string, config: LanguageServerConfigUpdate): Promise<LanguageServerConfigResponse> {
    return this.transport.request<LanguageServerConfigResponse>(configPath(workspaceId), {
      method: 'PATCH',
      body: { ...config },
    });
  }
}

/**
 * Unpack a rejected write so a settings form can anchor messages on the
 * offending input and restore the last valid configuration.
 *
 * Returns `null` for anything that is not a field-level rejection — a network
 * failure, a 500, or a 400 without an `errors` array.
 */
export function parseLanguageServerRejection(error: unknown): LanguageServerConfigRejection | null {
  if (!(error instanceof CocApiError) || error.status !== 400) return null;
  const body = error.body;
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (!Array.isArray(record.errors)) return null;
  const errors = record.errors.filter(
    (entry): entry is { field: string; message: string } =>
      Boolean(entry)
      && typeof entry === 'object'
      && typeof (entry as { field?: unknown }).field === 'string'
      && typeof (entry as { message?: unknown }).message === 'string',
  ).map(({ field, message }) => ({ field, message }));
  const config = record.config;
  if (config && typeof config === 'object' && Array.isArray((config as { definitions?: unknown }).definitions)) {
    const stored = config as LanguageServerConfigRejection['config'];
    return { errors, config: { enabled: stored!.enabled === true, definitions: stored!.definitions } };
  }
  return { errors };
}
