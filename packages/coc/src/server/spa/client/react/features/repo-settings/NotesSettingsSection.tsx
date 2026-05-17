/**
 * NotesSettingsSection — Notes preferences panel within Repo Settings.
 *
 * Shows Git Version Tracking controls:
 *   - If git not initialized: inline "Initialize Git Tracking" button.
 *   - Enable/disable auto-commit toggle.
 *   - Interval dropdown (1 min to 1 hour) when auto-commit is enabled.
 *   - Last-committed timestamp and last-error display.
 *   - Danger zone with "Disable Git Tracking" (with confirmation) when initialized.
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
    const [initBusy, setInitBusy] = useState(false);
    const [deinitBusy, setDeinitBusy] = useState(false);
    const [confirmingDeinit, setConfirmingDeinit] = useState(false);

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

    const handleInitGit = async () => {
        setInitBusy(true);
        try {
            await notesApi.initializeGit(workspaceId);
            setGitInitialized(true);
        } catch (e: any) {
            addToast(e?.message ?? 'Failed to initialize git tracking', 'error');
        } finally {
            setInitBusy(false);
        }
    };

    const handleDeinitGit = async () => {
        setDeinitBusy(true);
        try {
            // If auto-commit is on, disable it first to avoid stale state
            if (autoCommitEnabled) {
                try { await disable(); } catch { /* best effort */ }
            }
            await notesApi.deinitGit(workspaceId);
            setGitInitialized(false);
            setConfirmingDeinit(false);
            addToast('Git tracking disabled', 'success');
        } catch (e: any) {
            addToast(e?.message ?? 'Failed to disable git tracking', 'error');
        } finally {
            setDeinitBusy(false);
        }
    };

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
                    className="flex flex-col gap-2 p-3 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]"
                    data-testid="notes-git-not-initialized"
                >
                    <div className="text-xs text-[#616161] dark:text-[#cccccc]">
                        <span className="mr-1" aria-hidden>📝</span>
                        Track changes to notes with git. View history, diffs, and restore previous versions.
                    </div>
                    <div>
                        <button
                            type="button"
                            disabled={initBusy}
                            onClick={handleInitGit}
                            className="px-3 py-1 text-xs rounded bg-[#0078d4] text-white hover:bg-[#106ebe] disabled:opacity-60 disabled:cursor-not-allowed"
                            data-testid="notes-git-init-button"
                        >
                            {initBusy ? 'Initializing…' : 'Initialize Git Tracking'}
                        </button>
                    </div>
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

                    {/* Danger Zone — disable git tracking */}
                    <div className="mt-3 pt-3 border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="notes-git-danger-zone">
                        <div className={sectionHeadClass}>Danger Zone</div>
                        {!confirmingDeinit ? (
                            <div className="flex flex-col gap-1">
                                <button
                                    type="button"
                                    onClick={() => setConfirmingDeinit(true)}
                                    className="self-start px-2 py-0.5 text-xs rounded border border-transparent text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-[#3c1f1f]"
                                    data-testid="notes-git-deinit-button"
                                >
                                    Disable Git Tracking
                                </button>
                                <span className="text-xs text-[#848484]">
                                    Removes version history for notes. Notes files are kept.
                                </span>
                            </div>
                        ) : (
                            <div
                                className="flex flex-col gap-2 p-2 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-[#3c1f1f]"
                                data-testid="notes-git-deinit-confirm"
                            >
                                <span className="text-xs text-red-700 dark:text-red-300">
                                    This will remove all version history for notes in this workspace. Notes files themselves are preserved. This cannot be undone.
                                </span>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        disabled={deinitBusy}
                                        onClick={handleDeinitGit}
                                        className="px-2 py-0.5 text-xs rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                        data-testid="notes-git-deinit-confirm-button"
                                    >
                                        {deinitBusy ? 'Disabling…' : 'Yes, disable'}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={deinitBusy}
                                        onClick={() => setConfirmingDeinit(false)}
                                        className="px-2 py-0.5 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f0f0f0] dark:hover:bg-[#2a2a2a] disabled:opacity-60"
                                        data-testid="notes-git-deinit-cancel-button"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
