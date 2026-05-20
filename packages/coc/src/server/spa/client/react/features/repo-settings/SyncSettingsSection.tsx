/**
 * SyncSettingsSection — Per-workspace sync configuration for virtual workspaces
 * (My Work / My Life). Shows git remote URL, sync interval, status pill, and
 * manual trigger button. Settings are stored in PerRepoPreferences.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useGlobalToast } from '../../contexts/ToastContext';
import type { SyncStatus } from '@plusplusoneplusplus/coc-client';

const labelClass = 'text-xs w-28 shrink-0 text-[#616161] dark:text-[#999]';
const inputClass =
    'flex-1 px-2 py-0.5 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]';
const sectionHeadClass =
    'text-xs font-semibold text-[#616161] dark:text-[#999] uppercase tracking-wide mb-2';
const POLL_INTERVAL_MS = 30_000;

interface SyncSettingsSectionProps {
    workspaceId: string;
}

export function SyncSettingsSection({ workspaceId }: SyncSettingsSectionProps) {
    const { addToast } = useGlobalToast();
    const [gitRemote, setGitRemote] = useState('');
    const [intervalMinutes, setIntervalMinutes] = useState('5');
    const [saving, setSaving] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [snapshot, setSnapshot] = useState({ gitRemote: '', intervalMinutes: '5' });
    const mountedRef = useRef(true);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchStatus = useCallback(async () => {
        try {
            const data = await getSpaCocClient().sync.getStatus(workspaceId);
            if (mountedRef.current) setStatus(data);
        } catch {
            // Sync may not be configured yet
        }
    }, [workspaceId]);

    // Load current preferences and start status polling
    useEffect(() => {
        mountedRef.current = true;
        // Load per-workspace sync preferences
        getSpaCocClient().preferences.getRepo(workspaceId)
            .then(prefs => {
                if (!mountedRef.current) return;
                const sync = (prefs as Record<string, unknown>)?.sync as { gitRemote?: string; intervalMinutes?: number } | undefined;
                const remote = sync?.gitRemote ?? '';
                const interval = String(sync?.intervalMinutes ?? 5);
                setGitRemote(remote);
                setIntervalMinutes(interval);
                setSnapshot({ gitRemote: remote, intervalMinutes: interval });
            })
            .catch(() => {});
        fetchStatus();
        timerRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
        return () => {
            mountedRef.current = false;
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [workspaceId, fetchStatus]);

    const dirty = gitRemote !== snapshot.gitRemote || intervalMinutes !== snapshot.intervalMinutes;

    const handleSave = useCallback(async () => {
        const interval = Number(intervalMinutes);
        if (intervalMinutes.trim() !== '' && (isNaN(interval) || !Number.isInteger(interval) || interval < 1)) {
            addToast('Sync interval must be a positive integer', 'error');
            return;
        }
        setSaving(true);
        try {
            await getSpaCocClient().preferences.patchRepo(workspaceId, {
                sync: {
                    gitRemote,
                    intervalMinutes: interval || 5,
                },
            });
            addToast('Sync settings saved', 'success');
            setSnapshot({ gitRemote, intervalMinutes });
            fetchStatus();
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Save failed'), 'error');
        } finally {
            setSaving(false);
        }
    }, [workspaceId, gitRemote, intervalMinutes, addToast, fetchStatus]);

    const handleCancel = useCallback(() => {
        setGitRemote(snapshot.gitRemote);
        setIntervalMinutes(snapshot.intervalMinutes);
    }, [snapshot]);

    const handleTriggerSync = useCallback(async () => {
        setTriggering(true);
        try {
            const result = await getSpaCocClient().sync.trigger(workspaceId);
            setStatus(result);
            if (result.lastError) {
                addToast(`Sync error: ${result.lastError}`, 'error');
            } else {
                addToast('Sync completed', 'success');
            }
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Sync trigger failed'), 'error');
        } finally {
            setTriggering(false);
        }
    }, [workspaceId, addToast]);

    return (
        <div className="flex flex-col gap-4" data-testid="sync-settings-section">
            <p className={sectionHeadClass}>Git Sync</p>

            {/* Git Remote URL */}
            <div className="flex items-start gap-2">
                <span className={labelClass}>Git Remote</span>
                <input
                    className={`${inputClass} w-full`}
                    type="text"
                    value={gitRemote}
                    onChange={e => setGitRemote(e.target.value)}
                    placeholder="git@github.com:user/my-coc-notes.git"
                    data-testid="input-sync-git-remote"
                />
            </div>

            {/* Sync Interval */}
            <div className="flex items-start gap-2">
                <span className={labelClass}>Interval</span>
                <div className="flex items-center gap-1">
                    <input
                        className={`${inputClass}`}
                        type="number"
                        min={1}
                        value={intervalMinutes}
                        onChange={e => setIntervalMinutes(e.target.value)}
                        style={{ width: 70 }}
                        data-testid="input-sync-interval"
                    />
                    <span className="text-xs text-[#616161] dark:text-[#999]">min</span>
                </div>
            </div>

            {/* Save / Cancel */}
            {dirty && (
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="px-3 py-1 text-xs font-medium rounded bg-[#1f883d] text-white hover:bg-[#1a7f37] disabled:opacity-50"
                        onClick={handleSave}
                        disabled={saving}
                        data-testid="btn-sync-save"
                    >
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                        type="button"
                        className="px-3 py-1 text-xs font-medium rounded border border-[#d0d7de] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a]"
                        onClick={handleCancel}
                        data-testid="btn-sync-cancel"
                    >
                        Cancel
                    </button>
                </div>
            )}

            {/* Status */}
            {status && (
                <div className="flex items-start gap-2">
                    <span className={labelClass}>Status</span>
                    <div className="flex items-center gap-2">
                        <StatusPill status={status} />
                        {status.enabled && (
                            <button
                                type="button"
                                className="px-2 py-0.5 text-xs font-medium rounded border border-[#d0d7de] dark:border-[#3c3c3c] text-[#656d76] dark:text-[#999] hover:bg-[#f6f8fa] dark:hover:bg-[#2a2a2a] disabled:opacity-50"
                                onClick={handleTriggerSync}
                                disabled={triggering || status.inProgress}
                                data-testid="btn-sync-trigger"
                            >
                                {triggering ? 'Syncing…' : 'Sync Now'}
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Last sync info */}
            {status?.lastSyncTime && (
                <div className="flex items-start gap-2">
                    <span className={labelClass}>Last Sync</span>
                    <span className="text-xs text-[#656d76] dark:text-[#999]">
                        {new Date(status.lastSyncTime).toLocaleString()}
                    </span>
                </div>
            )}
            {status?.lastError && (
                <div className="flex items-start gap-2">
                    <span className={labelClass}>Error</span>
                    <span className="text-xs text-[#cf222e] dark:text-[#f85149]">{status.lastError}</span>
                </div>
            )}
        </div>
    );
}

function StatusPill({ status }: { status: SyncStatus }) {
    if (status.inProgress) {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[#fff8c5] dark:bg-[#3d2e00] text-[#9a6700] dark:text-[#d29922]" data-testid="sync-status-pill">⟳ Syncing…</span>;
    }
    if (status.lastError) {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[#ffebe9] dark:bg-[#3d1c1c] text-[#cf222e] dark:text-[#f85149]" data-testid="sync-status-pill">✗ Error</span>;
    }
    if (status.enabled) {
        return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[#dafbe1] dark:bg-[#1a3524] text-[#1a7f37] dark:text-[#3fb950]" data-testid="sync-status-pill">✓ OK</span>;
    }
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-[#f6f8fa] dark:bg-[#2a2a2a] text-[#656d76] dark:text-[#999]" data-testid="sync-status-pill">○ Disabled</span>;
}
