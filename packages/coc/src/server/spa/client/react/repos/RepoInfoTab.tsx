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
    task?: string | string[];
    ask?: string | string[];
    plan?: string | string[];
}

interface RecentFollowPrompt {
    type: string;
    name: string;
    timestamp: number;
    prompt?: string;
    skills?: string[];
    model?: string;
    mode?: 'ask' | 'task';
    description?: string;
}

interface PerRepoPreferences {
    lastModel?: string;
    lastModels?: LastModelsByMode;
    lastDepth?: 'deep' | 'normal';
    lastEffort?: 'low' | 'medium' | 'high';
    lastSkills?: LastSkillsByMode;
    recentFollowPrompts?: RecentFollowPrompt[];
}

const STATUS_ICON: Record<string, string> = {
    running: '⏳', completed: '✓', failed: '✗', cancelled: '🚫', queued: '⏳',
};

/** Format a skill value that may be a string (legacy) or string[] (new). */
function formatSkillValue(val: string | string[] | undefined): string {
    if (!val || (Array.isArray(val) && val.length === 0)) return 'none';
    if (Array.isArray(val)) return val.join(', ');
    return val || 'none';
}

/** Relative time string, e.g. "5m ago". */
function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Check if a skill value (string or string[]) has any content. */
function hasSkillValue(val: string | string[] | undefined): boolean {
    if (!val) return false;
    if (Array.isArray(val)) return val.length > 0;
    return val.length > 0;
}

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

    const [desc, setDesc] = useState(ws.description ?? '');
    const [savingDesc, setSavingDesc] = useState(false);

    const [processes, setProcesses] = useState<any[]>([]);
    const [loadingProcesses, setLoadingProcesses] = useState(true);

    const [tasksFolder, setTasksFolder] = useState<string | null>(null);

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
        fetchApi(`/workspaces/${encodeURIComponent(ws.id)}/tasks/settings`)
            .then(res => setTasksFolder(res?.taskRootPath || res?.folderPath || null))
            .catch(() => setTasksFolder(null));
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
                {tasksFolder && <MetaRow label="Tasks" value={tasksFolder} mono />}
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

            {/* Description */}
            <div id="repo-description-section">
                <h3 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] mb-2">Description</h3>
                <textarea
                    id="repo-description-textarea"
                    className="w-full text-xs text-[#1e1e1e] dark:text-[#cccccc] bg-transparent border border-[#848484]/40 rounded px-2 py-1.5 resize-none focus:outline-none focus:border-[#0078d4] dark:focus:border-[#3794ff]"
                    rows={3}
                    placeholder="Add a description for this repo…"
                    value={desc}
                    onChange={e => setDesc(e.target.value)}
                    onBlur={async () => {
                        if (desc === (ws.description ?? '')) return;
                        setSavingDesc(true);
                        try {
                            await fetchApi(`/workspaces/${encodeURIComponent(ws.id)}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ description: desc }),
                            });
                        } finally {
                            setSavingDesc(false);
                        }
                    }}
                    disabled={savingDesc}
                />
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
                    !hasSkillValue(preferences.lastSkills?.task) &&
                    !hasSkillValue(preferences.lastSkills?.ask) &&
                    !hasSkillValue(preferences.lastSkills?.plan) &&
                    !preferences.recentFollowPrompts?.length
                ) ? (
                    <div className="text-xs text-[#848484]" id="repo-preferences-empty">No preferences set</div>
                ) : (
                    <div className="meta-grid grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm" id="repo-preferences-grid">
                        <MetaRow label="Task Model" value={preferences.lastModels?.task || preferences.lastModel || 'default'} />
                        <MetaRow label="Ask Model" value={preferences.lastModels?.ask || preferences.lastModel || 'default'} />
                        <MetaRow label="Depth" value={preferences.lastDepth || 'default'} />
                        <MetaRow label="Effort" value={preferences.lastEffort || 'default'} />
                        <MetaRow label="Task Skill" value={formatSkillValue(preferences.lastSkills?.task)} />
                        <MetaRow label="Ask Skill" value={formatSkillValue(preferences.lastSkills?.ask)} />
                        <MetaRow label="Plan Skill" value={formatSkillValue(preferences.lastSkills?.plan)} />
                    </div>
                )}
                {/* Recent Prompts subsection */}
                {!loadingPreferences && !preferencesError && preferences && preferences.recentFollowPrompts && preferences.recentFollowPrompts.length > 0 && (
                    <div id="repo-recent-prompts-section" className="mt-3">
                        <h4 className="text-xs font-semibold text-[#848484] mb-2">Recent Prompts ({preferences.recentFollowPrompts.length})</h4>
                        <div className="flex flex-col gap-2">
                            {preferences.recentFollowPrompts.map((entry, i) => (
                                <RecentPromptCard key={i} entry={entry} />
                            ))}
                        </div>
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

function RecentPromptCard({ entry }: { entry: RecentFollowPrompt }) {
    const skillChips = entry.skills && entry.skills.length > 0 ? entry.skills : null;
    const bodyText = entry.prompt?.trim() || (skillChips ? skillChips.join(', ') : entry.name);
    return (
        <div
            className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#2d2d2d] px-3 py-2"
            data-testid="recent-prompt-card"
        >
            {/* Header: timestamp + model badge + mode badge */}
            <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-[#848484] shrink-0">🕐 {relativeTime(entry.timestamp)}</span>
                <span className="flex-1" />
                {entry.model && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-[#f3f3f3] dark:bg-[#3c3c3c] text-[#848484]" title="Model">
                        {entry.model}
                    </span>
                )}
                {entry.mode && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                        entry.mode === 'ask'
                            ? 'bg-[#dbeafe] text-[#1d4ed8] dark:bg-[#1e3a5f] dark:text-[#93c5fd]'
                            : 'bg-[#dcfce7] text-[#15803d] dark:bg-[#14532d] dark:text-[#86efac]'
                    }`}>
                        {entry.mode}
                    </span>
                )}
            </div>
            {/* Body: prompt preview (2-line clamp) */}
            <div className="text-xs text-[#1e1e1e] dark:text-[#cccccc] line-clamp-2 mb-1.5">
                {bodyText}
            </div>
            {/* Footer: skill pills */}
            {skillChips && (
                <div className="flex flex-wrap gap-1">
                    {skillChips.map(s => (
                        <span
                            key={s}
                            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[#e0e0e0] dark:border-[#555] bg-[#f9f9f9] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc]"
                        >
                            <span>⚡</span>
                            <span>{s}</span>
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
