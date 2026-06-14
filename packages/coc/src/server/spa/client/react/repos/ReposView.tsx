/**
 * ReposView — full-width content area for the Repos tab.
 * Repo selection is handled via the RepoTabStrip in the TopBar.
 * Mobile: master-detail (grid list or repo detail).
 * Tablet/Desktop: full-width RepoDetail (repo chosen from top-bar tabs).
 */

import { useCallback } from 'react';
import { useApp } from '../contexts/AppContext';
import { useRepos } from '../contexts/ReposContext';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import { useMyWorkEnabled } from '../hooks/feature-flags/useMyWorkEnabled';
import { useMyLifeEnabled } from '../hooks/feature-flags/useMyLifeEnabled';
import { ReposGrid } from './ReposGrid';
import { RepoDetail } from '../features/repo-detail/RepoDetail';
import { RemoteSubBar } from '../features/remote-shell/RemoteSubBar';
import { useRemoteShellEnabled } from '../hooks/feature-flags/useRemoteShellEnabled';
import { ContainerSessionView, CONTAINER_DEFAULT_REPO_ID } from '../features/container-session/ContainerSessionView';
import { MyWorkView, MY_WORK_WORKSPACE_ID } from './MyWorkView';
import { MyLifeView, MY_LIFE_WORKSPACE_ID } from './MyLifeView';


export function ReposView() {
    const { state, dispatch } = useApp();
    const { repos, loading, fetchRepos } = useRepos();
    const { breakpoint } = useBreakpoint();
    const myWorkEnabled = useMyWorkEnabled();
    const myLifeEnabled = useMyLifeEnabled();
    const remoteShell = useRemoteShellEnabled();
    const isMobile = breakpoint === 'mobile';
    const hasSelection = state.selectedRepoId !== null;
    const heightClass = isMobile
        ? hasSelection
            ? 'h-[calc(100dvh-40px)]'
            : 'h-[calc(100dvh-40px-48px)]'
        : 'h-[calc(100vh-48px)]';

    const handleBack = useCallback(() => {
        dispatch({ type: 'SET_SELECTED_REPO', id: null });
        if (location.hash.startsWith('#repo')) {
            location.hash = '';
        }
    }, [dispatch]);

    if (loading && repos.length === 0) {
        return (
            <div id="view-repos" className={`flex items-center justify-center ${heightClass} text-sm text-[#848484]`}>
                Loading repositories...
            </div>
        );
    }

    // If a specific repo was requested via deep-link but hasn't appeared in the
    // list yet (repo data still loading), keep showing the loading indicator
    // rather than flashing the empty "Select a repository" panel.
    // Exception: my_work is a virtual workspace that won't appear in repos list (only when enabled).
    if (loading && state.selectedRepoId && !(myWorkEnabled && state.selectedRepoId === MY_WORK_WORKSPACE_ID) && !(myLifeEnabled && state.selectedRepoId === MY_LIFE_WORKSPACE_ID) && !repos.find(r => r.workspace.id === state.selectedRepoId)) {
        return (
            <div id="view-repos" className={`flex items-center justify-center ${heightClass} text-sm text-[#848484]`}>
                Loading repositories...
            </div>
        );
    }

    // My Work virtual workspace — dedicated view with notes + toolbar
    const isMyWork = myWorkEnabled && state.selectedRepoId === MY_WORK_WORKSPACE_ID;

    // My Life virtual workspace — personal goals, journal, life admin
    const isMyLife = myLifeEnabled && state.selectedRepoId === MY_LIFE_WORKSPACE_ID;

    // Container default session — smart routing chat
    const isContainerDefault = state.selectedRepoId === CONTAINER_DEFAULT_REPO_ID;

    const selectedRepo = repos.find(r =>
        r.workspace.id === state.selectedRepoId &&
        (!state.currentAgentId || !r.workspace.agentId || r.workspace.agentId === state.currentAgentId)
    ) || repos.find(r => r.workspace.id === state.selectedRepoId) || null;

    return (
        <div id="view-repos" className={`flex ${heightClass} overflow-hidden`}>
            {isContainerDefault ? (
                // ── Container Default: smart routing chat ──
                <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                    <ContainerSessionView />
                </main>
            ) : isMyWork ? (
                // ── My Work: notes-based workspace with sync/summary toolbar ──
                <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                    <MyWorkView />
                </main>
            ) : isMyLife ? (
                // ── My Life: personal workspace with goals/journal ──
                <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                    <MyLifeView />
                </main>
            ) : isMobile ? (
                // ── Mobile: master-detail ──
                hasSelection && selectedRepo ? (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                            <RepoDetail key={`${selectedRepo.workspace.id}-${state.currentAgentId ?? ''}`} repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                        </main>
                    </div>
                ) : (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-[#f3f3f3] dark:bg-[#252526] overflow-hidden">
                        <ReposGrid repos={repos} onRefresh={fetchRepos} />
                    </div>
                )
            ) : (
                // ── Tablet / Desktop: full-width content, repo selected via top-bar tabs ──
                <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                    {selectedRepo ? (
                        remoteShell ? (
                            // Remote-first shell: RemoteSubBar (row 2) above a chromeless RepoDetail body.
                            <>
                                <RemoteSubBar repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                                <div className="flex-1 min-h-0 min-w-0 flex flex-col">
                                    <RepoDetail chromeless key={`${selectedRepo.workspace.id}-${state.currentAgentId ?? ''}`} repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                                </div>
                            </>
                        ) : (
                            <RepoDetail key={`${selectedRepo.workspace.id}-${state.currentAgentId ?? ''}`} repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
                        )
                    ) : (
                        <div id="repo-detail-empty" data-testid="repo-detail-empty" className="flex-1 flex items-center justify-center text-sm text-[#848484]">
                            Select a repository to view details
                        </div>
                    )}
                </main>
            )}
        </div>
    );
}
