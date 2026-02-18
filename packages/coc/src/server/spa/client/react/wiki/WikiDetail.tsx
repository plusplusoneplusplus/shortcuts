/**
 * WikiDetail — two-pane layout for a selected wiki.
 * Left sidebar: component tree. Right: tab content (Browse, Ask, Graph, Admin).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Badge, Button, Spinner } from '../shared';
import { cn } from '../shared/cn';
import { fetchApi } from '../hooks/useApi';
import { WikiComponentTree } from './WikiComponentTree';
import { WikiComponent } from './WikiComponent';
import { WikiGraph } from './WikiGraph';
import { WikiAsk } from './WikiAsk';
import { WikiAdmin } from './WikiAdmin';

type WikiProjectTab = 'browse' | 'ask' | 'graph' | 'admin';

interface ComponentGraph {
    components: any[];
    categories: any[];
    domains?: any[];
    project: { name: string; description: string; mainLanguage?: string };
}

interface WikiDetailProps {
    wikiId: string;
}

type WikiStatus = 'loaded' | 'generating' | 'error' | 'pending';

const statusConfig: Record<WikiStatus, { label: string; badge: string }> = {
    loaded: { label: 'Ready', badge: 'completed' },
    generating: { label: 'Generating', badge: 'running' },
    error: { label: 'Error', badge: 'failed' },
    pending: { label: 'Setup Required', badge: 'warning' },
};

export function WikiDetail({ wikiId }: WikiDetailProps) {
    const { state, dispatch } = useApp();
    const [graph, setGraph] = useState<ComponentGraph | null>(null);
    const [loadingGraph, setLoadingGraph] = useState(true);
    const [activeTab, setActiveTab] = useState<WikiProjectTab>('browse');

    // Consume initial tab from context (e.g. from "→ Setup" CTA on pending wiki cards)
    useEffect(() => {
        if (state.wikiDetailInitialTab) {
            const tab = state.wikiDetailInitialTab as WikiProjectTab;
            if (['browse', 'ask', 'graph', 'admin'].includes(tab)) {
                setActiveTab(tab);
            }
            dispatch({ type: 'SELECT_WIKI', wikiId: wikiId });
        }
    }, []);  // eslint-disable-line react-hooks/exhaustive-deps

    const wiki = useMemo(
        () => state.wikis.find((w: any) => w.id === wikiId),
        [state.wikis, wikiId]
    );

    const wikiName = wiki?.name || wiki?.title || wikiId;
    const wikiStatus: WikiStatus = wiki?.status || (wiki?.loaded ? 'loaded' : 'pending');
    const cfg = statusConfig[wikiStatus];

    // Fetch graph
    useEffect(() => {
        setLoadingGraph(true);
        fetchApi('/wikis/' + encodeURIComponent(wikiId) + '/graph')
            .then(data => setGraph(data))
            .catch(() => setGraph(null))
            .finally(() => setLoadingGraph(false));
    }, [wikiId]);

    const handleBack = useCallback(() => {
        dispatch({ type: 'SELECT_WIKI', wikiId: null });
        location.hash = '#wiki';
    }, [dispatch]);

    const handleSelectComponent = useCallback((componentId: string) => {
        dispatch({ type: 'SELECT_WIKI_COMPONENT', componentId });
        location.hash = '#wiki/' + encodeURIComponent(wikiId) + '/component/' + encodeURIComponent(componentId);
        setActiveTab('browse');
    }, [dispatch, wikiId]);

    const selectedComponentId = state.selectedWikiComponentId;

    // Tab content
    const renderContent = () => {
        if (loadingGraph) {
            return (
                <div className="flex items-center justify-center h-full">
                    <Spinner size="lg" />
                </div>
            );
        }

        if (!graph) {
            if (wikiStatus === 'pending') {
                return (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <div className="text-4xl mb-3">⚠</div>
                        <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Setup Required</div>
                        <div className="text-xs text-[#848484] mb-4 max-w-xs">
                            This wiki has been registered but has not been generated yet.
                        </div>
                        <Button size="sm" onClick={() => setActiveTab('admin')}>
                            → Run Setup Wizard
                        </Button>
                    </div>
                );
            }
            return (
                <div className="flex items-center justify-center h-full text-sm text-[#848484]">
                    No graph data available. Try generating the wiki first.
                </div>
            );
        }

        switch (activeTab) {
            case 'browse':
                if (selectedComponentId) {
                    return (
                        <WikiComponent
                            wikiId={wikiId}
                            componentId={selectedComponentId}
                            graph={graph}
                            onSelectComponent={handleSelectComponent}
                        />
                    );
                }
                return <ProjectOverview graph={graph} onSelectComponent={handleSelectComponent} />;
            case 'ask':
                return (
                    <WikiAsk
                        wikiId={wikiId}
                        wikiName={wikiName}
                        currentComponentId={selectedComponentId}
                    />
                );
            case 'graph':
                return (
                    <WikiGraph
                        wikiId={wikiId}
                        graph={graph}
                        onSelectComponent={(id) => {
                            handleSelectComponent(id);
                            setActiveTab('browse');
                        }}
                    />
                );
            case 'admin':
                return <WikiAdmin wikiId={wikiId} />;
        }
    };

    return (
        <div className="flex flex-col h-full" id="view-wiki">
            {/* Top bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <button
                    className="text-sm text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]"
                    onClick={handleBack}
                    title="Back to wiki list"
                >←</button>
                <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: wiki?.color || '#848484' }}
                />
                <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate" id="wiki-project-title">
                    {wikiName}
                </h2>
                <Badge status={cfg.badge}>
                    {wikiStatus === 'generating' && <Spinner size="sm" />}
                    {cfg.label}
                </Badge>
                <div className="flex-1" />
                {/* Tab bar */}
                <div className="flex gap-0.5" id="wiki-project-tabs">
                    {(['browse', 'ask', 'graph', 'admin'] as WikiProjectTab[]).map(t => (
                        <button
                            key={t}
                            className={cn(
                                'wiki-project-tab px-2.5 py-1 text-xs rounded transition-colors',
                                activeTab === t
                                    ? 'bg-[#0078d4] text-white active'
                                    : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            )}
                            data-wiki-project-tab={t}
                            onClick={() => setActiveTab(t)}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>

            {/* Two-pane layout */}
            <div className="flex flex-1 min-h-0">
                {/* Left sidebar — component tree */}
                {graph && activeTab === 'browse' && (
                    <div className="w-56 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden">
                        <WikiComponentTree
                            graph={graph}
                            selectedComponentId={selectedComponentId}
                            onSelect={handleSelectComponent}
                        />
                    </div>
                )}

                {/* Right content */}
                <div className="flex-1 min-w-0 overflow-hidden">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}

// ── Project Overview (no component selected) ────────────────────────

function ProjectOverview({ graph, onSelectComponent }: { graph: ComponentGraph; onSelectComponent: (id: string) => void }) {
    const stats = {
        components: graph.components.length,
        categories: (graph.categories || []).length,
        language: graph.project.mainLanguage || 'N/A',
    };

    const hasDomains = graph.domains && graph.domains.length > 0;

    return (
        <div className="p-4 overflow-y-auto h-full">
            <h1 className="text-lg font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">{graph.project.name}</h1>
            <p className="text-sm text-[#848484] mb-4">{graph.project.description}</p>

            <div className="grid grid-cols-3 gap-3 mb-6">
                <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-center">
                    <div className="text-xs text-[#848484]">Components</div>
                    <div className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{stats.components}</div>
                </div>
                <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-center">
                    <div className="text-xs text-[#848484]">Categories</div>
                    <div className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{stats.categories}</div>
                </div>
                <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-center">
                    <div className="text-xs text-[#848484]">Language</div>
                    <div className="text-lg font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{stats.language}</div>
                </div>
            </div>

            {hasDomains ? (
                <>
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Domains</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {graph.domains!.filter(d => (d.components || []).length > 0).map(domain => (
                            <div
                                key={domain.id}
                                className="component-card wiki-component-card rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 cursor-pointer hover:border-[#0078d4]"
                            >
                                <h4 className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                                    {domain.name} <span className="text-[#848484] font-normal">({(domain.components || []).length})</span>
                                </h4>
                                {domain.description && <p className="text-xs text-[#848484] mt-1">{domain.description}</p>}
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <>
                    <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Components</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {graph.components.map(comp => (
                            <div
                                key={comp.id}
                                className="component-card wiki-component-card rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 cursor-pointer hover:border-[#0078d4]"
                                data-component-id={comp.id}
                                onClick={() => onSelectComponent(comp.id)}
                            >
                                <h4 className="text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc]">
                                    {comp.name}
                                    {comp.complexity && (
                                        <span className={cn(
                                            'ml-1 text-[10px] px-1 py-0.5 rounded',
                                            comp.complexity === 'low' && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                                            comp.complexity === 'medium' && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
                                            comp.complexity === 'high' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                                        )}>
                                            {comp.complexity}
                                        </span>
                                    )}
                                </h4>
                                <p className="text-xs text-[#848484] mt-1 line-clamp-2">{comp.purpose}</p>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
