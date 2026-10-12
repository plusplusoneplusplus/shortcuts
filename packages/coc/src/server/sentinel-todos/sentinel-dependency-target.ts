import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import { SentinelTodoError } from './sentinel-todo-store';

/** Registered workspaces may have no queue until their first use. No task is admitted here. */
export function createSentinelDependencyTargetValidator(
    store: Pick<ProcessStore, 'getWorkspaces'>,
    bridge: Pick<MultiRepoQueueRouter, 'registerRepoId' | 'getOrCreateBridge'>,
): (workspaceId: string) => Promise<void> {
    return async workspaceId => {
        const workspace = (await store.getWorkspaces()).find(workspace => workspace.id === workspaceId);
        if (!workspace || workspace.virtual || !workspace.rootPath || workspaceId.startsWith('remote:')) {
            throw new SentinelTodoError('invalid', 'Dependency action requires an exact registered local concrete workspace');
        }
        bridge.registerRepoId(workspace.id, workspace.rootPath);
        bridge.getOrCreateBridge(workspace.rootPath);
    };
}
