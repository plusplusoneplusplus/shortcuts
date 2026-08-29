/**
 * bindDetectedPullRequestsForProcess — server-side backstop that records the
 * pull request a chat created once that chat finishes.
 *
 * The dashboard detects a PR in the loaded turns and POSTs a binding, but that
 * only happens while a human has the chat open. A chat that runs as a queued
 * background task, opens a PR, and is never opened stays unbound forever. This
 * pass runs the *same* detector over the finished conversation and upserts the
 * binding, so the association exists regardless of who was watching.
 *
 * Deliberately best-effort: every failure is swallowed and logged at debug. A
 * task must never fail because its PR could not be recorded.
 *
 * Pure Node.js; cross-platform (Linux/macOS/Windows).
 */

import type Database from 'better-sqlite3';
import {
    getLogger,
    isQueueProcessId,
    LogCategory,
    resolveCanonicalOriginId,
    toTaskId,
    type ConversationTurn,
    type WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import {
    collectToolCallsFromTurns,
    detectPullRequestsInToolGroup,
    syntheticRemoteUrlForDetectedPr,
} from '@plusplusoneplusplus/forge/git/pull-request-detection';
import { resolveWorkspaceRemoteUrl, resolveWorkspaceOriginId } from '../repos/origin-scope';
import { PullRequestChatBindingStore } from './pull-request-chat-binding-store';

const logger = getLogger();

/**
 * The slice of `ProcessStore` this pass needs. `getDatabase` and
 * `getConversationTurns` are optional because not every implementation has them
 * (`FileProcessStore` has neither); an absent method is a clean no-op.
 */
export interface PrBindingProcessStore {
    getDatabase?(): Database.Database;
    getConversationTurns?(processId: string): Promise<ConversationTurn[]>;
    getWorkspaces(): Promise<WorkspaceInfo[]>;
    updateWorkspace?(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<WorkspaceInfo | undefined>;
}

/**
 * The binding table is keyed by the *bare* task id — that is what the dashboard
 * writes and reads (`isQueueProcessId(taskId) ? toTaskId(taskId) : taskId`) and
 * what every existing row holds. Writing the `queue_`-prefixed process id would
 * produce rows the client never finds.
 */
export function bareTaskIdForProcess(processId: string): string {
    return isQueueProcessId(processId) ? toTaskId(processId) : processId;
}

/**
 * Detects the pull requests created in `processId`'s conversation and upserts a
 * binding for each one that belongs to the chat's own repo.
 *
 * Idempotent: `bind()` is an `INSERT OR REPLACE`, so re-running after a
 * follow-up turn rewrites the same row rather than adding one.
 *
 * @returns the PR ids bound (empty when nothing was detected or the pass bailed).
 */
export async function bindDetectedPullRequestsForProcess(
    store: PrBindingProcessStore,
    processId: string,
    workspaceId: string | undefined,
): Promise<string[]> {
    try {
        if (!workspaceId) return [];

        const db = store.getDatabase?.();
        if (!db) return [];

        const turns = await store.getConversationTurns?.(processId);
        if (!turns || turns.length === 0) return [];

        const toolCalls = collectToolCallsFromTurns(turns);
        if (toolCalls.length === 0) return [];

        const workspace = (await store.getWorkspaces()).find(ws => ws.id === workspaceId);
        if (!workspace) return [];

        // The server always has the workspace record, so it can always scope
        // detection to the chat's own repo — unlike the client, whose scoping
        // depends on the workspace list having loaded.
        const remoteUrl = await resolveWorkspaceRemoteUrl(workspace, store);
        const detected = detectPullRequestsInToolGroup(toolCalls, { remoteUrl });
        if (detected.length === 0) return [];

        const chatOriginId = await resolveWorkspaceOriginId({ id: workspace.id, remoteUrl, rootPath: workspace.rootPath });
        const taskId = bareTaskIdForProcess(processId);
        const bindingStore = new PullRequestChatBindingStore(db);

        const bound: string[] = [];
        for (const pr of detected) {
            const prRemoteUrl = syntheticRemoteUrlForDetectedPr(pr);
            if (!prRemoteUrl) continue;
            // A PR in another repo is not this chat's PR. The detector's own
            // repo scoping already drops these; this is the second guard that
            // matches the client's `unionAssociations`.
            const prOriginId = resolveCanonicalOriginId({ workspaceId, remoteUrl: prRemoteUrl });
            if (prOriginId !== chatOriginId) continue;

            const prId = String(pr.number);
            if (bound.includes(prId)) continue;
            bindingStore.bind(chatOriginId, prId, taskId);
            bound.push(prId);
        }

        if (bound.length > 0) {
            logger.debug(
                LogCategory.AI,
                `[PrChatBinding] Bound PR(s) ${bound.join(', ')} to ${taskId} under ${chatOriginId}`,
            );
        }
        return bound;
    } catch (err) {
        logger.debug(
            LogCategory.AI,
            `[PrChatBinding] Skipped PR binding for ${processId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
    }
}
