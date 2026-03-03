import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Button } from '../shared';
import { fetchApi } from '../hooks/useApi';
import { WikiDetail } from '../wiki/WikiDetail';
import type { WikiProjectTab, WikiAdminTab } from '../types/dashboard';

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

    const repoWikis = useMemo(() => {
        const filtered = state.wikis.filter((w: any) => w.repoPath === workspacePath);
        return filtered.sort((a: any, b: any) =>
            (b.generatedAt || '').localeCompare(a.generatedAt || '')
        );
    }, [state.wikis, workspacePath]);

    const [selectedWikiId, setSelectedWikiId] = useState<string | null>(initialWikiId ?? null);
    const activeWikiId = selectedWikiId || repoWikis[0]?.id || null;

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
        const res = await fetchApi('/api/wikis', {
            method: 'POST',
            body: JSON.stringify({ repoPath: workspacePath }),
        });
        if (res.ok) {
            const wiki = await res.json();
            location.hash = '#wiki/' + encodeURIComponent(wiki.id) + '/admin';
        }
    }, [workspacePath]);

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
            <WikiDetail
                wikiId={repoWikis[0].id}
                embedded
                initialTab={initialTab}
                initialAdminTab={initialAdminTab}
                initialComponentId={initialComponentId}
                onHashChange={handleWikiHashChange}
            />
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
