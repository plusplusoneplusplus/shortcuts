/**
 * RepoInfoTab — metadata grid and recent processes for a workspace.
 */

import { useState, useEffect } from 'react';
import type { RepoData } from './repoGrouping';
import { fetchApi } from '../hooks/useApi';
import { formatRelativeTime } from '../utils/format';

interface RepoInfoTabProps {
    repo: RepoData;
}

interface LastModelsByMode {
    task?: string;
    ask?: string;
    plan?: string;
}

interface LastSkillsByMode {
    task?: string;
    ask?: string;
    plan?: string;
}

interface PerRepoPreferences {
    lastModel?: string;
    lastModels?: LastModelsByMode;
    lastDepth?: 'deep' | 'normal';
    lastEffort?: 'low' | 'medium' | 'high';
    lastSkills?: LastSkillsByMode;
    recentFollowPrompts?: { type: string; name: string; timestamp: number }[];
}

const STATUS_ICON: Record<string, string> = {
    running: '⏳', completed: '✓', failed: '✗', cancelled: '🚫', queued: '⏳',
};

export function RepoInfoTab({ repo }: RepoInfoTabProps) {
    const ws = repo.workspace;
    const color = ws.color || '#848484';
    const branch = repo.gitInfo?.branch || 'n/a';
    const dirty = repo.gitInfo?.dirty ? ' (dirty)' : '';
    const ahead = repo.gitInfo?.ahead ?? 0;
    const behind = repo.gitInfo?.behind ?? 0;
    const syncLabel = (ahead === 0 && behind === 0)
        ? 'synced'
        : [ahead > 0 ? `↑ ${ahead} ahead` : '', behind > 0 ? `↓ ${behind} behind` : '']
            .filter(Boolean).join(' · ');
    const stats = repo.stats || { success: 0, failed: 0, running: 0 };
    const remoteUrl = ws.remoteUrl || repo.gitInfo?.remoteUrl || null;

    const [processes, setProcesses] = useState<any[]>([]);
    const [loadingProcesses, setLoadingProcesses] = useState(true);

    const [preferences, setPreferences] = useState<PerRepoPreferences | null>(null);
    const [loadingPreferences, setLoadingPreferences] = useState(true);
    const [preferencesError, setPreferencesError] = useState<string | null>(null);

    useEffect(() => {
        setLoadingProcesses(true);
        fetchApi(`/processes?workspace=${encodeURIComponent(ws.id)}&limit=10`)
            .then(res => setProcesses(res?.processes || []))
            .catch(() => setProcesses([]))
            .finally(() => setLoadingProcesses(false));
    }, [ws.id]);

    useEffect(() => {
        setLoadingPreferences(true);
        setPreferencesError(null);
        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/preferences`)
            .then(res => setPreferences(res ?? {}))
            .catch((err: unknown) => setPreferencesError(err instanceof Error ? err.message : 'Failed to load preferences'))
            .finally(() => setLoadingPreferences(false));
    }, [ws.id]);

    return (
        <div className="p-4 flex flex-col gap-4">
            {/* Metadata grid */}
            <div className="meta-grid grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <MetaRow label="Path" value={ws.rootPath || ''} mono valueClass="meta-path" />
                <MetaRow label="Branch" value={branch + dirty} />
                <MetaRow label="Sync" value={syncLabel} />
                {remoteUrl && <MetaRow label="Remote" value={remoteUrl} mono />}
                <MetaRow label="Color">
                    <span className="flex items-center gap-1.5">
                        <span className="repo-color-dot inline-block w-3 h-3 rounded-full" style={{ background: color }} />
                        {color}
                    </span>
                </MetaRow>
                <MetaRow label="Workflows" value={String(repo.workflows?.length || 0)} />
                <MetaRow label="Plans" value={String(repo.taskCount || 0)} />
                <MetaRow label="Completed" value={String(stats.success)} />
                <MetaRow label="Failed" value={String(stats.failed)} />
                <MetaRow label="Running" value={String(stats.running)} />
            </div>

            {/* Recent processes */}
            <div>
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Recent Processes</h3>
                {loadingProcesses ? (
                    <div id="repo-processes-list" className="text-xs text-[#848484]">Loading...</div>
                ) : processes.length === 0 ? (
                    <div id="repo-processes-list" className="text-xs text-[#848484]">No processes yet</div>
                ) : (
                    <div id="repo-processes-list" className="flex flex-col gap-0.5">
                        {processes.map(p => {
                            const icon = STATUS_ICON[p.status] || '•';
                            const title = p.promptPreview || p.id || 'Untitled';
                            const display = title.length > 50 ? title.substring(0, 50) + '...' : title;
                            const time = p.startTime ? formatRelativeTime(p.startTime) : '';
                            return (
                                <div key={p.id} className="repo-process-entry flex items-center gap-2 py-1 text-xs">
                                    <span>{icon}</span>
                                    <span className="flex-1 truncate text-[#1e1e1e] dark:text-[#cccccc]">{display}</span>
                                    <span className="text-[#848484] text-[11px] flex-shrink-0">{time}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Preferences */}
            <div id="repo-preferences-section">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Preferences</h3>
                {loadingPreferences ? (
                    <div className="text-xs text-[#848484]">Loading...</div>
                ) : preferencesError ? (
                    <div className="text-xs text-red-500">{preferencesError}</div>
                ) : !preferences || Object.keys(preferences).length === 0 || (
                    !preferences.lastModels?.task &&
                    !preferences.lastModels?.ask &&
                    !preferences.lastModel &&
                    !preferences.lastDepth &&
                    !preferences.lastEffort &&
                    !(preferences.lastSkills?.task || preferences.lastSkills?.ask || preferences.lastSkills?.plan) &&
                    !preferences.recentFollowPrompts?.length
                ) ? (
                    <div className="text-xs text-[#848484]" id="repo-preferences-empty">No preferences set</div>
                ) : (
                    <div className="meta-grid grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" id="repo-preferences-grid">
                        <MetaRow label="Task Model" value={preferences.lastModels?.task || preferences.lastModel || 'default'} />
                        <MetaRow label="Ask Model" value={preferences.lastModels?.ask || preferences.lastModel || 'default'} />
                        <MetaRow label="Depth" value={preferences.lastDepth || 'default'} />
                        <MetaRow label="Effort" value={preferences.lastEffort || 'default'} />
                        <MetaRow label="Task Skill" value={preferences.lastSkills?.task || 'none'} />
                        <MetaRow label="Ask Skill" value={preferences.lastSkills?.ask || 'none'} />
                        <MetaRow label="Plan Skill" value={preferences.lastSkills?.plan || 'none'} />
                        <MetaRow label="Recent Prompts" value={String(preferences.recentFollowPrompts?.length ?? 0)} />
                    </div>
                )}
            </div>
        </div>
    );
}

function MetaRow({ label, value, mono, children, valueClass }: { label: string; value?: string; mono?: boolean; children?: React.ReactNode; valueClass?: string }) {
    return (
        <span className="meta-item contents">
            <span className="text-[#848484] text-xs font-medium">{label}</span>
            {children ?? (
                <span className={`text-[#1e1e1e] dark:text-[#cccccc] text-xs ${mono ? 'font-mono break-all' : ''} ${valueClass ?? ''}`.trim()}>
                    {value}
                </span>
            )}
        </span>
    );
}
