import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { PullRequestChatBindingStore } from '../processes/pull-request-chat-binding-store';
import { bareTaskIdForProcess } from '../processes/record-pull-request-binding';

/** Authorizes repair delivery only to the PR-bound chat on its owning server. */
export function createPrRepairOwnerValidator(
    store: ProcessStore,
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>,
) {
    return async (workspaceId: string, processId: string, originId: string, prId: string): Promise<void> => {
        if (await resolveWorkspaceId(processId) !== workspaceId) {
            throw new Error('PR repair owner workspace is missing or changed');
        }
        const db = store instanceof SqliteProcessStore ? store.getDatabase() : undefined;
        if (!db) throw new Error('PR repair binding database is unavailable');
        const binding = new PullRequestChatBindingStore(db).get(originId, prId);
        if (!binding || binding.taskId !== bareTaskIdForProcess(processId)) {
            throw new Error('PR repair must target the existing PR-bound owner conversation');
        }
    };
}
