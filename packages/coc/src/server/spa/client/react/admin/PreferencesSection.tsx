/**
 * PreferencesSection — Admin panel card for viewing and editing user preferences.
 * Loads from GET /api/preferences and saves via PATCH /api/preferences.
 * Handles only global preferences: theme and reposSidebarCollapsed.
 * Per-repo preferences (lastModel, lastDepth, lastEffort, lastSkill, pinnedChats, archivedChats)
 * are managed via /api/workspaces/:id/preferences.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Spinner } from '../shared';
import { getApiBase } from '../utils/config';

interface UserPreferences {
    theme?: 'light' | 'dark' | 'auto';
    reposSidebarCollapsed?: boolean;
}

interface PreferencesSectionProps {
    onError: (msg: string) => void;
    onSuccess: (msg: string) => void;
}

export function PreferencesSection({ onError, onSuccess }: PreferencesSectionProps) {
    const [prefs, setPrefs] = useState<UserPreferences | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadPreferences = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(getApiBase() + '/preferences');
            if (!res.ok) throw new Error('Failed to load preferences');
            const data: UserPreferences = await res.json();
            setPrefs(data);
        } catch (err: any) {
            onError(err.message || 'Failed to load preferences');
        } finally {
            setLoading(false);
        }
    }, [onError]);

    useEffect(() => {
        loadPreferences();
    }, [loadPreferences]);

    const patchPreference = useCallback(async (patch: Partial<UserPreferences>) => {
        setSaving(true);
        try {
            const res = await fetch(getApiBase() + '/preferences', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error((body as any).error || 'Save failed');
            }
            const updated: UserPreferences = await res.json();
            setPrefs(updated);
            onSuccess('Preference saved');
        } catch (err: any) {
            onError(err.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    }, [onError, onSuccess]);

    const inputClass = 'flex-1 px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] min-h-[44px] md:min-h-0 w-full';
    const selectClass = inputClass;
    const labelClass = 'text-xs w-24 shrink-0 text-[#616161] dark:text-[#999]';

    return (
        <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 text-[#1e1e1e] dark:text-[#cccccc]">Preferences</h3>
            {loading ? (
                <div className="flex items-center gap-2 text-sm text-[#848484]"><Spinner size="sm" /> Loading…</div>
            ) : prefs === null ? (
                <div className="text-sm text-red-500">Failed to load preferences.</div>
            ) : (
                <div className="space-y-3">
                    {/* Theme */}
                    <div className="flex flex-col md:flex-row items-start md:items-center gap-2">
                        <label className={labelClass}>Theme</label>
                        <select
                            className={selectClass}
                            value={prefs.theme ?? 'auto'}
                            disabled={saving}
                            onChange={e => patchPreference({ theme: e.target.value as UserPreferences['theme'] })}
                            data-testid="pref-theme"
                        >
                            <option value="auto">auto</option>
                            <option value="light">light</option>
                            <option value="dark">dark</option>
                        </select>
                    </div>

                    {/* Repos Sidebar Collapsed */}
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm text-[#1e1e1e] dark:text-[#cccccc]">Repos sidebar collapsed</div>
                            <div className="text-xs text-[#616161] dark:text-[#999]">Whether the repos sidebar is collapsed on load.</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={prefs.reposSidebarCollapsed ?? false}
                                disabled={saving}
                                onChange={e => patchPreference({ reposSidebarCollapsed: e.target.checked })}
                                data-testid="pref-repos-sidebar-collapsed"
                            />
                            <div className="w-9 h-5 bg-gray-300 dark:bg-gray-600 peer-focus:ring-2 peer-focus:ring-[#0078d4] rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0078d4]" />
                        </label>
                    </div>

                    <div className="text-xs text-[#616161] dark:text-[#999]">
                        Per-repo preferences (model, depth, effort, skill, pinned/archived chats) are managed per workspace.
                    </div>
                </div>
            )}
        </Card>
    );
}
