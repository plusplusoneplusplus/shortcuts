/**
 * WikiList — grid of wiki cards with status badges.
 */

import { useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { useWiki } from '../hooks/useWiki';
import { Card, Badge, Button, Spinner } from '../shared';
import { AddWikiDialog } from './AddWikiDialog';
import { EditWikiDialog } from './EditWikiDialog';
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
    const [deleting, setDeleting] = useState<string | null>(null);

    const selectWiki = useCallback((wikiId: string) => {
        dispatch({ type: 'SELECT_WIKI', wikiId });
        location.hash = '#wiki/' + encodeURIComponent(wikiId);
    }, [dispatch]);

    const setupWiki = useCallback((wikiId: string) => {
        dispatch({ type: 'SELECT_WIKI_WITH_TAB', wikiId, tab: 'admin' });
        location.hash = '#wiki/' + encodeURIComponent(wikiId) + '/admin';
    }, [dispatch]);

    const handleDelete = useCallback(async (wikiId: string) => {
        if (!confirm('Are you sure you want to delete this wiki?')) return;
        setDeleting(wikiId);
        try {
            const res = await fetch(getApiBase() + '/wikis/' + encodeURIComponent(wikiId), { method: 'DELETE' });
            if (res.ok) {
                dispatch({ type: 'REMOVE_WIKI', wikiId });
            }
        } catch { /* ignore */ }
        setDeleting(null);
    }, [dispatch]);

    return (
        <div className="p-4 space-y-4" id="view-wiki">
            <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Wikis</h2>
                <Button size="sm" onClick={() => setAddOpen(true)}>+ Add Wiki</Button>
            </div>

            {wikis.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-[#848484]">
                    <div className="text-4xl mb-3">📚</div>
                    <p className="mb-2">No wikis registered.</p>
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
                                className="p-3 hover:shadow-md transition-shadow"
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
                                <div className="flex justify-end gap-1 mt-2" onClick={e => e.stopPropagation()}>
                                    <button
                                        className="p-1 text-xs text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                                        title="Edit wiki"
                                        onClick={() => setEditWiki(wiki)}
                                    >✏️</button>
                                    <button
                                        className={cn(
                                            'p-1 text-xs text-[#848484] hover:text-[#f14c4c]',
                                            deleting === wiki.id && 'opacity-50'
                                        )}
                                        title="Delete wiki"
                                        disabled={deleting === wiki.id}
                                        onClick={() => handleDelete(wiki.id)}
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
        </div>
    );
}
