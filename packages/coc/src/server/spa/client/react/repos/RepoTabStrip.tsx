/**
 * RepoTabStrip — horizontal scrollable tab strip for repo switching in the TopBar.
 * Each tab shows a color dot, truncated repo name, and an optional unseen badge.
 */

import { useState } from 'react';
import { AddRepoDialog } from './AddRepoDialog';
import type { RepoData } from './repoGrouping';

export interface RepoTabStripProps {
    repos: RepoData[];
    selectedRepoId: string | null;
    onSelect: (id: string) => void;
    unseenCounts: Record<string, number>;
    onRefresh: () => void;
}

export function RepoTabStrip({ repos, selectedRepoId, onSelect, unseenCounts, onRefresh }: RepoTabStripProps) {
    const [addOpen, setAddOpen] = useState(false);

    return (
        <div
            className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide flex-1 min-w-0 px-1"
            data-testid="repo-tab-strip"
        >
            {repos.map(repo => {
                const ws = repo.workspace;
                const isSelected = ws.id === selectedRepoId;
                const unseenCount = unseenCounts[ws.id] ?? 0;
                const color = ws.color || '#848484';
                return (
                    <button
                        key={ws.id}
                        data-testid="repo-tab"
                        data-repo-id={ws.id}
                        className={
                            'relative flex items-center gap-1.5 px-2.5 h-7 rounded text-xs whitespace-nowrap shrink-0 transition-colors ' +
                            (isSelected
                                ? 'bg-[#0078d4] text-white'
                                : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-black/[0.05] dark:hover:bg-white/[0.08]')
                        }
                        aria-pressed={isSelected}
                        aria-label={ws.name}
                        title={ws.name}
                        onClick={() => onSelect(ws.id)}
                    >
                        <span
                            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: isSelected ? 'rgba(255,255,255,0.7)' : color }}
                        />
                        <span className="max-w-[100px] truncate">{ws.name}</span>
                        {unseenCount > 0 && (
                            <span
                                className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#d16969] text-white text-[8px] font-semibold flex items-center justify-center leading-none"
                                data-testid="repo-tab-unseen-badge"
                                aria-label={`${unseenCount} unread`}
                            >
                                {unseenCount > 99 ? '99+' : unseenCount}
                            </span>
                        )}
                    </button>
                );
            })}
            <button
                data-testid="repo-tab-add-btn"
                className="flex-shrink-0 h-7 w-7 rounded flex items-center justify-center text-base hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#1e1e1e] dark:text-[#cccccc]"
                aria-label="Add repository"
                title="Add repository"
                onClick={() => setAddOpen(true)}
            >
                +
            </button>
            <AddRepoDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                repos={repos}
                onSuccess={() => { setAddOpen(false); onRefresh(); }}
            />
        </div>
    );
}
