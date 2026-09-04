/**
 * RepoSettingsTab — Split-panel layout with grouped sidebar navigation and a
 * card-based content surface. Sidebar groups items into Repository (Info,
 * Preferences, Plans Folder, Notes) and Agent (MCP Servers, Agent Skills,
 * LLM Tools, Instructions, Memory) sections, with a client-side filter to
 * narrow the list. Each section renders a header (title + description +
 * optional save/refresh affordances) followed by the section content.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getCocClientForWorkspace, requestForWorkspace } from '../../repos/cloneRegistry';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { useGlobalToast } from '../../contexts/ToastContext';
import { useApp } from '../../contexts/AppContext';
import { formatRelativeTime, copyToClipboard } from '../../utils/format';
import { McpServersPanel } from '../skills/McpServersPanel';
import { AgentSkillsPanel } from '../skills/AgentSkillsPanel';
import { useWorkspaceSkillsController } from '../skills/useWorkspaceSkillsController';
import { useWorkspaceMcpConfigController } from '../skills/useWorkspaceMcpConfigController';
import { CustomInstructionsPanel } from '../skills/CustomInstructionsPanel';
import type { InstructionMode } from '../skills/CustomInstructionsPanel';
import type { SettingsSection } from '../../types/dashboard';
import type { RepoData } from '../../repos/repoGrouping';
import { MemoryStatusCard } from '../memory/MemoryStatusCard';
import { useRepos } from '../../contexts/ReposContext';
import { TasksSettingsSection } from './TasksSettingsSection';
import { RepoPreferencesSection } from './RepoPreferencesSection';
import { LlmToolsPanel } from './LlmToolsPanel';
import { NotesSettingsSection } from './NotesSettingsSection';
import { SyncSettingsSection } from './SyncSettingsSection';
import { DockedStatusFooter } from '../../layout/DockedStatusFooter';
import {
    SectionCard,
    SettingsNavCountBadge,
    SettingsNavDotBadge,
    type SettingsNavGroup,
    SettingsShell,
} from './SettingsShell';

interface RepoSettingsTabProps {
    workspaceId: string;
    repo: RepoData;
    /**
     * When true, dock the shared status/action cluster in the settings sidebar
     * footer. Hosts with their own shared body-level footer leave this off.
     */
    dockStatusFooter?: boolean;
}

type ActiveSection = SettingsSection;

const NAV_GROUPS: SettingsNavGroup<ActiveSection>[] = [
    {
        id: 'repository',
        label: 'Repository',
        items: [
            { id: 'info',        label: 'Info',         title: 'Info',         description: 'Workspace metadata, description, and recent activity' },
            { id: 'preferences', label: 'Preferences',  title: 'Preferences',  description: 'Default models, execution settings, and skills' },
            { id: 'tasks',       label: 'Plans Folder', title: 'Plans Folder', description: 'Configure where AI-generated plans are stored' },
            { id: 'notes',       label: 'Notes',        title: 'Notes',        description: 'Notebook auto-commit and git settings' },
        ],
    },
    {
        id: 'agent',
        label: 'Agent',
        items: [
            { id: 'mcp',          label: 'MCP Servers',  title: 'MCP Servers',          description: 'Enable or disable Model Context Protocol servers' },
            { id: 'skills',       label: 'Agent Skills', title: 'Agent Skills',         description: 'Install, configure, and inspect agent skills' },
            { id: 'llm-tools',    label: 'LLM Tools',    title: 'LLM Tools',            description: 'Toggle individual tools available to the agent' },
            { id: 'instructions', label: 'Instructions', title: 'Custom Instructions',  description: 'Per-mode system prompts appended to every chat' },
            { id: 'memory',       label: 'Memory',       title: 'Memory',               description: 'Persistent memory entries available to the agent' },
        ],
    },
];

const VIRTUAL_WORKSPACE_IDS = new Set(['my_work', 'my_life']);

function isVirtualWorkspaceId(workspaceId: string): boolean {
    return VIRTUAL_WORKSPACE_IDS.has(workspaceId);
}

const STATUS_DOT: Record<string, string> = {
    running:   'bg-[#3794ff]',
    completed: 'bg-[#1f883d] dark:bg-[#3fb950]',
    failed:    'bg-[#cf222e] dark:bg-[#f85149]',
    cancelled: 'bg-[#848484]',
    queued:    'bg-[#bf8700] dark:bg-[#d29922]',
};

// ── Header action icons ───────────────────────────────────────────────────

function CopyIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a1 1 0 0 1 1-1h10" />
        </svg>
    );
}

function RefreshIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <path d="M21 12a9 9 0 1 1-3.2-6.9" />
            <path d="M21 4v5h-5" />
        </svg>
    );
}

function MetaRow({
    label,
    last,
    children,
}: {
    label: string;
    last?: boolean;
    children: React.ReactNode;
}) {
    return (
        <div
            className={`grid grid-cols-[120px_1fr] items-baseline gap-x-4 py-2 text-[12.5px] ${
                last ? '' : 'border-b border-dashed border-[#e6e6e6] dark:border-[#2d2d30]'
            }`}
        >
            <span className="text-[#6e7781] dark:text-[#8b949e]">{label}</span>
            <span className="font-mono text-[12.5px] text-[#1f2328] dark:text-[#cccccc] break-all">{children}</span>
        </div>
    );
}

function StatCard({
    value,
    label,
    dotClass,
    testId,
}: {
    value: number | string;
    label: string;
    dotClass?: string;
    testId?: string;
}) {
    return (
        <div
            data-testid={testId}
            className="flex-1 min-w-0 rounded-md border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] px-3 py-2.5"
        >
            <div className="flex items-center gap-1.5 leading-none">
                {dotClass && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />}
                <span className="text-[20px] font-semibold text-[#1f2328] dark:text-[#e6edf3] leading-none">{value}</span>
            </div>
            <div className="mt-1 text-[10.5px] uppercase tracking-wide text-[#6e7781] dark:text-[#8b949e]">{label}</div>
        </div>
    );
}

export function RepoSettingsTab({ workspaceId, repo, dockStatusFooter = false }: RepoSettingsTabProps) {
    const { addToast } = useGlobalToast();
    const { state, dispatch } = useApp();
    const { repos: allRepos } = useRepos();
    const ws = repo.workspace;
    const skillsController = useWorkspaceSkillsController({
        workspaceId,
        resolveClient: getCocClientForWorkspace,
        repos: allRepos,
        loadLinkedRepoPreferences: true,
        notify: addToast,
    });

    // ── MCP policy ───────────────────────────────────────────────────────────
    // One owner for loading, optimistic state, and serialized field-specific
    // writes, shared with the repo Copilot surface. Routed to the server that
    // owns the workspace so a remote clone writes on its own machine.
    const mcp = useWorkspaceMcpConfigController({
        workspaceId,
        resolveClient: getCocClientForWorkspace,
    });
    const refreshMcp = mcp.refresh;
    const fetchMcpConfig = useCallback((forceReload = false) => { refreshMcp(forceReload); }, [refreshMcp]);

    // ── Instructions state ───────────────────────────────────────────────────
    const [instrContents, setInstrContents] = useState<Record<InstructionMode, string | null>>({
        base: null, ask: null, autopilot: null,
    });
    const [instrLoading, setInstrLoading] = useState(true);
    const [instrDraft, setInstrDraft] = useState<Record<InstructionMode, string>>({
        base: '', ask: '', autopilot: '',
    });
    const [instrSaving, setInstrSaving] = useState(false);

    const fetchInstructions = useCallback(async () => {
        setInstrLoading(true);
        try {
            const data = await getCocClientForWorkspace(workspaceId).workspaces.getInstructions(workspaceId) as Record<InstructionMode, string | null>;
            setInstrContents(data);
            setInstrDraft({
                base: data.base ?? '',
                ask: data.ask ?? '',
                autopilot: data.autopilot ?? '',
            });
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
            await getCocClientForWorkspace(workspaceId).workspaces.updateInstruction(workspaceId, mode, { content });
            setInstrContents(prev => ({ ...prev, [mode]: content || null }));
            addToast('Instructions saved', 'success');
        } catch (e: any) {
            addToast(getSpaCocClientErrorMessage(e, 'Failed to save instructions'), 'error');
        } finally {
            setInstrSaving(false);
        }
    };

    const handleInstrDelete = async (mode: InstructionMode) => {
        setInstrSaving(true);
        try {
            try {
                await getCocClientForWorkspace(workspaceId).workspaces.deleteInstruction(workspaceId, mode);
            } catch (e) {
                if (!(e instanceof CocApiError && e.status === 404)) throw e;
            }
            setInstrContents(prev => ({ ...prev, [mode]: null }));
            setInstrDraft(prev => ({ ...prev, [mode]: '' }));
            addToast('Instructions deleted', 'success');
        } catch (e: any) {
            addToast(getSpaCocClientErrorMessage(e, 'Failed to delete instructions'), 'error');
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
    const stats = repo.stats || { success: 0, failed: 0, running: 0 };
    const remoteUrl = ws.remoteUrl || repo.gitInfo?.remoteUrl || null;

    const [desc, setDesc] = useState(ws.description ?? '');
    const [savingDesc, setSavingDesc] = useState(false);
    const [descSavedAt, setDescSavedAt] = useState<number | null>(null);
    const [savedTick, setSavedTick] = useState(0);
    const [processes, setProcesses] = useState<any[]>([]);
    const [loadingProcesses, setLoadingProcesses] = useState(true);
    const [tasksFolder, setTasksFolder] = useState<string | null>(null);

    const fetchProcesses = useCallback(() => {
        setLoadingProcesses(true);
        return requestForWorkspace<any>(ws.id, `/processes?workspace=${encodeURIComponent(ws.id)}&limit=10`)
            .then(res => setProcesses(res?.processes || []))
            .catch(() => setProcesses([]))
            .finally(() => setLoadingProcesses(false));
    }, [ws.id]);

    useEffect(() => { void fetchProcesses(); }, [fetchProcesses]);

    useEffect(() => {
        getCocClientForWorkspace(workspaceId).preferences.getTaskSettings(ws.id)
            .then(res => setTasksFolder(res?.taskRootPath || res?.folderPath || null))
            .catch(() => setTasksFolder(null));
    }, [ws.id]);

    useEffect(() => {
        if (descSavedAt == null) return;
        const handle = setInterval(() => setSavedTick(t => t + 1), 1000);
        return () => clearInterval(handle);
    }, [descSavedAt]);

    const savedAgoLabel = useMemo(() => {
        if (descSavedAt == null) return null;
        // Re-evaluated whenever savedTick changes.
        void savedTick;
        const diffSec = Math.max(0, Math.floor((Date.now() - descSavedAt) / 1000));
        if (diffSec < 60) return `${diffSec}s ago`;
        const mins = Math.floor(diffSec / 60);
        if (mins < 60) return `${mins}m ago`;
        return formatRelativeTime(new Date(descSavedAt).toISOString());
    }, [descSavedAt, savedTick]);

    const persistDescription = useCallback(async () => {
        if (desc === (ws.description ?? '')) return;
        setSavingDesc(true);
        try {
            await requestForWorkspace(ws.id, `/workspaces/${encodeURIComponent(ws.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ description: desc }),
            });
            setDescSavedAt(Date.now());
        } finally {
            setSavingDesc(false);
        }
    }, [desc, ws.description, ws.id]);

    const handleCopyPath = useCallback(async () => {
        try {
            await copyToClipboard(ws.rootPath || '');
            addToast('Path copied to clipboard', 'success');
        } catch {
            addToast('Could not copy path', 'error');
        }
    }, [ws.rootPath, addToast]);

    // ── Sidebar navigation state ──────────────────────────────────────────────
    const activeSection = state.settingsSection;
    const isVirtualWorkspace = isVirtualWorkspaceId(workspaceId);

    const setActiveSection = useCallback((section: ActiveSection) => {
        dispatch({ type: 'SET_SETTINGS_SECTION', section });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/settings/' + section;
    }, [dispatch, workspaceId]);

    const enabledMcpCount = mcp.availableServers.filter(s => mcp.isEnabled(s.name)).length;
    const installedSkillsCount = skillsController.skills.length;
    const hasInstructions = Object.values(instrContents).some(v => v !== null && v !== '');
    const memoryHint = !isVirtualWorkspace;
    const preferencesHint = !!ws.description || tasksFolder !== null;

    function renderBadge(id: ActiveSection): React.ReactNode {
        if (id === 'mcp' && !mcp.loading) return <SettingsNavCountBadge count={enabledMcpCount} />;
        if (id === 'skills' && !skillsController.skillsLoading) return <SettingsNavCountBadge count={installedSkillsCount} />;
        if (id === 'instructions' && hasInstructions) return <SettingsNavDotBadge label="Configured" />;
        if (id === 'preferences' && preferencesHint) return <SettingsNavDotBadge label="Configured" />;
        if (id === 'memory' && memoryHint) return <SettingsNavDotBadge label="Available" />;
        return null;
    }

    const suppressSectionHeader = activeSection === 'skills' || activeSection === 'mcp';

    return (
        <SettingsShell
            groups={NAV_GROUPS}
            activeSectionId={activeSection}
            onSelect={setActiveSection}
            renderBadge={renderBadge}
            footer={dockStatusFooter ? <DockedStatusFooter /> : undefined}
            suppressSectionHeader={suppressSectionHeader}
            headerActions={activeSection === 'info' ? (
                <div className="flex items-center gap-1 flex-shrink-0">
                    {(savingDesc || savedAgoLabel) && (
                        <span
                            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border border-[#d8dee4] dark:border-[#3c3c3c] bg-white dark:bg-[#252526] text-[11.5px] text-[#1f2328] dark:text-[#e6edf3]"
                            data-testid="settings-saved-indicator"
                        >
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${savingDesc ? 'bg-[#bf8700] dark:bg-[#d29922] animate-pulse' : 'bg-[#1f883d] dark:bg-[#3fb950]'}`} />
                            {savingDesc ? (
                               <>Saving<span className="text-[#6e7781] dark:text-[#8b949e]">…</span></>
                            ) : (
                               <>
                                   <span className="font-semibold">Saved</span>
                                   <span className="text-[#6e7781] dark:text-[#8b949e]">{savedAgoLabel}</span>
                               </>
                            )}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handleCopyPath}
                        title="Copy workspace path"
                        aria-label="Copy workspace path"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-[#6e7781] dark:text-[#8b949e] hover:bg-[#eaeef2] dark:hover:bg-[#252526] hover:text-[#1f2328] dark:hover:text-[#e6edf3]"
                        data-testid="settings-header-copy"
                    >
                        <CopyIcon />
                    </button>
                    <button
                        type="button"
                        onClick={() => void fetchProcesses()}
                        title="Refresh recent runs"
                        aria-label="Refresh recent runs"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-transparent text-[#6e7781] dark:text-[#8b949e] hover:bg-[#eaeef2] dark:hover:bg-[#252526] hover:text-[#1f2328] dark:hover:text-[#e6edf3]"
                        data-testid="settings-header-refresh"
                    >
                        <RefreshIcon />
                    </button>
                </div>
            ) : undefined}
        >
            {activeSection === 'info' && (
                        <>
                            {/* WORKSPACE card */}
                            <SectionCard label="Workspace" testId="info-workspace-card">
                                <div className="flex flex-col">
                                    <MetaRow label="Path">{ws.rootPath || '—'}</MetaRow>
                                    {tasksFolder && <MetaRow label="Plans folder">{tasksFolder}</MetaRow>}
                                    <MetaRow label="Branch">
                                        <span className="inline-flex items-center gap-2">
                                            <span>{branch + dirty}</span>
                                            {(ahead > 0 || behind > 0) && (
                                                <span className="inline-flex items-center gap-1 text-[11.5px] text-[#bf8700] dark:text-[#d29922]">
                                                    {ahead > 0 && <span>↑ {ahead} ahead</span>}
                                                    {behind > 0 && <span>↓ {behind} behind</span>}
                                                </span>
                                            )}
                                            {ahead === 0 && behind === 0 && (
                                                <span className="text-[11.5px] text-[#6e7781] dark:text-[#8b949e]">· synced</span>
                                            )}
                                        </span>
                                    </MetaRow>
                                    {remoteUrl && <MetaRow label="Remote">{remoteUrl}</MetaRow>}
                                    <MetaRow label="Color" last>
                                        <span className="inline-flex items-center gap-2">
                                            <span className="repo-color-dot inline-block w-3 h-3 rounded-full" style={{ background: color }} />
                                            <span className="text-[#1f2328] dark:text-[#e6edf3]">{color}</span>
                                        </span>
                                    </MetaRow>
                                </div>
                            </SectionCard>

                            {/* DESCRIPTION card */}
                            <SectionCard label="Description" testId="info-description-card">
                                <textarea
                                    id="repo-description-textarea"
                                    className="w-full text-[12.5px] text-[#1f2328] dark:text-[#e6edf3] bg-transparent border border-[#d8dee4] dark:border-[#3c3c3c] rounded-md px-3 py-2 resize-none focus:outline-none focus:border-[#0969da] dark:focus:border-[#3794ff]"
                                    rows={3}
                                    placeholder="Add a description for this repo…"
                                    value={desc}
                                    onChange={e => setDesc(e.target.value)}
                                    onBlur={() => { void persistDescription(); }}
                                    disabled={savingDesc}
                                />
                            </SectionCard>

                            {/* ACTIVITY card */}
                            <SectionCard
                                label="Activity"
                                testId="info-activity-card"
                                right={
                                    <span className="inline-flex items-center gap-1 text-[11px] text-[#6e7781] dark:text-[#8b949e]" data-testid="info-activity-range">
                                        last 30 days
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3" aria-hidden>
                                            <path d="m6 9 6 6 6-6" />
                                        </svg>
                                    </span>
                                }
                            >
                                {/* Five tiles share ~343px on a phone, which cuts
                                    the "Workflows"/"Completed" labels in half; a
                                    2-up grid below `md` gives each label room.
                                    `md:flex` restores the single desktop row. */}
                                <div className="grid grid-cols-2 gap-2.5 md:flex">
                                    <StatCard value={repo.workflows?.length || 0} label="Workflows" testId="info-stat-workflows" />
                                    <StatCard value={repo.taskCount || 0} label="Plans" testId="info-stat-plans" />
                                    <StatCard value={stats.running} label="Running" dotClass="bg-[#0969da] dark:bg-[#3794ff]" testId="info-stat-running" />
                                    <StatCard value={stats.success} label="Completed" dotClass="bg-[#1f883d] dark:bg-[#3fb950]" testId="info-stat-completed" />
                                    <StatCard value={stats.failed} label="Failed" dotClass="bg-[#cf222e] dark:bg-[#f85149]" testId="info-stat-failed" />
                                </div>

                                <div className="mt-5">
                                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6e7781] dark:text-[#8b949e] mb-1.5">
                                        Recent runs
                                    </div>
                                    {loadingProcesses ? (
                                        <div id="repo-processes-list" className="text-[12px] text-[#6e7781] dark:text-[#8b949e] py-2">Loading…</div>
                                    ) : processes.length === 0 ? (
                                        <div id="repo-processes-list" className="text-[12px] text-[#6e7781] dark:text-[#8b949e] py-2">No processes yet</div>
                                    ) : (
                                        <ul id="repo-processes-list" className="flex flex-col">
                                            {processes.map((p, idx) => {
                                                const dot = STATUS_DOT[p.status] || 'bg-[#848484]';
                                                const title = p.promptPreview || p.id || 'Untitled';
                                                const display = title.length > 60 ? title.substring(0, 60) + '…' : title;
                                                const time = p.startTime ? formatRelativeTime(p.startTime) : '';
                                                return (
                                                    <li
                                                        key={p.id}
                                                        className={`repo-process-entry flex items-center gap-2.5 py-1.5 text-[12px] ${
                                                            idx === processes.length - 1
                                                                ? ''
                                                                : 'border-b border-dashed border-[#e6e6e6] dark:border-[#2d2d30]'
                                                        }`}
                                                    >
                                                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
                                                        <span className="flex-1 truncate text-[#1f2328] dark:text-[#e6edf3]">{display}</span>
                                                        <span className="text-[#6e7781] dark:text-[#8b949e] text-[11px] flex-shrink-0">{time}</span>
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    )}
                                </div>
                            </SectionCard>
                        </>
                    )}
                    {activeSection === 'preferences' && (
                        <SectionCard>
                            <RepoPreferencesSection workspaceId={workspaceId} />
                        </SectionCard>
                    )}
                    {activeSection === 'mcp' && (
                        <McpServersPanel
                            workspaceId={workspaceId}
                            loading={mcp.loading}
                            error={mcp.error}
                            saving={mcp.saving}
                            availableServers={mcp.availableServers}
                            sources={mcp.sources}
                            enabledMcpTools={mcp.enabledMcpTools}
                            onSaveEnabledMcpTools={mcp.saveEnabledMcpTools}
                            isEnabled={mcp.isEnabled}
                            onToggle={mcp.toggleServer}
                            onRefresh={() => fetchMcpConfig(true)}
                        />
                    )}
                    {activeSection === 'skills' && (
                        <AgentSkillsPanel
                            workspaceId={workspaceId}
                            workspaceName={ws.name}
                            controller={skillsController}
                            resolveClient={getCocClientForWorkspace}
                            allRepos={allRepos}
                        />
                    )}
                    {activeSection === 'llm-tools' && (
                        <SectionCard>
                            <LlmToolsPanel workspaceId={workspaceId} />
                        </SectionCard>
                    )}
                    {activeSection === 'instructions' && (
                        <SectionCard>
                            <CustomInstructionsPanel
                                instrLoading={instrLoading}
                                instrContents={instrContents}
                                instrDraft={instrDraft}
                                instrSaving={instrSaving}
                                onDraftChange={(mode, value) => setInstrDraft(prev => ({ ...prev, [mode]: value }))}
                                onSave={handleInstrSave}
                                onDelete={handleInstrDelete}
                            />
                        </SectionCard>
                    )}
                    {activeSection === 'memory' && (
                        <SectionCard>
                            <MemoryStatusCard workspaceId={workspaceId} />
                        </SectionCard>
                    )}
                    {activeSection === 'tasks' && (
                        <SectionCard>
                            <TasksSettingsSection workspaceId={workspaceId} />
                        </SectionCard>
                    )}
                    {activeSection === 'notes' && !isVirtualWorkspace && (
                        <SectionCard>
                            <NotesSettingsSection workspaceId={workspaceId} />
                        </SectionCard>
                    )}
                    {activeSection === 'notes' && isVirtualWorkspace && (
                        <SectionCard>
                            <SyncSettingsSection workspaceId={workspaceId} />
                        </SectionCard>
                    )}
        </SettingsShell>
    );
}
