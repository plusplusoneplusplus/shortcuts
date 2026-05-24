/**
 * MemoryV2Panel — redesigned Memory panel (AC-06).
 *
 * Two-column layout:
 *   Left rail  (200px): scope pill, mode toggle (global/isolated), wipe/export actions
 *   Right area (flex):  tabs: Facts | Review (with badge) | Episodes
 *
 * Shown when `prefs.memoryV2.enabled === true` for the selected workspace.
 * Falls back to a "no workspace selected" or "not enabled" message otherwise.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, Spinner } from '../../ui';
import { useApp } from '../../contexts/AppContext';
import { getWorkspacePreferences, patchWorkspacePreferences } from '../../hooks/preferences/preferencesApi';
import { memoryV2Api } from './memoryV2Api';
import { MemoryV2FactsTab } from './MemoryV2FactsTab';
import { MemoryV2ReviewTab } from './MemoryV2ReviewTab';
import { MemoryV2EpisodesTab } from './MemoryV2EpisodesTab';

// ── Types ─────────────────────────────────────────────────────────────────────

type V2Tab = 'facts' | 'review' | 'episodes';

interface MemoryV2Prefs {
    enabled: boolean;
    isolated?: boolean;
    frozenSnapshotLimit?: number;
    recallLimit?: number;
}

// ── ScopePill ─────────────────────────────────────────────────────────────────

interface ScopePillProps {
    isolated: boolean;
}

function ScopePill({ isolated }: ScopePillProps) {
    return (
        <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${isolated
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
            }`}
            data-testid="scope-pill"
        >
            {isolated ? '🔒 Isolated workspace memory' : '🌐 Global memory'}
        </span>
    );
}

// ── WipeConfirmDialog ─────────────────────────────────────────────────────────

interface WipeConfirmDialogProps {
    wsId: string;
    isolated: boolean;
    onClose: () => void;
    onWiped: () => void;
}

function WipeConfirmDialog({ wsId, isolated, onClose, onWiped }: WipeConfirmDialogProps) {
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

    const scopeLabel = isolated ? "this workspace's isolated memory" : 'global memory (shared by all workspaces)';

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
                <p className="text-xs text-[#888]">
                    This action cannot be undone. Only the active scope is deleted.
                </p>
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

// ── MemoryV2Panel ─────────────────────────────────────────────────────────────

export function MemoryV2Panel() {
    const { state } = useApp();
    const wsId = state.selectedRepoId;

    const [prefs, setPrefs] = useState<MemoryV2Prefs | null>(null);
    const [prefsLoading, setPrefsLoading] = useState(false);
    const [prefsError, setPrefsError] = useState<string | null>(null);
    const [savingIsolated, setSavingIsolated] = useState(false);

    const [activeTab, setActiveTab] = useState<V2Tab>('facts');
    const [reviewCount, setReviewCount] = useState(0);

    const [showWipeDialog, setShowWipeDialog] = useState(false);
    const [exportLoading, setExportLoading] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    // Load prefs
    const loadPrefs = useCallback(async () => {
        if (!wsId) return;
        setPrefsLoading(true);
        setPrefsError(null);
        try {
            const p = await getWorkspacePreferences(wsId);
            const v2 = (p as any).memoryV2 as MemoryV2Prefs | undefined;
            setPrefs(v2 ?? { enabled: false });
        } catch (err) {
            setPrefsError(err instanceof Error ? err.message : String(err));
        } finally {
            setPrefsLoading(false);
        }
    }, [wsId]);

    useEffect(() => { loadPrefs(); }, [loadPrefs]);

    // Load review count for badge
    const loadReviewCount = useCallback(async () => {
        if (!wsId || !prefs?.enabled) return;
        try {
            const items = await memoryV2Api.listReview(wsId);
            setReviewCount(items.length);
        } catch {
            setReviewCount(0);
        }
    }, [wsId, prefs?.enabled]);

    useEffect(() => { loadReviewCount(); }, [loadReviewCount]);

    // Toggle isolated mode
    const handleToggleIsolated = async () => {
        if (!wsId || !prefs) return;
        setSavingIsolated(true);
        try {
            const newIsolated = !prefs.isolated;
            await patchWorkspacePreferences(wsId, { memoryV2: { ...prefs, isolated: newIsolated } } as any);
            setPrefs(p => p ? { ...p, isolated: newIsolated } : p);
        } catch (err) {
            setPrefsError(err instanceof Error ? err.message : String(err));
        } finally {
            setSavingIsolated(false);
        }
    };

    // Enable memory v2
    const handleEnable = async () => {
        if (!wsId) return;
        try {
            await patchWorkspacePreferences(wsId, { memoryV2: { enabled: true } } as any);
            setPrefs({ enabled: true });
        } catch (err) {
            setPrefsError(err instanceof Error ? err.message : String(err));
        }
    };

    // Export
    const handleExport = async () => {
        if (!wsId) return;
        setExportLoading(true);
        setExportError(null);
        try {
            const data = await memoryV2Api.exportData(wsId);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `coc-memory-export-${new Date().toISOString().slice(0, 10)}.json`;
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

    const handleWiped = () => {
        setShowWipeDialog(false);
        // Reload the active tab data by re-mounting via key change
        setActiveTab(t => t);
        setReviewCount(0);
    };

    // ── Render guards ──────────────────────────────────────────────────────────

    if (!wsId) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-sm text-[#888]" data-testid="no-workspace-msg">
                    Select a workspace to use Memory v2.
                </p>
            </div>
        );
    }

    if (prefsLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spinner />
            </div>
        );
    }

    if (prefsError) {
        return (
            <div className="flex items-center justify-center h-full p-4">
                <p className="text-sm text-red-500" data-testid="prefs-error">{prefsError}</p>
            </div>
        );
    }

    if (!prefs?.enabled) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-4" data-testid="v2-disabled">
                <p className="text-sm text-[#888] text-center max-w-sm">
                    Memory v2 is not enabled for this workspace.<br />
                    Enable it to start capturing and recalling facts and episodes.
                </p>
                <Button onClick={handleEnable} data-testid="enable-memory-v2-btn">
                    Enable Memory v2
                </Button>
            </div>
        );
    }

    const isolated = prefs.isolated === true;

    // ── Main layout ────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full overflow-hidden" data-testid="memory-v2-panel">
            {/* Left rail */}
            <div className="w-[200px] flex-shrink-0 flex flex-col gap-3 p-3 border-r border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto">
                {/* Scope pill */}
                <ScopePill isolated={isolated} />

                {/* Isolated mode toggle */}
                <div className="space-y-1">
                    <p className="text-[11px] font-medium text-[#888] uppercase tracking-wide">Scope</p>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isolated}
                            onChange={handleToggleIsolated}
                            disabled={savingIsolated}
                            className="h-3.5 w-3.5 rounded border-[#c8c8c8] text-[#0078d4]"
                            data-testid="isolated-toggle"
                        />
                        <span className="text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                            Isolated workspace
                        </span>
                    </label>
                    <p className="text-[10px] text-[#888] leading-tight">
                        {isolated
                            ? 'This workspace uses its own private memory store.'
                            : 'Facts are shared across all workspaces via global memory.'}
                    </p>
                    {savingIsolated && <Spinner />}
                </div>

                <hr className="border-[#e0e0e0] dark:border-[#3c3c3c]" />

                {/* Export */}
                <div className="space-y-1.5">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start"
                        onClick={handleExport}
                        disabled={exportLoading}
                        data-testid="export-btn"
                    >
                        {exportLoading ? 'Exporting…' : '↓ Export JSON'}
                    </Button>
                    {exportError && (
                        <p className="text-[10px] text-red-500">{exportError}</p>
                    )}
                </div>

                {/* Wipe */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                    onClick={() => setShowWipeDialog(true)}
                    data-testid="wipe-btn"
                >
                    🗑 Wipe memory…
                </Button>
            </div>

            {/* Right content area */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Tab bar */}
                <div className="flex items-center gap-0.5 px-3 pt-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                    {([
                        { id: 'facts' as V2Tab, label: 'Facts' },
                        { id: 'review' as V2Tab, label: 'Review', badge: reviewCount },
                        { id: 'episodes' as V2Tab, label: 'Episodes' },
                    ] as Array<{ id: V2Tab; label: string; badge?: number }>).map(tab => (
                        <button
                            key={tab.id}
                            className={`h-8 px-3 text-sm transition-colors border-b-2 flex items-center gap-1 ${activeTab === tab.id
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
                    {activeTab === 'facts' && <MemoryV2FactsTab wsId={wsId} />}
                    {activeTab === 'review' && (
                        <MemoryV2ReviewTab
                            wsId={wsId}
                        />
                    )}
                    {activeTab === 'episodes' && <MemoryV2EpisodesTab wsId={wsId} />}
                </div>
            </div>

            {/* Wipe confirmation dialog */}
            {showWipeDialog && (
                <WipeConfirmDialog
                    wsId={wsId}
                    isolated={isolated}
                    onClose={() => setShowWipeDialog(false)}
                    onWiped={handleWiped}
                />
            )}
        </div>
    );
}
