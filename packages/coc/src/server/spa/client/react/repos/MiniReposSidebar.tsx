/**
 * MiniReposSidebar — compact 48px rail shown when the full sidebar is collapsed.
 * Displays color-dot + letter for each repo, grouped with dividers.
 */

import { useState, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { cn } from '../shared';
import { groupReposByRemote } from './repoGrouping';
import { AddRepoDialog } from './AddRepoDialog';
import type { RepoData } from './repoGrouping';

interface MiniReposSidebarProps {
    repos: RepoData[];
    onRefresh: () => void;
    onItemHoverStart?: () => void;
    onItemHoverEnd?: () => void;
}

/** Disambiguate first letters within a list of repos: use 2 chars when collisions exist. */
export function disambiguateLabels(repos: RepoData[]): Map<string, string> {
    const result = new Map<string, string>();
    const firstLetters = new Map<string, string[]>();

    for (const repo of repos) {
        const name = repo.workspace.name || '';
        const letter = name.charAt(0).toUpperCase() || '?';
        if (!firstLetters.has(letter)) firstLetters.set(letter, []);
        firstLetters.get(letter)!.push(repo.workspace.id);
    }

    for (const repo of repos) {
        const name = repo.workspace.name || '';
        const letter = name.charAt(0).toUpperCase() || '?';
        const ids = firstLetters.get(letter) || [];
        if (ids.length > 1 && name.length >= 2) {
            result.set(repo.workspace.id, name.slice(0, 2).toUpperCase());
        } else {
            result.set(repo.workspace.id, letter);
        }
    }

    return result;
}

function MiniRepoItem({
    repo,
    label,
    isSelected,
    onClick,
    onDoubleClick,
    onHoverStart,
    onHoverEnd,
}: {
    repo: RepoData;
    label: string;
    isSelected: boolean;
    onClick: () => void;
    onDoubleClick: () => void;
    onHoverStart?: () => void;
    onHoverEnd?: () => void;
}) {
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const branch = repo.gitInfo?.branch || '';
    const fullName = ws.name + (branch ? ` (${branch})` : '');

    return (
        <button
            data-testid="mini-repo-item"
            className={cn(
                'w-full h-10 flex items-center justify-center gap-1.5 rounded transition-colors',
                'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                isSelected && 'border-l-[3px] border-l-[#0078d4]'
            )}
            aria-label={fullName}
            title={fullName}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onMouseEnter={onHoverStart}
            onMouseLeave={onHoverEnd}
        >
            <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: color }}
            />
            <span className="text-[11px] text-[#616161] dark:text-[#999]">{label}</span>
        </button>
    );
}

export function MiniReposSidebar({ repos, onRefresh, onItemHoverStart, onItemHoverEnd }: MiniReposSidebarProps) {
    const { state, dispatch } = useApp();
    const [addOpen, setAddOpen] = useState(false);

    const labels = useMemo(() => disambiguateLabels(repos), [repos]);

    const groups = useMemo(
        () => groupReposByRemote(repos, {}),
        [repos]
    );

    const selectRepo = useCallback((id: string) => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
        location.hash = '#repos/' + encodeURIComponent(id);
    }, [dispatch]);

    const expandAndSelect = useCallback((id: string) => {
        dispatch({ type: 'SET_SELECTED_REPO', id });
        dispatch({ type: 'TOGGLE_REPOS_SIDEBAR' });
        location.hash = '#repos/' + encodeURIComponent(id);
    }, [dispatch]);

    return (
        <nav
            data-testid="mini-repos-sidebar"
            role="navigation"
            aria-label="Repository quick-switch"
            className="flex flex-col h-full"
        >
            {/* Add button */}
            <div className="flex items-center justify-center py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    data-testid="mini-add-btn"
                    className="w-7 h-7 rounded-full flex items-center justify-center text-sm bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                    aria-label="Add repository"
                    title="Add repository"
                    onClick={() => setAddOpen(true)}
                >
                    +
                </button>
            </div>

            {/* Repo items */}
            <div className="flex-1 overflow-y-auto py-1 flex flex-col">
                {repos.length === 0 ? (
                    <div className="text-[9px] text-[#848484] text-center px-1 py-4" data-testid="mini-empty">
                        No repos
                    </div>
                ) : (
                    groups.map((group, gi) => (
                        <div key={group.normalizedUrl || `ungrouped-${gi}`}>
                            {gi > 0 && group.normalizedUrl && (
                                <div className="mx-2 my-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" />
                            )}
                            {group.repos.map(repo => (
                                <MiniRepoItem
                                    key={repo.workspace.id}
                                    repo={repo}
                                    label={labels.get(repo.workspace.id) || '?'}
                                    isSelected={repo.workspace.id === state.selectedRepoId}
                                    onClick={() => selectRepo(repo.workspace.id)}
                                    onDoubleClick={() => expandAndSelect(repo.workspace.id)}
                                    onHoverStart={onItemHoverStart}
                                    onHoverEnd={onItemHoverEnd}
                                />
                            ))}
                        </div>
                    ))
                )}
            </div>

            {/* Footer */}
            <div className="px-1 py-1.5 text-[10px] text-[#848484] border-t border-[#e0e0e0] dark:border-[#3c3c3c] text-center">
                {repos.length} repo{repos.length !== 1 ? 's' : ''}
            </div>

            {/* Add dialog */}
            <AddRepoDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                repos={repos}
                onSuccess={() => { setAddOpen(false); onRefresh(); }}
            />
        </nav>
    );
}
