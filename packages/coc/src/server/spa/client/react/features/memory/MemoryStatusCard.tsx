/**
 * MemoryStatusCard — compact V2 memory status card for the Repo Settings
 * memory section (AC-04).
 *
 * Shows whether workspace memory V2 is enabled, a review-count badge when
 * there are pending items, and an "Open in Memory" link that navigates to
 * the unified #memory workbench with the workspace scope pre-selected.
 *
 * This card never reads or edits V1 bounded-memory state.
 */

import { useState, useEffect } from 'react';
import { memoryV2Api, type MemoryScopeInfo } from './memoryV2Api';
import { useApp } from '../../contexts/AppContext';
import { Spinner } from '../../ui';

interface MemoryStatusCardProps {
    workspaceId: string;
}

export function MemoryStatusCard({ workspaceId }: MemoryStatusCardProps) {
    const { dispatch } = useApp();
    const [scope, setScope] = useState<MemoryScopeInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        memoryV2Api.listScopes()
            .then(scopes => {
                if (cancelled) return;
                const ws = scopes.find(
                    s => s.type === 'workspace' && s.workspaceId === workspaceId,
                ) ?? null;
                setScope(ws);
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId]);

    const handleOpenInMemory = () => {
        const scopeId = scope?.id ?? `workspace:${workspaceId}`;
        dispatch({ type: 'SET_MEMORY_SCOPE', scopeId });
        location.hash = '#memory';
    };

    const reviewCount = scope?.counts?.reviewFacts ?? 0;

    return (
        <div className="space-y-3" data-testid="memory-status-card">
            {loading ? (
                <div className="flex items-center gap-2 py-1">
                    <Spinner size="sm" />
                    <span className="text-xs text-[#888]">Loading memory status…</span>
                </div>
            ) : error ? (
                <p className="text-xs text-red-500" data-testid="memory-status-error">
                    Could not load memory status: {error}
                </p>
            ) : (
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        {/* Enabled/disabled indicator */}
                        <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                scope?.enabled
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                    : 'bg-[#f0f0f0] text-[#616161] dark:bg-[#2d2d30] dark:text-[#999]'
                            }`}
                            data-testid="memory-enabled-badge"
                        >
                            <span
                                className={`inline-block w-1.5 h-1.5 rounded-full ${
                                    scope?.enabled ? 'bg-green-500' : 'bg-[#aaa]'
                                }`}
                            />
                            {scope === null ? 'Not registered' : scope.enabled ? 'Enabled' : 'Disabled'}
                        </span>

                        {/* Review count badge */}
                        {reviewCount > 0 && (
                            <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                data-testid="memory-review-badge"
                            >
                                {reviewCount} pending review
                            </span>
                        )}
                    </div>

                    {/* Open in Memory link */}
                    <button
                        type="button"
                        onClick={handleOpenInMemory}
                        className="flex-shrink-0 inline-flex items-center gap-1 h-6 px-2.5 rounded-md border border-[#d8dee4] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] text-[11.5px] text-[#1f2328] dark:text-[#e6edf3] hover:bg-[#f0f0f0] dark:hover:bg-[#2d2d30] transition-colors"
                        data-testid="open-in-memory-btn"
                    >
                        Open in Memory
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 ml-0.5" aria-hidden>
                            <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
            )}

            <p className="text-xs text-[#888] leading-relaxed">
                Memory V2 stores facts and episodes for this workspace.
                Manage the full workbench — facts, review queue, episodes, and settings — in the Memory tab.
            </p>
        </div>
    );
}
