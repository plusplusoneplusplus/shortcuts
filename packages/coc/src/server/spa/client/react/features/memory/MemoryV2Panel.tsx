/**
 * MemoryV2Panel — V2-only Memory Workbench (AC-01, AC-02, AC-03).
 *
 * Two-column layout:
 *   Left rail (200px): scope sidebar — Global first, then registered workspaces
 *   Main area (flex):  selected-scope header + tabs (Facts | Review | Episodes | Settings)
 *
 * Disabled scope → enable CTA (no V1 fallback).
 * wsId="global" is used for the global scope across all workspace-scoped routes.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Spinner } from '../../ui';
import { memoryV2Api, type MemoryScopeInfo } from './memoryV2Api';
import { MemoryV2FactsTab } from './MemoryV2FactsTab';
import { MemoryV2ReviewTab } from './MemoryV2ReviewTab';
import { MemoryV2EpisodesTab } from './MemoryV2EpisodesTab';

// ── Types ─────────────────────────────────────────────────────────────────────

export type V2Tab = 'facts' | 'review' | 'episodes' | 'settings';

// ── WipeConfirmDialog ─────────────────────────────────────────────────────────

interface WipeConfirmDialogProps {
    scopeLabel: string;
    wsId: string;
    onClose: () => void;
    onWiped: () => void;
}

function WipeConfirmDialog({ scopeLabel, wsId, onClose, onWiped }: WipeConfirmDialogProps) {
    const [wiping, setWiping] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleWipe = async () => {
        setWiping(true);
        setError(null);
        try {
            await memoryV2Api.wipe(wsId);
            onWiped();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setWiping(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
            data-testid="wipe-dialog-overlay"
        >
            <div className="bg-white dark:bg-[#252526] rounded shadow-xl p-5 w-[420px] max-w-full space-y-3">
                <h3 className="text-sm font-semibold text-red-600 dark:text-red-400">Wipe memory</h3>
                <p className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                    This will permanently delete <strong>all facts and episodes</strong> from{' '}
                    <strong>{scopeLabel}</strong>.
                </p>
                <p className="text-xs text-[#888]">This action cannot be undone.</p>
                {error && <p className="text-xs text-red-500">{error}</p>}
                <div className="flex items-center gap-2 pt-1">
                    <Button
                        className="bg-red-600 hover:bg-red-700 text-white"
                        onClick={handleWipe}
                        disabled={wiping}
                        data-testid="wipe-confirm-btn"
                    >
                        {wiping ? 'Wiping…' : 'Wipe all memory'}
                    </Button>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                </div>
            </div>
        </div>
    );
}

// ── MemoryV2SettingsTab ───────────────────────────────────────────────────────

interface MemoryV2SettingsTabProps {
    scope: MemoryScopeInfo;
    onToggleEnabled: (enabled: boolean) => Promise<void>;
    onWiped: () => void;
}

function MemoryV2SettingsTab({ scope, onToggleEnabled, onWiped }: MemoryV2SettingsTabProps) {
    const [showWipe, setShowWipe] = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [toggling, setToggling] = useState(false);
    const [toggleError, setToggleError] = useState<string | null>(null);

    const wsId = scope.type === 'global' ? 'global' : scope.workspaceId!;

    const handleToggle = async () => {
        setToggling(true);
        setToggleError(null);
        try {
            await onToggleEnabled(!scope.enabled);
        } catch (err) {
            setToggleError(err instanceof Error ? err.message : String(err));
        } finally {
            setToggling(false);
        }
    };

    const handleExport = async () => {
        setExportLoading(true);
        setExportError(null);
        try {
            const data = await memoryV2Api.exportData(wsId);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `coc-memory-${wsId}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            setExportError(err instanceof Error ? err.message : String(err));
        } finally {
            setExportLoading(false);
        }
    };

    return (
        <div className="p-4 space-y-6 max-w-md" data-testid="memory-settings-tab">
            <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#888]">Memory V2</h4>
                <div className="flex items-center gap-3">
                    <span className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">
                        {scope.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Button
                        variant={scope.enabled ? 'ghost' : 'default'}
                        size="sm"
                        onClick={handleToggle}
                        disabled={toggling}
                        data-testid="toggle-enabled-btn"
                    >
                        {toggling ? '…' : scope.enabled ? 'Disable' : 'Enable'}
                    </Button>
                </div>
                {toggleError && <p className="text-xs text-red-500">{toggleError}</p>}
                <p className="text-xs text-[#888]">
                    {scope.type === 'global'
                        ? 'Global memory is shared across all workspace chats when enabled.'
                        : 'Workspace memory stores facts specific to this repository.'}
                </p>
            </section>

            <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#888]">Data</h4>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExport}
                    disabled={exportLoading}
                    data-testid="export-btn"
                >
                    {exportLoading ? 'Exporting…' : '↓ Export JSON'}
                </Button>
                {exportError && <p className="text-xs text-red-500">{exportError}</p>}
            </section>

            <section className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#888]">Danger zone</h4>
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => setShowWipe(true)}
                    data-testid="wipe-btn"
                >
                    🗑 Wipe memory…
                </Button>
            </section>

            {showWipe && (
                <WipeConfirmDialog
                    scopeLabel={scope.label}
                    wsId={wsId}
                    onClose={() => setShowWipe(false)}
                    onWiped={() => { setShowWipe(false); onWiped(); }}
                />
            )}
        </div>
    );
}

// ── ScopeSidebar ──────────────────────────────────────────────────────────────

interface ScopeSidebarProps {
    scopes: MemoryScopeInfo[];
    selectedId: string | null;
    onSelect: (scopeId: string) => void;
}

function ScopeSidebar({ scopes, selectedId, onSelect }: ScopeSidebarProps) {
    return (
        <div className="flex flex-col h-full" data-testid="scope-sidebar">
            <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#888]">Scopes</p>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
                {scopes.map(scope => {
                    const isSelected = scope.id === selectedId;
                    const reviewCount = scope.counts?.reviewFacts ?? 0;
                    return (
                        <button
                            key={scope.id}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
                                isSelected
                                    ? 'bg-[#0078d4]/10 text-[#0078d4] font-medium'
                                    : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]'
                            }`}
                            onClick={() => onSelect(scope.id)}
                            data-scope-id={scope.id}
                            data-testid="scope-row"
                        >
                            <span className="flex-1 truncate">{scope.label}</span>
                            {reviewCount > 0 && (
                                <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold bg-amber-500 text-white flex-shrink-0">
                                    {reviewCount}
                                </span>
                            )}
                            {!scope.enabled && (
                                <span className="text-[10px] text-[#888] flex-shrink-0">off</span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ── MemoryV2Panel ─────────────────────────────────────────────────────────────

interface MemoryV2PanelProps {
    initialTab?: V2Tab;
    /** Pre-select a scope by ID (e.g. "global" or "workspace:<wsId>"). Used for deep-link navigation. */
    initialScopeId?: string | null;
    /** Called once when the initial scope has been consumed, so the parent can clear it. */
    onInitialScopeConsumed?: () => void;
}

export function MemoryV2Panel({ initialTab = 'facts', initialScopeId, onInitialScopeConsumed }: MemoryV2PanelProps) {
    const [scopes, setScopes] = useState<MemoryScopeInfo[]>([]);
    const [scopesLoading, setScopesLoading] = useState(true);
    const [scopesError, setScopesError] = useState<string | null>(null);
    const [selectedScopeId, setSelectedScopeId] = useState<string | null>(initialScopeId ?? null);
    const [activeTab, setActiveTab] = useState<V2Tab>(initialTab);
    const [contentVersion, setContentVersion] = useState(0);
    const consumedRef = useRef(false);

    const loadScopes = useCallback(async (requestedScopeId?: string | null) => {
        setScopesLoading(true);
        setScopesError(null);
        try {
            const result = await memoryV2Api.listScopes();
            setScopes(result);
            setSelectedScopeId(prev => {
                const target = requestedScopeId ?? prev;
                if (target && result.some(s => s.id === target)) return target;
                return result.length > 0 ? result[0].id : null;
            });
        } catch (err) {
            setScopesError(err instanceof Error ? err.message : String(err));
        } finally {
            setScopesLoading(false);
        }
    }, []);

    useEffect(() => { loadScopes(initialScopeId); }, [loadScopes, initialScopeId]);

    // Notify parent once the initial scope has been picked up so the parent can
    // clear its transient scope state (prevents re-applying it on re-renders).
    useEffect(() => {
        if (!scopesLoading && !consumedRef.current && onInitialScopeConsumed) {
            consumedRef.current = true;
            onInitialScopeConsumed();
        }
    }, [scopesLoading, onInitialScopeConsumed]);

    useEffect(() => { setActiveTab(initialTab); }, [initialTab]);

    const selectedScope = scopes.find(s => s.id === selectedScopeId) ?? null;
    const wsId = selectedScope?.type === 'global'
        ? 'global'
        : (selectedScope?.workspaceId ?? null);

    const handleToggleEnabled = useCallback(async (enabled: boolean) => {
        if (!selectedScope) return;
        if (selectedScope.type === 'global') {
            if (enabled) {
                await memoryV2Api.enableGlobalScope();
            } else {
                await memoryV2Api.disableGlobalScope();
            }
        } else {
            const wid = selectedScope.workspaceId!;
            if (enabled) {
                await memoryV2Api.enableWorkspaceScope(wid);
            } else {
                await memoryV2Api.disableWorkspaceScope(wid);
            }
        }
        const result = await memoryV2Api.listScopes();
        setScopes(result);
    }, [selectedScope]);

    const handleWiped = useCallback(() => {
        setContentVersion(v => v + 1);
        loadScopes();
    }, [loadScopes]);

    // ── Render ─────────────────────────────────────────────────────────────────

    if (scopesLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner />
            </div>
        );
    }

    if (scopesError) {
        return (
            <div className="flex items-center justify-center h-full p-4">
                <div className="text-center space-y-2">
                    <p className="text-sm text-red-500" data-testid="scopes-error">{scopesError}</p>
                    <Button size="sm" onClick={loadScopes}>Retry</Button>
                </div>
            </div>
        );
    }

    if (scopes.length === 0) {
        return (
            <div className="flex items-center justify-center h-full p-4">
                <p className="text-sm text-[#888]" data-testid="no-scopes-msg">
                    No memory scopes available. Register a workspace to get started.
                </p>
            </div>
        );
    }

    return (
        <div id="view-memory" className="flex h-full overflow-hidden" data-testid="memory-v2-panel">
            {/* Left rail — scope sidebar */}
            <div className="w-[200px] flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden">
                <ScopeSidebar
                    scopes={scopes}
                    selectedId={selectedScopeId}
                    onSelect={id => {
                        setSelectedScopeId(id);
                        setActiveTab('facts');
                        setContentVersion(v => v + 1);
                    }}
                />
            </div>

            {/* Main area */}
            <div className="flex-1 flex flex-col min-w-0">
                {!selectedScope ? (
                    <div className="flex items-center justify-center h-full">
                        <p className="text-sm text-[#888]">Select a scope from the sidebar.</p>
                    </div>
                ) : !selectedScope.enabled ? (
                    <div
                        className="flex flex-col items-center justify-center h-full gap-3 p-4"
                        data-testid="scope-disabled"
                    >
                        <p className="text-sm text-[#888] text-center max-w-sm">
                            Memory V2 is not enabled for <strong>{selectedScope.label}</strong>.<br />
                            Enable it to start capturing and recalling facts.
                        </p>
                        <Button
                            onClick={() => handleToggleEnabled(true)}
                            data-testid="enable-scope-btn"
                        >
                            Enable Memory
                        </Button>
                    </div>
                ) : (
                    <>
                        {/* Scope header */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                            <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate">
                                {selectedScope.label}
                            </span>
                            <span
                                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                                    selectedScope.type === 'global'
                                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                        : 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                                }`}
                                data-testid="scope-type-badge"
                            >
                                {selectedScope.type === 'global' ? 'Global' : 'Workspace'}
                            </span>
                        </div>

                        {/* Tab bar */}
                        <div className="flex items-center gap-0.5 px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                            {([
                                { id: 'facts' as V2Tab, label: 'Facts' },
                                { id: 'review' as V2Tab, label: 'Review', badge: selectedScope.counts?.reviewFacts ?? 0 },
                                { id: 'episodes' as V2Tab, label: 'Episodes' },
                                { id: 'settings' as V2Tab, label: 'Settings' },
                            ] as Array<{ id: V2Tab; label: string; badge?: number }>).map(tab => (
                                <button
                                    key={tab.id}
                                    className={`h-8 px-3 text-sm transition-colors border-b-2 flex items-center gap-1 ${
                                        activeTab === tab.id
                                            ? 'border-[#0078d4] text-[#0078d4] font-medium'
                                            : 'border-transparent text-[#616161] dark:text-[#999999] hover:text-[#1e1e1e] dark:hover:text-[#cccccc]'
                                    }`}
                                    data-tab={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                >
                                    {tab.label}
                                    {tab.badge !== undefined && tab.badge > 0 && (
                                        <span className="inline-flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                                            {tab.badge}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>

                        {/* Tab content */}
                        <div className="flex-1 overflow-hidden">
                            {activeTab === 'facts' && wsId && (
                                <MemoryV2FactsTab key={`facts-${selectedScopeId}-${contentVersion}`} wsId={wsId} />
                            )}
                            {activeTab === 'review' && wsId && (
                                <MemoryV2ReviewTab key={`review-${selectedScopeId}-${contentVersion}`} wsId={wsId} />
                            )}
                            {activeTab === 'episodes' && wsId && (
                                <MemoryV2EpisodesTab key={`episodes-${selectedScopeId}-${contentVersion}`} wsId={wsId} />
                            )}
                            {activeTab === 'settings' && (
                                <MemoryV2SettingsTab
                                    scope={selectedScope}
                                    onToggleEnabled={handleToggleEnabled}
                                    onWiped={handleWiped}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
