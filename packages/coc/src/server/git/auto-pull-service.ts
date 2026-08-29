/**
 * Composition root for server-side auto-pull.
 *
 * `AutoPullManager` owns *when* a tick fires and `runAutoPullTick` owns *what*
 * one does; both take their collaborators as plain function deps so they stay
 * unit-testable. This module is the one place that binds those deps to the real
 * process store, per-repo preferences, `GitOpsStore`, `BranchService`, and
 * `WorkingTreeService`, so the wiring lives outside both.
 *
 * The pull is issued through a `GitOperationRunner` — the same kernel the manual
 * Pull button goes through — so the 409 single-flight guard, the `git-ops.json`
 * job record, cache invalidation, and the `git-changed` broadcast all behave
 * identically for an automatic pull.
 *
 * It pulls with `rebase: true, currentBranchOnly: true`, which is exactly what
 * the browser timer this feature replaces asked for.
 *
 * Pure Node.js. Cross-platform compatible.
 */

import { BranchService, GitOpsStore, WorkingTreeService } from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences/repository';
import { AutoPullManager, type AutoPullTimerApi, type AutoPullWorkspace } from './auto-pull-manager';
import { runAutoPullTick } from './auto-pull-tick';
import { GitOperationRunner, type GitChangeBroadcaster } from './git-operation-runner';

export interface CreateAutoPullManagerOptions {
    /** Root of the coc data dir — preferences and run state both live under it. */
    dataDir: string;
    /** Workspace enumeration; only `id` and `rootPath` are used. */
    processStore: { getWorkspaces(): Promise<readonly AutoPullWorkspace[]> };
    /** Late-bound websocket server so `git-changed` reaches open dashboards. */
    getWsServer?: () => GitChangeBroadcaster | undefined;
    /**
     * Timer surface, defaulting to `setTimeout`/`clearTimeout`. Injected by the
     * integration test so it can fire a real tick without waiting out a minute.
     */
    timerApi?: AutoPullTimerApi;
}

/** Build a fully wired `AutoPullManager`. Arms nothing until `startAll()`. */
export function createAutoPullManager(options: CreateAutoPullManagerOptions): AutoPullManager {
    const { dataDir, processStore, getWsServer, timerApi } = options;
    const gitOpsStore = new GitOpsStore({ dataDir });
    const runner = new GitOperationRunner({ gitOpsStore, getWsServer });
    const branchService = new BranchService();
    const workingTreeService = new WorkingTreeService();

    return new AutoPullManager({
        dataDir,
        ...(timerApi ? { timerApi } : {}),
        listWorkspaces: () => processStore.getWorkspaces(),
        readAutoPullPreference: workspaceId => readRepoPreferences(dataDir, workspaceId).autoPull,
        runTick: (workspace) => runAutoPullTick({
            dataDir,
            workspaceId: workspace.id,
            repoRoot: workspace.rootPath,
            isPullRunning: async () => (await gitOpsStore.getRunning(workspace.id, 'pull')).length > 0,
            getChanges: repoRoot => workingTreeService.getAllChanges(repoRoot),
            pull: repoRoot => branchService.pullCurrentBranch(repoRoot, true),
            runner,
        }),
    });
}
