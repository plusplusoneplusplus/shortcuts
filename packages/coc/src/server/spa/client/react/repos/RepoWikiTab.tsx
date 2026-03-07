import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { useGlobalToast } from '../context/ToastContext';
import { Button } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { WikiDetail } from '../wiki/WikiDetail';
import type { WikiProjectTab, WikiAdminTab } from '../types/dashboard';

function slugify(name: string): string {
    const s = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return s || 'wiki-' + Date.now();
}

interface RepoWikiTabProps {
    workspaceId: string;
    workspacePath?: string;
    initialWikiId?: string | null;
    initialTab?: WikiProjectTab | null;
    initialAdminTab?: WikiAdminTab | null;
    initialComponentId?: string | null;
}

export function RepoWikiTab({ workspaceId, workspacePath, initialWikiId, initialTab, initialAdminTab, initialComponentId }: RepoWikiTabProps) {
    const { state, dispatch } = useApp();
    const { addToast } = useGlobalToast();

    const repoWikis = useMemo(() => {
        const filtered = state.wikis.filter((w: any) => w.repoPath === workspacePath);
        return filtered.sort((a: any, b: any) =>
            (b.generatedAt || '').localeCompare(a.generatedAt || '')
        );
    }, [state.wikis, workspacePath]);

    const [selectedWikiId, setSelectedWikiId] = useState<string | null>(initialWikiId ?? null);
    const activeWikiId = selectedWikiId || repoWikis[0]?.id || null;
    const selectedWiki = useMemo(() =>
        repoWikis.find((w: any) => w.id === activeWikiId) || repoWikis[0] || null,
        [repoWikis, activeWikiId]
    );

    // Sync deep-link initial wiki ID from props
    useEffect(() => {
        if (initialWikiId) {
            setSelectedWikiId(initialWikiId);
        }
    }, [initialWikiId]);

    // Clear deep-link initial state after consuming (one-shot signal)
    const clearedRef = useRef(false);
    useEffect(() => {
        if (!clearedRef.current && (initialWikiId || initialTab)) {
            clearedRef.current = true;
            dispatch({ type: 'CLEAR_REPO_WIKI_INITIAL' });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleWikiSelect = useCallback((wikiId: string) => {
        setSelectedWikiId(wikiId);
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/wiki/' + encodeURIComponent(wikiId);
    }, [workspaceId]);

    const handleWikiHashChange = useCallback((subPath: string) => {
        if (!activeWikiId) return;
        const base = '#repos/' + encodeURIComponent(workspaceId) + '/wiki/' + encodeURIComponent(activeWikiId);
        location.hash = base + subPath;
    }, [workspaceId, activeWikiId]);

    const handleGenerateWiki = useCallback(async () => {
        if (!workspacePath) return;
        const repoName = workspacePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'wiki';
        const id = slugify(repoName);
        const res = await fetchApi('/wikis', {
            method: 'POST',
            body: JSON.stringify({ id, name: repoName, repoPath: workspacePath }),
        });
        if (res.ok) {
            const wiki = await res.json();
            dispatch({ type: 'SET_WIKI_AUTO_GENERATE', value: true });
            location.hash = '#wiki/' + encodeURIComponent(wiki.id) + '/admin';
        } else {
            const body = await res.json().catch(() => ({ error: 'Failed to create wiki' }));
            addToast(body.error || 'Failed to create wiki', 'error');
        }
    }, [workspacePath, addToast, dispatch]);

    const handleRetryGeneration = useCallback(async (wikiId: string) => {
        dispatch({ type: 'SET_WIKI_AUTO_GENERATE', value: true });
        location.hash = '#wiki/' + encodeURIComponent(wikiId) + '/admin';
    }, [dispatch]);

    if (repoWikis.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="text-4xl mb-3">📚</div>
                <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">
                    No Wiki Found
                </div>
                <div className="text-xs text-[#848484] mb-4 max-w-xs">
                    No wiki has been generated for this workspace yet.
                    Generate one to get auto-documented architecture, components, and code insights.
                </div>
                <Button
                    size="sm"
                    disabled={!workspacePath}
                    title={!workspacePath ? 'A repository path is required to generate a wiki' : undefined}
                    onClick={handleGenerateWiki}
                >
                    Generate Wiki
                </Button>
            </div>
        );
    }

    // State 2: exactly one wiki — render inline
    if (repoWikis.length === 1) {
        return (
            <div className="flex flex-col h-full min-h-0">
                {selectedWiki && selectedWiki.status === 'generating' && (
                    <div
                        className="flex items-center gap-2 px-4 py-2 bg-[#16825d]/10 border border-[#16825d]/30 rounded text-sm"
                        data-testid="wiki-generating-banner"
                    >
                        <span className="animate-spin text-[#16825d]">⟳</span>
                        <span>Wiki generation in progress…</span>
                    </div>
                )}
                {selectedWiki && selectedWiki.status === 'error' && (
                    <div
                        className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm"
                        data-testid="wiki-error-banner"
                    >
                        <span className="text-red-400">
                            ⚠ Wiki generation failed{selectedWiki.error ? `: ${selectedWiki.error}` : '.'}
                        </span>
                        <button
                            className="text-xs text-blue-400 hover:underline"
                            data-testid="wiki-retry-btn"
                            onClick={() => handleRetryGeneration(selectedWiki.id)}
                        >
                            Retry
                        </button>
                    </div>
                )}
                <div className="flex-1 min-h-0">
                    <WikiDetail
                        wikiId={repoWikis[0].id}
                        embedded
                        initialTab={initialTab}
                        initialAdminTab={initialAdminTab}
                        initialComponentId={initialComponentId}
                        onHashChange={handleWikiHashChange}
                    />
                </div>
            </div>
        );
    }

    // State 3: multiple wikis — show selector + inline detail
    if (repoWikis.length > 1) {
    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Wiki selector bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                <label className="text-xs text-[#848484] flex-shrink-0">Wiki:</label>
                <select
                    className="text-xs bg-transparent border border-[#e0e0e0] dark:border-[#3c3c3c] rounded px-2 py-1 text-[#1e1e1e] dark:text-[#cccccc] min-w-0 max-w-xs truncate"
                    value={activeWikiId || ''}
                    onChange={(e) => handleWikiSelect(e.target.value)}
                    data-testid="repo-wiki-selector"
                >
                    {repoWikis.map((w: any) => (
                        <option key={w.id} value={w.id}>
                            {w.name || w.title || w.id}
                            {w.status === 'generating' ? ' ⟳' : ''}
                            {w.status === 'error' ? ' ⚠' : ''}
                        </option>
                    ))}
                </select>
                <span className="text-[10px] text-[#848484]">
                    {repoWikis.length} wikis
                </span>
            </div>
            {/* Wiki detail */}
            <div className="flex-1 min-h-0">
                {selectedWiki && selectedWiki.status === 'generating' && (
                    <div
                        className="flex items-center gap-2 px-4 py-2 bg-[#16825d]/10 border border-[#16825d]/30 rounded text-sm"
                        data-testid="wiki-generating-banner"
                    >
                        <span className="animate-spin text-[#16825d]">⟳</span>
                        <span>Wiki generation in progress…</span>
                    </div>
                )}
                {selectedWiki && selectedWiki.status === 'error' && (
                    <div
                        className="flex items-center justify-between px-4 py-2 bg-red-500/10 border border-red-500/30 rounded text-sm"
                        data-testid="wiki-error-banner"
                    >
                        <span className="text-red-400">
                            ⚠ Wiki generation failed{selectedWiki.error ? `: ${selectedWiki.error}` : '.'}
                        </span>
                        <button
                            className="text-xs text-blue-400 hover:underline"
                            data-testid="wiki-retry-btn"
                            onClick={() => handleRetryGeneration(selectedWiki.id)}
                        >
                            Retry
                        </button>
                    </div>
                )}
                {activeWikiId && (
                    <WikiDetail
                        wikiId={activeWikiId}
                        embedded
                        initialTab={activeWikiId === initialWikiId ? initialTab : null}
                        initialAdminTab={activeWikiId === initialWikiId ? initialAdminTab : null}
                        initialComponentId={activeWikiId === initialWikiId ? initialComponentId : null}
                        onHashChange={handleWikiHashChange}
                    />
                )}
            </div>
        </div>
    );
    }
}
