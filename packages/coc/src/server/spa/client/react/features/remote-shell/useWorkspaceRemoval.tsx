/**
 * useWorkspaceRemoval — the single "Remove from CoC" flow, shared by every
 * surface that offers removal (the repo-tab context menu in
 * `WorkspaceTabsCluster` and the remotes-picker row menu in
 * `WorkspaceIdentityChip`).
 *
 * It owns the confirm dialog, the in-flight state, the selection fallback to a
 * sibling clone, the toast, and the repo refetch — so `removeWorkspace()` has
 * exactly one call site in the SPA feature code (AC-01).
 *
 * Removal is *unregister only*: the checkout on disk and `~/.coc/repos/<id>`
 * are left untouched.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useQueue } from '../../contexts/QueueContext';
import { useRepos } from '../../contexts/ReposContext';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';
import { getRepoSelectionId } from '../../repos/cloneIdentity';
import { groupReposByRemote, type RepoData } from '../../repos/repoGrouping';
import { removeWorkspace } from '../../repos/repositoryService';
import { Dialog } from '../../ui/Dialog';
import { describeActiveWork } from './shellModel';
import { useShellNavigation } from './useShellNavigation';

export interface UseWorkspaceRemovalOptions {
    /** Every known repo — used to find a sibling clone to fall back to. */
    repos: RepoData[];
    /** The currently selected clone, if any; selection only moves when it is removed. */
    selectedRepo?: RepoData | null;
    addToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export interface WorkspaceRemoval {
    /** Open the confirm dialog for this repo. */
    requestRemove: (repo: RepoData) => void;
    /** The repo awaiting confirmation, or null. */
    removeTarget: RepoData | null;
    /** The confirm dialog element — render it from the caller's tree. */
    removeDialog: ReactNode;
}

export function useWorkspaceRemoval({ repos, selectedRepo, addToast }: UseWorkspaceRemovalOptions): WorkspaceRemoval {
    const { fetchRepos } = useRepos();
    const { selectClone } = useShellNavigation();
    const { state: queueState } = useQueue();
    const [target, setTarget] = useState<RepoData | null>(null);
    const [removing, setRemoving] = useState(false);

    // AC-03: warn, never block. No queue entry (remote clone, offline, not yet
    // loaded) simply means no warning line.
    const activeWork = target
        ? describeActiveWork(queueState?.repoQueueMap?.[String(target.workspace.id)], isHiddenTask)
        : null;

    const groups = useMemo(() => groupReposByRemote(repos, {}), [repos]);

    const findSibling = useCallback((menuRepo: RepoData): RepoData | null => {
        const id = getRepoSelectionId(menuRepo);
        const group = groups.find(g => g.repos.some(r => getRepoSelectionId(r) === id));
        return group?.repos.find(r => getRepoSelectionId(r) !== id) ?? null;
    }, [groups]);

    const doRemove = useCallback(async (menuRepo: RepoData) => {
        setRemoving(true);
        try {
            const removingSelected = !!selectedRepo
                && getRepoSelectionId(menuRepo) === getRepoSelectionId(selectedRepo);
            await removeWorkspace(String(menuRepo.workspace.id));
            if (removingSelected) {
                const sibling = findSibling(menuRepo);
                if (sibling) selectClone(getRepoSelectionId(sibling));
            }
            setTarget(null);
            await fetchRepos();
            addToast(`Removed ${menuRepo.workspace.name}`, 'success');
        } catch {
            addToast(`Failed to remove ${menuRepo.workspace.name}`, 'error');
        } finally {
            setRemoving(false);
        }
    }, [selectedRepo, findSibling, selectClone, fetchRepos, addToast]);

    const removeDialog = target ? (
        <Dialog
            open={true}
            onClose={() => !removing && setTarget(null)}
            title="Remove from CoC?"
            id="clone-remove-dialog"
            footer={
                <>
                    <button
                        onClick={() => setTarget(null)}
                        disabled={removing}
                        className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#f6f8fa] dark:bg-[#2a2a2a] border border-[#d0d7de] dark:border-[#3c3c3c] text-[#1f2328] dark:text-[#cccccc] hover:bg-[#eaeef2] dark:hover:bg-[#3c3c3c] transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        data-testid="clone-remove-confirm-btn"
                        onClick={() => doRemove(target)}
                        disabled={removing}
                        className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[#cf222e] hover:bg-[#a40e26] text-white transition-colors disabled:opacity-50"
                    >
                        {removing ? 'Removing...' : 'Remove'}
                    </button>
                </>
            }
        >
            <p className="text-[13px]">
                Remove <strong>{target.workspace.name}</strong> from CoC?
            </p>
            <p className="text-[12px] text-[#848484] dark:text-[#777] mt-1">
                The folder on disk is left untouched - only the CoC registration is removed.
            </p>
            {activeWork && (
                <p data-testid="clone-remove-active-work" className="text-[12px] text-[#c98410] mt-1">
                    {activeWork}
                </p>
            )}
        </Dialog>
    ) : null;

    return { requestRemove: setTarget, removeTarget: target, removeDialog };
}
