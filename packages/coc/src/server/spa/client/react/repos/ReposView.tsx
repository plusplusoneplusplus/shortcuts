/**
 * ReposView — full-width content area for the Repos tab.
 * Repo selection is handled via the RepoTabStrip in the TopBar.
 * Mobile: master-detail (grid list or repo detail).
 * Tablet/Desktop: full-width RepoDetail (repo chosen from top-bar tabs).
 */

import { useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useRepos } from '../context/ReposContext';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { ReposGrid } from './ReposGrid';
import { RepoDetail } from './RepoDetail';


export function ReposView() {
    const { state, dispatch } = useApp();
    const { repos, loading, fetchRepos } = useRepos();
    const { breakpoint } = useBreakpoint();
    const isMobile = breakpoint === 'mobile';
    const hasSelection = state.selectedRepoId !== null;
    const heightClass = isMobile
        ? 'h-[calc(100vh-40px-56px)]'
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

    const selectedRepo = repos.find(r => r.workspace.id === state.selectedRepoId) || null;

    return (
        <div id="view-repos" className={`flex ${heightClass} overflow-hidden`}>
            {isMobile ? (
                // ── Mobile: master-detail ──
                hasSelection && selectedRepo ? (
                    <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                        <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-white dark:bg-[#1e1e1e] overflow-hidden">
                            <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
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
                        <RepoDetail repo={selectedRepo} repos={repos} onRefresh={fetchRepos} />
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
