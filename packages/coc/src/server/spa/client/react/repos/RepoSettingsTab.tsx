/**
 * RepoSettingsTab — Split-panel layout with sidebar navigation for Info,
 * Preferences, MCP Servers, Agent Skills, and Custom Instructions.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { fetchApi } from '../hooks/useApi';
import { useGlobalToast } from '../context/ToastContext';
import { useApp } from '../context/AppContext';
import { getApiBase } from '../utils/config';
import { formatRelativeTime } from '../utils/format';
import { McpServersPanel } from './McpServersPanel';
import type { McpServerEntry } from './McpServersPanel';
import { AgentSkillsPanel } from './AgentSkillsPanel';
import type { Skill, SkillDetail } from './AgentSkillsPanel';
import { CustomInstructionsPanel } from './CustomInstructionsPanel';
import type { InstructionMode } from './CustomInstructionsPanel';
import type { SettingsSection } from '../types/dashboard';
import type { RepoData } from './repoGrouping';
import { RepoMemorySection } from './memory/RepoMemorySection';
import { useRepos } from '../context/ReposContext';

interface RepoSettingsTabProps {
    workspaceId: string;
    repo: RepoData;
}

type ActiveSection = SettingsSection;

const NAV_ITEMS: { id: ActiveSection; label: string; icon: string }[] = [
    { id: 'info', label: 'Info', icon: '📋' },
    { id: 'preferences', label: 'Preferences', icon: '⚙️' },
    { id: 'mcp', label: 'MCP Servers', icon: '🖥️' },
    { id: 'skills', label: 'Agent Skills', icon: '🧩' },
    { id: 'instructions', label: 'Custom Instructions', icon: '📝' },
    { id: 'memory', label: 'Memory', icon: '🧠' },
];

// ── Info section types ──────────────────────────────────────────────────────

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

interface PerRepoPreferences {
    lastModel?: string;
    lastModels?: LastModelsByMode;
    lastDepth?: 'deep' | 'normal';
    lastEffort?: 'low' | 'medium' | 'high';
    lastSkills?: LastSkillsByMode;
}

const STATUS_ICON: Record<string, string> = {
    running: '⏳', completed: '✓', failed: '✗', cancelled: '🚫', queued: '⏳',
};

function formatSkillValue(val: string | string[] | undefined): string {
    if (!val || (Array.isArray(val) && val.length === 0)) return 'none';
    if (Array.isArray(val)) return val.join(', ');
    return val || 'none';
}

function hasSkillValue(val: string | string[] | undefined): boolean {
    if (!val) return false;
    if (Array.isArray(val)) return val.length > 0;
    return val.length > 0;
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

export function RepoSettingsTab({ workspaceId, repo }: RepoSettingsTabProps) {
    const { addToast } = useGlobalToast();
    const { state, dispatch } = useApp();
    const { repos: allRepos } = useRepos();
    const ws = repo.workspace;

    // ── MCP state ────────────────────────────────────────────────────────────
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [availableServers, setAvailableServers] = useState<McpServerEntry[]>([]);
    const [enabledMcpServers, setEnabledMcpServers] = useState<string[] | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        fetchApi(`/workspaces/${workspaceId}/mcp-config`)
            .then((data) => {
                setAvailableServers(data.availableServers ?? []);
                setEnabledMcpServers(data.enabledMcpServers ?? null);
            })
            .catch((e: any) => setError(e.message ?? 'Failed to load MCP config'))
            .finally(() => setLoading(false));
    }, [workspaceId]);

    const isEnabled = (name: string) =>
        enabledMcpServers === null || enabledMcpServers.includes(name);

    const handleToggle = async (serverName: string, checked: boolean) => {
        const allNames = availableServers.map((s) => s.name);
        const currentList = enabledMcpServers ?? allNames;
        const nextList = checked
            ? [...new Set([...currentList, serverName])]
            : currentList.filter((n) => n !== serverName);
        const nextValue = nextList.length === allNames.length ? null : nextList;
        const prevValue = enabledMcpServers;
        setEnabledMcpServers(nextValue);
        setSaving(true);
        try {
            await fetchApi(`/workspaces/${workspaceId}/mcp-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabledMcpServers: nextValue }),
            });
        } catch (e: any) {
            setError(e.message ?? 'Failed to save');
            setEnabledMcpServers(prevValue);
        } finally {
            setSaving(false);
        }
    };

    // ── Skills state ─────────────────────────────────────────────────────────
    const [skills, setSkills] = useState<Skill[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(true);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
    const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
    const [skillToggleSaving, setSkillToggleSaving] = useState(false);
    const [extraSkillFolders, setExtraSkillFolders] = useState<string[]>([]);
    const [linkedRepoIds, setLinkedRepoIds] = useState<string[]>([]);

    const fetchSkills = useCallback(async () => {
        setSkillsLoading(true);
        try {
            const res = await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/skills');
            if (res.ok) {
                const data = await res.json();
                setSkills(data.skills || []);
            }
        } catch {
            // ignore
        } finally {
            setSkillsLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => { fetchSkills(); }, [fetchSkills]);

    useEffect(() => {
        fetchApi(`/workspaces/${workspaceId}/skills-config`)
            .then((data) => {
                setDisabledSkills(data.disabledSkills ?? []);
                setExtraSkillFolders(data.extraSkillFolders ?? []);
            })
            .catch(() => {});
        // Fetch linkedRepoIds from per-repo preferences
        fetchApi(`/workspaces/${workspaceId}/preferences`)
            .then((data) => {
                setLinkedRepoIds(data.linkedRepoIds ?? []);
            })
            .catch(() => {});
    }, [workspaceId]);

    const handleExpandSkill = useCallback(async (name: string) => {
        if (expandedSkill === name) {
            setExpandedSkill(null);
            setSkillDetail(null);
            return;
        }
        setExpandedSkill(name);
        setDetailLoading(true);
        try {
            const res = await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/skills/' + encodeURIComponent(name));
            if (res.ok) {
                const data = await res.json();
                setSkillDetail(data.skill || null);
            }
        } catch {
            // ignore
        } finally {
            setDetailLoading(false);
        }
    }, [workspaceId, expandedSkill]);

    const handleDeleteSkill = async (name: string) => {
        try {
            const res = await fetch(
                getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/skills/' + encodeURIComponent(name),
                { method: 'DELETE' }
            );
            if (res.ok) {
                addToast(`Deleted skill: ${name}`, 'success');
                fetchSkills();
            } else {
                const body = await res.json().catch(() => null);
                addToast(body?.error ?? `Failed to delete ${name}`, 'error');
            }
        } catch (err: any) {
            addToast(err?.message ?? 'Failed to delete skill', 'error');
        }
        setDeleteConfirm(null);
    };

    const handleSkillToggle = async (skillName: string, enabled: boolean) => {
        const nextDisabled = enabled
            ? disabledSkills.filter(n => n !== skillName)
            : [...disabledSkills, skillName];
        const prevDisabled = disabledSkills;
        setDisabledSkills(nextDisabled);
        setSkillToggleSaving(true);
        try {
            await fetchApi(`/workspaces/${workspaceId}/skills-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disabledSkills: nextDisabled }),
            });
        } catch (e: any) {
            setDisabledSkills(prevDisabled);
            addToast(e?.message ?? 'Failed to save skill config', 'error');
        } finally {
            setSkillToggleSaving(false);
        }
    };

    const handleExtraSkillFoldersChange = async (nextFolders: string[]) => {
        const prevFolders = extraSkillFolders;
        setExtraSkillFolders(nextFolders);
        try {
            await fetchApi(`/workspaces/${workspaceId}/skills-config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disabledSkills, extraSkillFolders: nextFolders }),
            });
            // Re-fetch skills so linked-repo skills appear/disappear immediately
            fetchSkills();
        } catch (e: any) {
            setExtraSkillFolders(prevFolders);
            addToast(e?.message ?? 'Failed to save skill config', 'error');
        }
    };

    const handleLinkedRepoIdsChange = async (nextIds: string[]) => {
        const prevIds = linkedRepoIds;
        setLinkedRepoIds(nextIds);
        try {
            await fetchApi(`/workspaces/${workspaceId}/preferences`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ linkedRepoIds: nextIds }),
            });
        } catch (e: any) {
            setLinkedRepoIds(prevIds);
            addToast(e?.message ?? 'Failed to save linked repos', 'error');
        }
    };

    // ── Instructions state ───────────────────────────────────────────────────
    const [instrContents, setInstrContents] = useState<Record<InstructionMode, string | null>>({
        base: null, ask: null, plan: null, autopilot: null,
    });
    const [instrLoading, setInstrLoading] = useState(true);
    const [instrDraft, setInstrDraft] = useState<Record<InstructionMode, string>>({
        base: '', ask: '', plan: '', autopilot: '',
    });
    const [instrSaving, setInstrSaving] = useState(false);

    const fetchInstructions = useCallback(async () => {
        setInstrLoading(true);
        try {
            const res = await fetch(getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/instructions');
            if (res.ok) {
                const data: Record<InstructionMode, string | null> = await res.json();
                setInstrContents(data);
                setInstrDraft({
                    base: data.base ?? '',
                    ask: data.ask ?? '',
                    plan: data.plan ?? '',
                    autopilot: data.autopilot ?? '',
                });
            }
        } catch {
            // ignore
        } finally {
            setInstrLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => { fetchInstructions(); }, [fetchInstructions]);

    const handleInstrSave = async (mode: InstructionMode) => {
        setInstrSaving(true);
        try {
            const content = instrDraft[mode];
            const res = await fetch(
                getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/instructions/' + mode,
                { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }
            );
            if (!res.ok) throw new Error((await res.json()).message ?? 'Save failed');
            setInstrContents(prev => ({ ...prev, [mode]: content || null }));
            addToast('Instructions saved', 'success');
        } catch (e: any) {
            addToast(e?.message ?? 'Failed to save instructions', 'error');
        } finally {
            setInstrSaving(false);
        }
    };

    const handleInstrDelete = async (mode: InstructionMode) => {
        setInstrSaving(true);
        try {
            const res = await fetch(
                getApiBase() + '/workspaces/' + encodeURIComponent(workspaceId) + '/instructions/' + mode,
                { method: 'DELETE' }
            );
            if (!res.ok && res.status !== 404) throw new Error((await res.json()).message ?? 'Delete failed');
            setInstrContents(prev => ({ ...prev, [mode]: null }));
            setInstrDraft(prev => ({ ...prev, [mode]: '' }));
            addToast('Instructions deleted', 'success');
        } catch (e: any) {
            addToast(e?.message ?? 'Failed to delete instructions', 'error');
        } finally {
            setInstrSaving(false);
        }
    };

    // ── Info section state ───────────────────────────────────────────────────
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

    // ── Sidebar navigation state ──────────────────────────────────────────────
    const activeSection = state.settingsSection;

    const setActiveSection = useCallback((section: ActiveSection) => {
        dispatch({ type: 'SET_SETTINGS_SECTION', section });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/settings/' + section;
    }, [dispatch, workspaceId]);

    // Count badges for sidebar
    const enabledMcpCount = availableServers.filter(s => isEnabled(s.name)).length;
    const installedSkillsCount = skills.length;
    const hasInstructions = Object.values(instrContents).some(v => v !== null && v !== '');

    return (
        <div className="flex flex-row h-full overflow-hidden">
            {/* ── Left sidebar ── */}
            <nav
                className="w-52 flex-shrink-0 flex flex-col border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[var(--vscode-sideBar-background,#f3f3f3)] dark:bg-[#252526] overflow-y-auto"
                data-testid="settings-sidebar"
            >
                {NAV_ITEMS.map(item => {
                    const isActive = activeSection === item.id;
                    let badge: React.ReactNode = null;
                    if (item.id === 'mcp' && !loading) {
                        badge = (
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999]">
                                {enabledMcpCount}
                            </span>
                        );
                    } else if (item.id === 'skills' && !skillsLoading) {
                        badge = (
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999]">
                                {installedSkillsCount}
                            </span>
                        );
                    } else if (item.id === 'instructions' && hasInstructions) {
                        badge = (
                            <span className="ml-auto inline-block w-2 h-2 rounded-full bg-[#0078d4]" />
                        );
                    }
                    return (
                        <button
                            key={item.id}
                            onClick={() => setActiveSection(item.id)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-left transition-colors w-full ${
                                isActive
                                    ? 'bg-[var(--vscode-list-activeSelectionBackground,#0078d4)] text-white dark:text-white'
                                    : 'text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#e8e8e8] dark:hover:bg-[#2a2d2e]'
                            }`}
                            data-testid={`nav-item-${item.id}`}
                        >
                            <span className="text-sm">{item.icon}</span>
                            <span className="flex-1 truncate">{item.label}</span>
                            {badge}
                        </button>
                    );
                })}
            </nav>

            {/* ── Right content panel ── */}
            <div className="flex-1 overflow-y-auto p-4" data-testid="settings-content-panel">
                {activeSection === 'info' && (
                    <div className="flex flex-col gap-4">
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
                    </div>
                )}
                {activeSection === 'preferences' && (
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
                            !hasSkillValue(preferences.lastSkills?.plan)
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
                    </div>
                )}
                {activeSection === 'mcp' && (
                    <McpServersPanel
                        loading={loading}
                        error={error}
                        saving={saving}
                        availableServers={availableServers}
                        isEnabled={isEnabled}
                        onToggle={handleToggle}
                    />
                )}
                {activeSection === 'skills' && (
                    <AgentSkillsPanel
                        workspaceId={workspaceId}
                        skills={skills}
                        skillsLoading={skillsLoading}
                        disabledSkills={disabledSkills}
                        skillToggleSaving={skillToggleSaving}
                        expandedSkill={expandedSkill}
                        skillDetail={skillDetail}
                        detailLoading={detailLoading}
                        deleteConfirm={deleteConfirm}
                        onExpandSkill={handleExpandSkill}
                        onDeleteSkill={handleDeleteSkill}
                        onSkillToggle={handleSkillToggle}
                        onSetDeleteConfirm={setDeleteConfirm}
                        onInstalled={fetchSkills}
                        extraSkillFolders={extraSkillFolders}
                        onExtraSkillFoldersChange={handleExtraSkillFoldersChange}
                        linkedRepoIds={linkedRepoIds}
                        onLinkedRepoIdsChange={handleLinkedRepoIdsChange}
                        allRepos={allRepos}
                    />
                )}
                {activeSection === 'instructions' && (
                    <CustomInstructionsPanel
                        instrLoading={instrLoading}
                        instrContents={instrContents}
                        instrDraft={instrDraft}
                        instrSaving={instrSaving}
                        onDraftChange={(mode, value) => setInstrDraft(prev => ({ ...prev, [mode]: value }))}
                        onSave={handleInstrSave}
                        onDelete={handleInstrDelete}
                    />
                )}
                {activeSection === 'memory' && (
                    <RepoMemorySection repoId={workspaceId} repoPath={ws.rootPath} />
                )}
            </div>
        </div>
    );
}
