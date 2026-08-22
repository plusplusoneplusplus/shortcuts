/**
 * Dispatch-time chat context for repo-group workspaces.
 *
 * When a chat targets a repo-group workspace, the dispatch path appends a
 * member listing (name + absolute local path only) to the outgoing prompt and
 * grants each live member's root path via `SendMessageOptions.additionalDirectories`
 * so autopilot can read/edit member repos without permission friction. Stale
 * members (workspace removed or path missing on disk) are silently skipped.
 *
 * The block rides the prompt sent to the SDK — it is not persisted into the
 * conversation transcript.
 */

import * as os from 'os';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { tagBlock } from '../executors/prompt-tags';
import { isRepoGroupWorkspaceId, readRepoGroup, resolveRepoGroupMembers } from './repo-group-workspace';

/** Tag wrapping the appended member listing in the outgoing prompt. */
export const REPO_GROUP_CONTEXT_TAG = 'repo_group_context';

export interface RepoGroupChatContext {
    /** Tagged prompt section listing each live member's name and absolute path. */
    promptBlock: string;
    /** Live member root paths, in membership order. */
    additionalDirectories: string[];
}

/**
 * Resolve the chat context for a workspace. Returns `undefined` unless
 * `workspaceId` is a repo-group workspace with a readable membership file and
 * at least one live member — callers can spread/append unconditionally.
 */
export async function resolveRepoGroupChatContext(
    store: ProcessStore,
    dataDir: string | undefined,
    workspaceId: string | undefined,
): Promise<RepoGroupChatContext | undefined> {
    if (!workspaceId || !isRepoGroupWorkspaceId(workspaceId)) return undefined;
    const effectiveDataDir = dataDir ?? path.join(os.homedir(), '.coc');
    const group = readRepoGroup(effectiveDataDir, workspaceId);
    if (!group) return undefined;
    const live = (await resolveRepoGroupMembers(effectiveDataDir, store, workspaceId))
        .filter(m => !m.stale && typeof m.name === 'string' && typeof m.rootPath === 'string');
    if (live.length === 0) return undefined;
    const listing = live.map(m => `- ${m.name}: ${m.rootPath}`).join('\n');
    return {
        promptBlock: tagBlock(REPO_GROUP_CONTEXT_TAG, `Repo group "${group.name}" members:\n${listing}`),
        additionalDirectories: live.map(m => m.rootPath as string),
    };
}

/** Append the context block to a prompt; identity when there is no context. */
export function appendRepoGroupContext(prompt: string, context: RepoGroupChatContext | undefined): string {
    return context ? `${prompt}\n\n${context.promptBlock}` : prompt;
}
