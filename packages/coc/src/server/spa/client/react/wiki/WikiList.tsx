/**
 * WikiList — grid of wiki cards with status badges.
 */

import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useWiki } from '../hooks/useWiki';
import { Card, Badge, Button, Spinner } from '../shared';
import { AddWikiDialog } from './AddWikiDialog';
import { EditWikiDialog } from './EditWikiDialog';
import { DeleteWikiDialog } from './DeleteWikiDialog';
import { cn } from '../shared/cn';
import { getApiBase } from '../utils/config';

type WikiStatus = 'loaded' | 'generating' | 'error' | 'pending';

interface WikiData {
    id: string;
    name: string;
    repoPath: string;
    color?: string;
    generatedAt?: string;
    loaded?: boolean;
    componentCount?: number;
    status?: WikiStatus;
    title?: string;
    errorMessage?: string;
}

function getWikiStatus(wiki: WikiData): WikiStatus {
    if (wiki.status) return wiki.status;
    if (wiki.loaded) return 'loaded';
    return 'pending';
}

const statusConfig: Record<WikiStatus, { label: string; badge: string }> = {
    loaded: { label: 'Ready', badge: 'completed' },
    generating: { label: 'Generating', badge: 'running' },
    error: { label: 'Error', badge: 'failed' },
    pending: { label: 'Setup Required', badge: 'warning' },
};

/** Replace the user's home directory prefix with `~` for cleaner display. */
export function shortenPath(fullPath: string): string {
    if (!fullPath) return fullPath;
    // Detect home directory from common env vars or path patterns
    const home = typeof process !== 'undefined' && process.env?.HOME
        ? process.env.HOME
        : typeof process !== 'undefined' && process.env?.USERPROFILE
            ? process.env.USERPROFILE
            : null;
    if (home && fullPath.startsWith(home)) {
        return '~' + fullPath.slice(home.length);
    }
    // Fallback: detect /Users/xxx or /home/xxx patterns
    const homeMatch = fullPath.match(/^(\/(?:Users|home)\/[^/]+)/);
    if (homeMatch) {
        return '~' + fullPath.slice(homeMatch[1].length);
    }
    return fullPath;
}

function relativeTime(dateStr: string): string {
    const d = new Date(dateStr);
    const now = Date.now();
    const diff = now - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
}

export function WikiList() {
    const { wikis, reload } = useWiki();
    const { dispatch } = useApp();
    const [addOpen, setAddOpen] = useState(false);
    const [editWiki, setEditWiki] = useState<WikiData | null>(null);
    const [deleteWiki, setDeleteWiki] = useState<WikiData | null>(null);

    const selectWiki = useCallback((wikiId: string) => {
        dispatch({ type: 'SELECT_WIKI', wikiId });
        location.hash = '#wiki/' + encodeURIComponent(wikiId);
    }, [dispatch]);

    const setupWiki = useCallback((wikiId: string) => {
        dispatch({ type: 'SELECT_WIKI_WITH_TAB', wikiId, tab: 'admin' });
        location.hash = '#wiki/' + encodeURIComponent(wikiId) + '/admin';
    }, [dispatch]);

    const handleDeleteClick = useCallback((wiki: WikiData) => {
        setDeleteWiki(wiki);
    }, []);

    const handleDeleted = useCallback((wikiId: string) => {
        dispatch({ type: 'REMOVE_WIKI', wikiId });
    }, [dispatch]);

    return (
        <div className="p-4 space-y-4" id="view-wiki">
            <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Wikis</h2>
                <Button size="sm" id="wiki-list-add-btn" onClick={() => setAddOpen(true)}>+ Add Wiki</Button>
            </div>

            {wikis.length === 0 ? (
                <div id="wiki-empty" className="flex flex-col items-center justify-center py-16 text-center text-sm text-[#848484]">
                    <div className="text-4xl mb-3">📚</div>
                    <p className="mb-2">No wikis yet</p>
                    <p className="mb-4">Click "Add Wiki" to generate a wiki for a repository.</p>
                    <Button size="sm" onClick={() => setAddOpen(true)}>+ Add Wiki</Button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" id="wiki-card-list">
                    {wikis.map((wiki: WikiData) => {
                        const status = getWikiStatus(wiki);
                        const cfg = statusConfig[status];
                        const name = wiki.name || wiki.title || wiki.id;
                        return (
                            <Card
                                key={wiki.id}
                                className="wiki-card p-3 hover:shadow-md transition-shadow"
                                data-wiki-id={wiki.id}
                                onClick={() => selectWiki(wiki.id)}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <span
                                        className="w-3 h-3 rounded-full flex-shrink-0"
                                        style={{ background: wiki.color || '#848484' }}
                                    />
                                    <span className="font-medium text-sm text-[#1e1e1e] dark:text-[#cccccc] truncate flex-1">
                                        {name}
                                    </span>
                                    <Badge status={cfg.badge}>
                                        {status === 'generating' && <Spinner size="sm" />}
                                        {cfg.label}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-[#848484]">
                                    {status === 'loaded' && typeof wiki.componentCount === 'number' && (
                                        <span>{wiki.componentCount} components</span>
                                    )}
                                    {wiki.generatedAt && (
                                        <span>{relativeTime(wiki.generatedAt)}</span>
                                    )}
                                    {status === 'pending' && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            className="!text-[#f59e0b] !px-1.5 !py-0.5 !text-[11px] border border-[#f59e0b] hover:!bg-[#f59e0b]/10"
                                            onClick={(e) => { e.stopPropagation(); setupWiki(wiki.id); }}
                                        >
                                            → Setup
                                        </Button>
                                    )}
                                </div>
                                {wiki.repoPath && (
                                    <div
                                        className="text-xs text-[#848484] truncate mt-1"
                                        style={{ direction: 'rtl', textAlign: 'left' }}
                                        title={wiki.repoPath}
                                    >
                                        <span style={{ direction: 'ltr', unicodeBidi: 'embed' }}>
                                            📂 {shortenPath(wiki.repoPath)}
                                        </span>
                                    </div>
                                )}
                                <div className="flex justify-end gap-1 mt-2" onClick={e => e.stopPropagation()}>
                                    <button
                                        className="wiki-card-edit p-1 text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                        title="Edit wiki"
                                        onClick={() => setEditWiki(wiki)}
                                    >✏️</button>
                                    <button
                                        className="wiki-card-delete p-1 text-xs text-[#848484] hover:text-[#f14c4c]"
                                        title="Delete wiki"
                                        onClick={() => handleDeleteClick(wiki)}
                                    >🗑️</button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}

            <AddWikiDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={reload} />
            {editWiki && (
                <EditWikiDialog
                    open={true}
                    wiki={editWiki}
                    onClose={() => setEditWiki(null)}
                    onUpdated={reload}
                />
            )}
            {deleteWiki && (
                <DeleteWikiDialog
                    open={true}
                    wiki={deleteWiki}
                    onClose={() => setDeleteWiki(null)}
                    onDeleted={() => { handleDeleted(deleteWiki.id); setDeleteWiki(null); reload(); }}
                />
            )}
        </div>
    );
}
