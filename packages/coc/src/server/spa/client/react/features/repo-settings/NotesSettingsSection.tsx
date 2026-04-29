/**
 * NotesSettingsSection — Notes preferences panel within Repo Settings.
 *
 * Shows Git Version Tracking controls:
 *   - If git not initialized: prompt to initialize via the Notes tab.
 *   - Enable/disable auto-commit toggle.
 *   - Interval dropdown (1 min to 1 hour) when auto-commit is enabled.
 *   - Last-committed timestamp and last-error display.
 */

import React, { useState, useEffect } from 'react';
import { useNotesAutoCommit } from '../notes/hooks/useNotesAutoCommit';
import { notesApi } from '../notes/notesApi';
import { useGlobalToast } from '../../contexts/ToastContext';
import { formatRelativeTime } from '../../utils/format';

// ── Shared CSS constants (mirrors RepoPreferencesSection) ────────────────────
const labelClass = 'text-xs w-28 shrink-0 text-[#616161] dark:text-[#999]';
const selectClass =
    'flex-1 px-2 py-0.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] w-full';
const sectionHeadClass =
    'text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide mb-2';

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
    { label: '1 min',  value:    60_000 },
    { label: '2 min',  value:   120_000 },
    { label: '5 min',  value:   300_000 },
    { label: '10 min', value:   600_000 },
    { label: '15 min', value:   900_000 },
    { label: '30 min', value: 1_800_000 },
    { label: '1 hour', value: 3_600_000 },
];

interface NotesSettingsSectionProps {
    workspaceId: string;
}

export function NotesSettingsSection({ workspaceId }: NotesSettingsSectionProps) {
    const { addToast } = useGlobalToast();

    const {
        autoCommitEnabled,
        intervalMs,
        lastCommittedAt,
        lastError,
        loading: autoCommitLoading,
        enabling,
        enable,
        disable,
        updateInterval,
    } = useNotesAutoCommit(workspaceId);

    const [gitInitialized, setGitInitialized] = useState<boolean | null>(null);
    const [gitStatusLoading, setGitStatusLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setGitStatusLoading(true);
        notesApi
            .getGitStatus(workspaceId)
            .then(s => { if (!cancelled) setGitInitialized(s.initialized); })
            .catch(() => { if (!cancelled) setGitInitialized(false); })
            .finally(() => { if (!cancelled) setGitStatusLoading(false); });
        return () => { cancelled = true; };
    }, [workspaceId]);

    const handleToggle = async (checked: boolean) => {
        try {
            if (checked) {
                await enable(intervalMs ?? 1_800_000);
            } else {
                await disable();
            }
        } catch (e: any) {
            addToast(e?.message ?? 'Failed to update auto-commit', 'error');
        }
    };

    const handleIntervalChange = async (ms: number) => {
        try {
            await updateInterval(ms);
        } catch (e: any) {
            addToast(e?.message ?? 'Failed to update interval', 'error');
        }
    };

    const isLoading = autoCommitLoading || gitStatusLoading;

    return (
        <div data-testid="notes-settings-section">
            <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-3">Notes</h3>

            {/* Git Version Tracking */}
            <div className={sectionHeadClass} data-testid="section-git-tracking">
                Git Version Tracking
            </div>

            {isLoading ? (
                <div className="text-xs text-[#848484]" data-testid="notes-settings-loading">
                    Loading…
                </div>
            ) : gitInitialized === false ? (
                <div
                    className="text-xs text-[#848484] p-2 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]"
                    data-testid="notes-git-not-initialized"
                >
                    Git tracking is not initialized. Go to the{' '}
                    <button
                        type="button"
                        className="text-[#0078d4] dark:text-[#3794ff] hover:underline"
                        onClick={() => {
                            location.hash =
                                '#repos/' + encodeURIComponent(workspaceId) + '/notes';
                        }}
                        data-testid="notes-git-init-link"
                    >
                        Notes tab
                    </button>{' '}
                    to initialize git tracking.
                </div>
            ) : (
                <div className="flex flex-col gap-2 mb-1">
                    {/* Enable toggle */}
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                        <label className={labelClass}>Auto-commit</label>
                        <div className="flex items-center gap-2 flex-1">
                            <input
                                type="checkbox"
                                checked={autoCommitEnabled}
                                disabled={enabling}
                                onChange={e => handleToggle(e.target.checked)}
                                className="w-4 h-4 accent-[#0078d4]"
                                data-testid="auto-commit-toggle"
                            />
                            <span className="text-xs text-[#616161] dark:text-[#999]">
                                {autoCommitEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                        </div>
                    </div>

                    {/* Interval dropdown — only shown when enabled */}
                    {autoCommitEnabled && (
                        <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                            <label className={labelClass}>Interval</label>
                            <select
                                className={selectClass}
                                value={intervalMs ?? 1_800_000}
                                onChange={e => handleIntervalChange(Number(e.target.value))}
                                data-testid="auto-commit-interval"
                            >
                                {INTERVAL_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Last committed timestamp */}
                    {autoCommitEnabled && lastCommittedAt && (
                        <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                            <label className={labelClass}>Last committed</label>
                            <span
                                className="text-xs text-[#616161] dark:text-[#999]"
                                data-testid="last-committed-at"
                            >
                                {formatRelativeTime(lastCommittedAt)}
                            </span>
                        </div>
                    )}

                    {/* Last error */}
                    {autoCommitEnabled && lastError && (
                        <div className="flex flex-col md:flex-row items-start md:items-center gap-1 md:gap-2">
                            <label className={labelClass}>Last error</label>
                            <span
                                className="text-xs text-red-500 dark:text-red-400"
                                data-testid="last-error"
                            >
                                {lastError}
                            </span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
