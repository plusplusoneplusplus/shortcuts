/**
 * ReposGrid — left sidebar listing repos grouped by remote URL.
 * Owns data fetching and enrichment for all repo sub-tabs.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { fetchApi } from '../hooks/useApi';
import { Button, cn } from '../shared';
import { RepoCard } from './RepoCard';
import { AddRepoDialog } from './AddRepoDialog';
import { groupReposByRemote, countTasks } from './repoGrouping';
import type { RepoData } from './repoGrouping';

interface ReposGridProps {
    repos: RepoData[];
    onRefresh: () => void;
}

export function ReposGrid({ repos, onRefresh }: ReposGridProps) {
    const { state, dispatch } = useApp();
    const [expandedState, setExpandedState] = useState<Record<string, boolean>>({});
    const [addOpen, setAddOpen] = useState(false);

    const groups = groupReposByRemote(repos, expandedState);

    const toggleGroup = (url: string) => {
        setExpandedState(prev => ({ ...prev, [url]: prev[url] === false }));
    };

    const selectRepo = (id: string) => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
        // Preserve current sub-tab when switching repos (don't reset to info)
        location.hash = '#repos/' + encodeURIComponent(id);
    };

    // Footer stats
    const cloneGroups = groups.filter(g => g.repos.length >= 2);
    const totalRunning = repos.reduce((s, r) => s + (r.stats?.running || 0), 0);
    const totalCompleted = repos.reduce((s, r) => s + (r.stats?.success || 0), 0);
    let footerText = `${repos.length} repo${repos.length !== 1 ? 's' : ''}`;
    if (cloneGroups.length > 0) {
        const cloneCount = cloneGroups.reduce((s, g) => s + g.repos.length, 0);
        footerText += ` | ${cloneCount} clone${cloneCount !== 1 ? 's' : ''} in ${cloneGroups.length} group${cloneGroups.length !== 1 ? 's' : ''}`;
    }
    footerText += ` | ${totalRunning} running | ${totalCompleted} completed`;

    return (
        <div className="flex flex-col h-full">
            {/* Header with add button */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Repositories</span>
                <Button variant="primary" size="sm" id="add-repo-btn" data-testid="add-repo-btn" onClick={() => setAddOpen(true)}>
                    + Add
                </Button>
            </div>

            {/* Repo list */}
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
                {repos.length === 0 ? (
                    <div id="repos-empty" data-testid="repos-empty" className="text-center text-xs text-[#848484] py-8">
                        No repositories registered.
                        <br />Click "+ Add" to register a workspace.
                    </div>
                ) : (
                    groups.map(group => {
                        if (group.normalizedUrl) {
                            // Grouped repos
                            return (
                                <div key={group.normalizedUrl}>
                                    <button
                                        className="flex items-center gap-1.5 w-full text-left px-1 py-1 text-[11px] text-[#616161] dark:text-[#999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] transition-colors"
                                        onClick={() => toggleGroup(group.normalizedUrl!)}
                                    >
                                        <span>{group.expanded ? '▾' : '▸'}</span>
                                        <span>📦</span>
                                        <span className="font-medium truncate">{group.label}</span>
                                        <span className="ml-auto text-[10px] bg-[#e0e0e0] dark:bg-[#3c3c3c] px-1 py-px rounded">{group.repos.length}</span>
                                    </button>
                                    {group.expanded && (
                                        <div className="flex flex-col gap-1 mt-0.5">
                                            {group.repos.map(repo => (
                                                <RepoCard
                                                    key={repo.workspace.id}
                                                    repo={repo}
                                                    isSelected={repo.workspace.id === state.selectedRepoId}
                                                    inGroup
                                                    onClick={() => selectRepo(repo.workspace.id)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        }
                        // Ungrouped repo (single, no remote)
                        return group.repos.map(repo => (
                            <RepoCard
                                key={repo.workspace.id}
                                repo={repo}
                                isSelected={repo.workspace.id === state.selectedRepoId}
                                onClick={() => selectRepo(repo.workspace.id)}
                            />
                        ));
                    })
                )}
            </div>

            {/* Footer */}
            {repos.length > 0 && (
                <div className="px-3 py-1.5 text-[10px] text-[#848484] border-t border-[#e0e0e0] dark:border-[#3c3c3c]">
                    {footerText}
                </div>
            )}

            {/* Add dialog */}
            <AddRepoDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                repos={repos}
                onSuccess={() => { setAddOpen(false); onRefresh(); }}
            />
        </div>
    );
}
