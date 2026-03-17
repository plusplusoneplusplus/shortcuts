/**
 * RepoTabStrip — horizontal scrollable tab strip for repo switching in the TopBar.
 * Each tab shows a color dot, truncated repo name, and an optional unseen badge.
 */

import { useState, useRef, useEffect } from 'react';
import { AddRepoDialog } from './AddRepoDialog';
import { AddFolderDialog } from './AddFolderDialog';
import type { RepoData } from './repoGrouping';
import { groupReposByRemote } from './repoGrouping';

export interface RepoTabStripProps {
    repos: RepoData[];
    selectedRepoId: string | null;
    onSelect: (id: string) => void;
    unseenCounts: Record<string, number>;
    onRefresh: () => void;
}

interface ContextMenuState {
    repoId: string;
    x: number;
    y: number;
}

export function RepoTabStrip({ repos, selectedRepoId, onSelect, unseenCounts, onRefresh }: RepoTabStripProps) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [addFolderOpen, setAddFolderOpen] = useState(false);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const contextMenuRef = useRef<HTMLDivElement>(null);
    const groups = groupReposByRemote(repos, {});

    useEffect(() => {
        if (!dropdownOpen) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setDropdownOpen(false);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [dropdownOpen]);

    useEffect(() => {
        if (!contextMenu) return;
        const handleMouseDown = (e: MouseEvent) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setContextMenu(null);
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [contextMenu]);

    return (
        <div
            className="flex items-center flex-1 min-w-0"
            data-testid="repo-tab-strip"
        >
        <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide flex-1 min-w-0 px-1">
            {groups.map((group, groupIndex) => (
                <div key={group.normalizedUrl ?? `ungrouped-${groupIndex}`} className="contents">
                    {groupIndex > 0 && (
                        <div
                            className="h-5 w-px bg-gray-300 dark:bg-gray-600 mx-1 flex-shrink-0"
                            data-testid="repo-group-separator"
                            title={group.normalizedUrl ? group.label : undefined}
                        />
                    )}
                    {group.repos.map(repo => {
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
                                onContextMenu={e => {
                                    e.preventDefault();
                                    setContextMenu({ repoId: ws.id, x: e.clientX, y: e.clientY });
                                }}
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
                </div>
            ))}
        </div>
        {/* "+" button is outside overflow-x-auto so its dropdown is not clipped */}
        <div ref={dropdownRef} className="relative flex-shrink-0 px-1">
            <button
                data-testid="repo-tab-add-btn"
                className="h-7 w-7 rounded flex items-center justify-center text-base hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#1e1e1e] dark:text-[#cccccc]"
                aria-label="Add repository"
                aria-haspopup="true"
                aria-expanded={dropdownOpen}
                title="Add repository"
                onClick={() => setDropdownOpen(prev => !prev)}
            >
                +
            </button>
            {dropdownOpen && (
                <div
                    data-testid="repo-tab-add-dropdown"
                    className="absolute right-0 top-full mt-1 z-50 min-w-[190px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                    role="menu"
                >
                    <button
                        data-testid="repo-tab-add-folder-option"
                        className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                        role="menuitem"
                        onClick={() => { setDropdownOpen(false); setAddFolderOpen(true); }}
                    >
                        📁 Add workspace folder
                    </button>
                    <button
                        data-testid="repo-tab-add-repo-option"
                        className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                        role="menuitem"
                        onClick={() => { setDropdownOpen(false); setAddOpen(true); }}
                    >
                        ＋ Add specific repository
                    </button>
                </div>
            )}
        </div>
            <AddRepoDialog
                open={addOpen}
                onClose={() => setAddOpen(false)}
                repos={repos}
                onSuccess={() => { setAddOpen(false); onRefresh(); }}
            />
            <AddFolderDialog
                open={addFolderOpen}
                onClose={() => setAddFolderOpen(false)}
                onAdded={() => { setAddFolderOpen(false); onRefresh(); }}
            />
            {contextMenu !== null && (() => {
                const ws = repos.flatMap(r => [r.workspace]).find(w => w.id === contextMenu.repoId);
                if (!ws) return null;
                return (
                    <div
                        ref={contextMenuRef}
                        data-testid="repo-tab-context-menu"
                        className="fixed z-50 min-w-[160px] bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c] rounded shadow-lg py-1"
                        role="menu"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        <button
                            data-testid="repo-tab-context-copy-info"
                            className="w-full text-left px-3 py-1.5 text-xs text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#0078d4]/10 dark:hover:bg-[#3794ff]/10 cursor-pointer"
                            role="menuitem"
                            onClick={() => {
                                navigator.clipboard.writeText(`${ws.name}: ${ws.rootPath ?? ''}${ws.description ? '\n' + ws.description : ''}`);
                                setContextMenu(null);
                            }}
                        >
                            Copy Info
                        </button>
                    </div>
                );
            })()}
        </div>
    );
}
