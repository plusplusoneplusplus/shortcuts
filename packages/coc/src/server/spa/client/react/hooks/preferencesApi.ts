import { getApiBase } from '../utils/config';

/**
 * Client-side subset of PerRepoPreferences (server: preferences-handler.ts).
 * Only the fields consumed by the preferences context are listed here;
 * expand as needed.
 */
export interface PerRepoPrefsClient {
  /** Preferred file-list display mode across all git views. */
  filesViewMode?: 'flat' | 'tree';
  /** Repo-scoped bounded memory controls used by the Memory settings panel. */
  boundedMemory?: {
    enabled?: boolean;
    charLimit?: number;
  };
}

/**
 * GET /api/workspaces/:wsId/preferences
 * Throws an Error if the response is not ok (non-2xx).
 */
export async function getWorkspacePreferences(wsId: string): Promise<PerRepoPrefsClient> {
  const url = getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/preferences';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load preferences: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<PerRepoPrefsClient>;
}

/**
 * PATCH /api/workspaces/:wsId/preferences
 * Merges `partial` into the stored preferences on the server.
 * Fire-and-forget callers should handle (or ignore) the returned Promise.
 */
export async function patchWorkspacePreferences(
  wsId: string,
  partial: Partial<PerRepoPrefsClient>
): Promise<void> {
  const url = getApiBase() + '/workspaces/' + encodeURIComponent(wsId) + '/preferences';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
  if (!res.ok) {
    throw new Error(`Failed to patch preferences: ${res.status} ${res.statusText}`);
  }
}
