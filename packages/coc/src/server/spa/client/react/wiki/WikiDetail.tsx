/**
 * WikiDetail — two-pane layout for a selected wiki.
 * Left sidebar: component tree. Right: tab content (Browse, Ask, Graph, Admin).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { Badge, Button, Spinner, ResponsiveSidebar } from '../shared';
import { cn } from '../shared/cn';
import { fetchApi } from '../hooks/useApi';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { WikiComponentTree } from './WikiComponentTree';
import { WikiComponent } from './WikiComponent';
import { WikiGraph } from './WikiGraph';
import { WikiAsk } from './WikiAsk';
import { WikiAdmin } from './WikiAdmin';
import type { WikiProjectTab, WikiAdminTab } from '../types/dashboard';

interface ComponentGraph {
    components: any[];
    categories: any[];
    domains?: any[];
    project: { name: string; description: string; mainLanguage?: string };
}

interface WikiDetailProps {
    wikiId: string;
    embedded?: boolean;
    initialTab?: WikiProjectTab | null;
    initialAdminTab?: WikiAdminTab | null;
    initialComponentId?: string | null;
    onHashChange?: (path: string) => void;
}

type WikiStatus = 'loaded' | 'generating' | 'error' | 'pending';

const statusConfig: Record<WikiStatus, { label: string; badge: string }> = {
    loaded: { label: 'Ready', badge: 'completed' },
    generating: { label: 'Generating', badge: 'running' },
    error: { label: 'Error', badge: 'failed' },
    pending: { label: 'Setup Required', badge: 'warning' },
};

const WIKI_TABS: WikiProjectTab[] = ['browse', 'ask', 'graph', 'admin'];

function buildWikiHash(wikiId: string, tab: WikiProjectTab, componentId?: string | null, adminTab?: WikiAdminTab | null): string {
    const base = '#wiki/' + encodeURIComponent(wikiId);
    if (componentId) {
        return base + '/component/' + encodeURIComponent(componentId);
    }
    if (tab === 'browse') return base;
    if (tab === 'admin' && adminTab && adminTab !== 'generate') {
        return base + '/admin/' + adminTab;
    }
    return base + '/' + tab;
}

export function WikiDetail({ wikiId, embedded, initialTab, initialAdminTab, initialComponentId, onHashChange }: WikiDetailProps) {
    const { state, dispatch } = useApp();
    const { isMobile } = useBreakpoint();
    const [graph, setGraph] = useState<ComponentGraph | null>(null);
    const [loadingGraph, setLoadingGraph] = useState(true);
    const [activeTab, setActiveTab] = useState<WikiProjectTab>('browse');
    const [adminSubTab, setAdminSubTab] = useState<WikiAdminTab | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Consume initial tab from context (e.g. from hash routing or "→ Setup" CTA)
    useEffect(() => {
        if (embedded) return;
        if (state.wikiDetailInitialTab) {
            const tab = state.wikiDetailInitialTab as WikiProjectTab;
            if (WIKI_TABS.includes(tab)) {
                setActiveTab(tab);
            }
            if (state.wikiDetailInitialAdminTab) {
                setAdminSubTab(state.wikiDetailInitialAdminTab as WikiAdminTab);
            }
            dispatch({ type: 'CLEAR_WIKI_INITIAL_TAB' });
        }
    }, [state.wikiDetailInitialTab, embedded]);  // eslint-disable-line react-hooks/exhaustive-deps

    // Consume initial tab/adminTab/componentId from props when embedded
    useEffect(() => {
        if (!embedded) return;
        if (initialTab && WIKI_TABS.includes(initialTab)) {
            setActiveTab(initialTab);
        }
        if (initialAdminTab) {
            setAdminSubTab(initialAdminTab);
        }
        if (initialComponentId) {
            dispatch({ type: 'SELECT_WIKI_COMPONENT', componentId: initialComponentId });
        }
    }, [embedded, initialTab, initialAdminTab, initialComponentId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (embedded) return;
        dispatch({ type: 'SELECT_WIKI', wikiId: null });
        location.hash = '#wiki';
    }, [dispatch, embedded]);

    const changeTab = useCallback((tab: WikiProjectTab) => {
        setActiveTab(tab);
        if (tab !== 'admin') setAdminSubTab(null);
        const hash = buildWikiHash(wikiId, tab, tab === 'browse' ? state.selectedWikiComponentId : null);
        if (onHashChange) {
            onHashChange(hash.replace(/^#wiki\/[^/]+/, ''));
        } else if (!embedded) {
            location.hash = hash;
        }
    }, [wikiId, state.selectedWikiComponentId, onHashChange, embedded]);

    const handleAdminTabChange = useCallback((subTab: WikiAdminTab) => {
        setAdminSubTab(subTab);
        const hash = buildWikiHash(wikiId, 'admin', null, subTab);
        if (onHashChange) {
            onHashChange(hash.replace(/^#wiki\/[^/]+/, ''));
        } else if (!embedded) {
            location.hash = hash;
        }
    }, [wikiId, onHashChange, embedded]);

    const handleSelectComponent = useCallback((componentId: string) => {
        dispatch({ type: 'SELECT_WIKI_COMPONENT', componentId });
        const hash = buildWikiHash(wikiId, 'browse', componentId);
        if (onHashChange) {
            onHashChange(hash.replace(/^#wiki\/[^/]+/, ''));
        } else if (!embedded) {
            location.hash = hash;
        }
        setActiveTab('browse');
    }, [dispatch, wikiId, onHashChange, embedded]);

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
                if (activeTab === 'admin') {
                    return <WikiAdmin wikiId={wikiId} initialTab={adminSubTab} onTabChange={handleAdminTabChange} />;
                }
                return (
                    <div className="flex flex-col items-center justify-center h-full text-center">
                        <div className="text-4xl mb-3">⚠</div>
                        <div className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-1">Setup Required</div>
                        <div className="text-xs text-[#848484] mb-4 max-w-xs">
                            This wiki has been registered but has not been generated yet.
                        </div>
                        <Button size="sm" onClick={() => changeTab('admin')}>
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
                        }}
                    />
                );
            case 'admin':
                return <WikiAdmin wikiId={wikiId} initialTab={adminSubTab} onTabChange={handleAdminTabChange} />;
        }
    };

    return (
        <div className={cn('flex flex-col overflow-hidden', embedded ? 'h-full' : 'h-[calc(100vh-48px-56px)] md:h-[calc(100vh-48px)]')} id="view-wiki">
            {/* Top bar — only in standalone mode */}
            {!embedded && (
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
                <div className="flex gap-0.5 overflow-x-auto flex-nowrap" id="wiki-project-tabs">
                    {WIKI_TABS.map(t => (
                        <button
                            key={t}
                            className={cn(
                                'wiki-project-tab px-2.5 py-1 text-xs rounded transition-colors flex-shrink-0 whitespace-nowrap',
                                activeTab === t
                                    ? 'bg-[#0078d4] text-white active'
                                    : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            )}
                            data-wiki-project-tab={t}
                            onClick={() => changeTab(t)}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>
            )}
            {/* Compact tab bar — only in embedded mode */}
            {embedded && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <Badge status={cfg.badge}>
                    {wikiStatus === 'generating' && <Spinner size="sm" />}
                    {cfg.label}
                </Badge>
                <div className="flex-1" />
                <div className="flex gap-0.5" id="wiki-project-tabs">
                    {WIKI_TABS.map(t => (
                        <button
                            key={t}
                            className={cn(
                                'wiki-project-tab px-2.5 py-1 text-xs rounded transition-colors flex-shrink-0 whitespace-nowrap',
                                activeTab === t
                                    ? 'bg-[#0078d4] text-white active'
                                    : 'text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                            )}
                            data-wiki-project-tab={t}
                            onClick={() => changeTab(t)}
                        >
                            {t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                    ))}
                </div>
            </div>
            )}

            {/* Two-pane layout */}
            <div className="flex flex-1 min-h-0">
                {/* Left sidebar — component tree */}
                {graph && activeTab === 'browse' && (
                    <>
                        {isMobile && (
                            <button
                                data-testid="wiki-sidebar-toggle"
                                className="fixed bottom-36 right-4 z-[8000] lg:hidden w-10 h-10 rounded-full bg-[#0078d4] text-white shadow-lg flex items-center justify-center text-xs font-bold"
                                onClick={() => setSidebarOpen(true)}
                                aria-label="Open component tree"
                            >
                                ☰
                            </button>
                        )}
                        <ResponsiveSidebar
                            isOpen={sidebarOpen}
                            onClose={() => setSidebarOpen(false)}
                            width={224}
                            tabletWidth={200}
                        >
                            <WikiComponentTree
                                graph={graph}
                                selectedComponentId={selectedComponentId}
                                onSelect={(id) => { handleSelectComponent(id); setSidebarOpen(false); }}
                            />
                        </ResponsiveSidebar>
                    </>
                )}

                {/* Right content */}
                <div id="wiki-component-detail" className="flex-1 min-w-0 min-h-0 overflow-hidden">
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
                <div className="stat-card rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-center">
                    <div className="text-xs text-[#848484]">Components</div>
                    <div className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{stats.components}</div>
                </div>
                <div className="stat-card rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-center">
                    <div className="text-xs text-[#848484]">Categories</div>
                    <div className="text-xl font-semibold text-[#1e1e1e] dark:text-[#cccccc]">{stats.categories}</div>
                </div>
                <div className="stat-card rounded border border-[#e0e0e0] dark:border-[#3c3c3c] p-3 text-center">
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
