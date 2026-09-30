/**
 * recordPullRequestBinding — writes the chat ↔ PR binding for a process that
 * just created (or found) a pull request through the shared create-PR service.
 *
 * Every PR path that links a chat to a PR goes through here: the
 * `create_pull_request` LLM tool, and the server-side submit flows. The row is
 * keyed by the chat's canonical origin and the *bare* task id, the same shape
 * the dashboard reads.
 */

import type { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { isQueueProcessId, toTaskId, type WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { resolveWorkspaceOriginId } from '../repos/origin-scope';
import { PullRequestChatBindingStore } from './pull-request-chat-binding-store';

/**
 * The binding table is keyed by the *bare* task id — that is what the dashboard
 * writes and reads (`isQueueProcessId(taskId) ? toTaskId(taskId) : taskId`) and
 * what every existing row holds. Writing the `queue_`-prefixed process id would
 * produce rows the client never finds.
 */
export function bareTaskIdForProcess(processId: string): string {
    return isQueueProcessId(processId) ? toTaskId(processId) : processId;
}

/** The slice of `ProcessStore` needed to write a binding. */
export interface PrBindingWriterStore {
    getDatabase?(): NativeDatabase;
    getWorkspaces(): Promise<WorkspaceInfo[]>;
    updateWorkspace?(id: string, updates: Partial<Omit<WorkspaceInfo, 'id'>>): Promise<WorkspaceInfo | undefined>;
}

export interface RecordPullRequestBindingResult {
    originId: string;
    prId: string;
    taskId: string;
}

/**
 * Upsert the binding `prId → processId` under the workspace's canonical origin.
 *
 * Returns undefined (without throwing) when the store has no database or the
 * workspace is not registered — a PR that was created must never be reported
 * as a failure because its chat link could not be written.
 */
export async function recordPullRequestBinding(
    store: PrBindingWriterStore,
    workspaceId: string,
    processId: string,
    prId: string | number,
): Promise<RecordPullRequestBindingResult | undefined> {
    const db = store.getDatabase?.();
    if (!db) return undefined;
    const workspace = (await store.getWorkspaces()).find(ws => ws.id === workspaceId);
    if (!workspace) return undefined;

    const originId = await resolveWorkspaceOriginId(
        { id: workspace.id, remoteUrl: workspace.remoteUrl, rootPath: workspace.rootPath },
        store,
    );
    const taskId = bareTaskIdForProcess(processId);
    const id = String(prId);
    new PullRequestChatBindingStore(db).bind(originId, id, taskId);
    return { originId, prId: id, taskId };
}
