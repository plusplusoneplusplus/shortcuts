import { CocApiError, type PerRepoPreferences } from '@plusplusoneplusplus/coc-client';
import type { NotesGitConfig } from '../../../../notes-git-types';
import { translateSpaCocClientError } from '../../api/cocClient';
import { getCocClientForWorkspace } from '../../repos/cloneRegistry';
import { getRepoPreferences, patchRepoPreferences } from '../../api/repoPreferences';

/**
 * Client-side subset of PerRepoPreferences (server: preferences-handler.ts).
 * Only the fields consumed by the preferences context are listed here;
 * expand as needed.
 */
export interface PerRepoPrefsClient extends PerRepoPreferences {
  /** Preferred file-list display mode across all git views. */
  filesViewMode?: 'flat' | 'tree';
  /** Notes directory git tracking settings. */
  notesGit?: NotesGitConfig;
  /** Per-repo activity filter selections (status and type filters). */
  activityFilters?: {
    statusFilter?: string;
    typeFilter?: string;
  };
  /** Per-mode last-used AI model names. */
  lastModels?: {
    task?: string;
    ask?: string;
    plan?: string;
    note?: string;
  };
}

/**
 * GET /api/workspaces/:wsId/preferences
 * Throws an Error if the response is not ok (non-2xx).
 */
export async function getWorkspacePreferences(wsId: string): Promise<PerRepoPrefsClient> {
  try {
    return await getRepoPreferences(getCocClientForWorkspace(wsId), wsId) as PerRepoPrefsClient;
  } catch (error) {
    if (error instanceof CocApiError) {
      throw new Error(`Failed to load preferences: ${error.status} ${error.statusText}`);
    }
    translateSpaCocClientError(error);
  }
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
  try {
    await patchRepoPreferences(getCocClientForWorkspace(wsId), wsId, partial);
  } catch (error) {
    if (error instanceof CocApiError) {
      throw new Error(`Failed to patch preferences: ${error.status} ${error.statusText}`);
    }
    translateSpaCocClientError(error);
  }
}
