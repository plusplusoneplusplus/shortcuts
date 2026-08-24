/**
 * Dispatch-time chat context for repo-group workspaces.
 *
 * When a chat targets a repo-group workspace, the dispatch path appends a
 * member listing (name + absolute local path only) to the outgoing prompt and
 * grants each live member's root path via `SendMessageOptions.additionalDirectories`
 * so autopilot can read/edit member repos without permission friction. Stale
 * members (workspace removed or path missing on disk) are silently skipped.
 *
 * The block rides the prompt sent to the SDK — it is never spliced into the
 * persisted user message. It is instead recorded verbatim on that user turn's
 * `repoGroupContext` field (see `persistRepoGroupContextOnUserTurn`) so the
 * chat can reveal what the model was told without polluting the transcript or
 * the history replayed back to the model on later turns.
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

/**
 * Record the injected block on the process's most recent user turn so the chat
 * UI can disclose it. Resolves the turn index from a fresh store read — the
 * user turn is written by the dispatch route (or the process-creation path)
 * before the executor computes the context, and cron/wakeup follow-ups append
 * theirs mid-execution.
 *
 * Best-effort and never throws: visibility must not be able to fail a turn.
 */
export async function persistRepoGroupContextOnUserTurn(
    store: ProcessStore,
    processId: string,
    context: RepoGroupChatContext | undefined,
): Promise<void> {
    if (!context) return;
    try {
        const process = await store.getProcess(processId);
        const turns = process?.conversationTurns ?? [];
        for (let i = turns.length - 1; i >= 0; i--) {
            if (turns[i].role === 'user') {
                await store.updateTurnRepoGroupContext?.(processId, i, context.promptBlock);
                return;
            }
        }
    } catch {
        // Ignore — the block still reaches the model either way.
    }
}

/** Append the context block to a prompt; identity when there is no context. */
export function appendRepoGroupContext(prompt: string, context: RepoGroupChatContext | undefined): string {
    return context ? `${prompt}\n\n${context.promptBlock}` : prompt;
}
