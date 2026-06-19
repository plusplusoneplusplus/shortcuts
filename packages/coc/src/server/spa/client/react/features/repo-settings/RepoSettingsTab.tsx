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
import type { McpServerEntry, McpServerSources } from '../skills/McpServersPanel';
import { AgentSkillsPanel } from '../skills/AgentSkillsPanel';
import type { Skill, SkillDetail } from '../skills/AgentSkillsPanel';
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

interface RepoSettingsTabProps {
    workspaceId: string;
    repo: RepoData;
}

type ActiveSection = SettingsSection;

interface NavItem {
    id: ActiveSection;
    label: string;
    title: string;
    description: string;
}

interface NavGroup {
    id: 'repository' | 'agent';
    label: string;
    items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
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

// ── Inline SVG icons used in the sidebar navigation ────────────────────────

function Icon({ id, className = 'h-3.5 w-3.5' }: { id: ActiveSection; className?: string }) {
    const stroke = 'currentColor';
    const common = {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke,
        strokeWidth: 1.7,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
        className,
        'aria-hidden': true,
    };
    switch (id) {
        case 'info':
            return (
                <svg {...common}>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5" />
                    <circle cx="12" cy="8" r="0.6" fill={stroke} stroke="none" />
                </svg>
            );
        case 'preferences':
            return (
                <svg {...common}>
                    <path d="M4 7h10" /><path d="M18 7h2" />
                    <circle cx="16" cy="7" r="2" />
                    <path d="M4 17h2" /><path d="M10 17h10" />
                    <circle cx="8" cy="17" r="2" />
                </svg>
            );
        case 'tasks':
            return (
                <svg {...common}>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
            );
        case 'notes':
            return (
                <svg {...common}>
                    <path d="M4 20h4l11-11-4-4L4 16z" />
                    <path d="M14 6l4 4" />
                </svg>
            );
        case 'mcp':
            return (
                <svg {...common}>
                    <rect x="3" y="5" width="18" height="10" rx="1.5" />
                    <path d="M8 19h8" /><path d="M12 15v4" />
                </svg>
            );
        case 'skills':
            return (
                <svg {...common}>
                    <path d="M12 3l8 4-8 4-8-4z" />
                    <path d="M4 11l8 4 8-4" />
                    <path d="M4 15l8 4 8-4" />
                </svg>
            );
        case 'llm-tools':
            return (
                <svg {...common}>
                    <path d="M14.7 6.3a4 4 0 0 1 5 5l-2.5 2.5-3.5-3.5z" />
                    <path d="M13 9l-9 9v3h3l9-9" />
                </svg>
            );
        case 'instructions':
            return (
                <svg {...common}>
                    <path d="M6 3h9l4 4v14H6z" />
                    <path d="M14 3v5h5" />
                    <path d="M9 13h6" /><path d="M9 17h4" />
                </svg>
            );
        case 'memory':
            return (
                <svg {...common}>
                    <rect x="5" y="5" width="14" height="14" rx="2" />
                    <path d="M9 5V3M15 5V3M9 21v-2M15 21v-2M5 9H3M5 15H3M21 9h-2M21 15h-2" />
                </svg>
            );
        default:
            return null;
    }
}

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

function SearchIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
            <circle cx="11" cy="11" r="6" />
            <path d="M20 20l-3.5-3.5" />
        </svg>
    );
}

// ── Card primitive used across sections ────────────────────────────────────

function SectionCard({
    label,
    right,
    children,
    className = '',
    testId,
}: {
    label?: string;
    right?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
    testId?: string;
}) {
    return (
        <section
            data-testid={testId}
            className={`rounded-lg border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] ${className}`}
        >
            {(label || right) && (
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    {label && (
                        <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6e7781] dark:text-[#8b949e]">
                            {label}
                        </span>
                    )}
                    {right}
                </div>
            )}
            <div className="px-4 pb-4">{children}</div>
        </section>
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
    const [mcpSources, setMcpSources] = useState<McpServerSources | undefined>(undefined);
    const [enabledMcpServers, setEnabledMcpServers] = useState<string[] | null>(null);
    const [enabledMcpTools, setEnabledMcpTools] = useState<Record<string, string[]> | null>(null);

    const fetchMcpConfig = useCallback((forceReload = false) => {
        setLoading(true);
        setError(null);
        setMcpSources(undefined);
        requestForWorkspace<any>(workspaceId, `/workspaces/${workspaceId}/mcp-config${forceReload ? '?forceReload=true' : ''}`)
            .then((data) => {
                setAvailableServers(data.availableServers ?? []);
                setMcpSources(data.sources);
                setEnabledMcpServers(data.enabledMcpServers ?? null);
                setEnabledMcpTools(data.enabledMcpTools ?? null);
            })
            .catch((e: any) => setError(e.message ?? 'Failed to load MCP config'))
            .finally(() => setLoading(false));
    }, [workspaceId]);

    useEffect(() => {
        fetchMcpConfig();
    }, [fetchMcpConfig]);

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
            await requestForWorkspace(workspaceId, `/workspaces/${workspaceId}/mcp-config`, {
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
            const skills = await getCocClientForWorkspace(workspaceId).skills.listWorkspace(workspaceId);
            setSkills(skills);
        } catch {
            // ignore
        } finally {
            setSkillsLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => { fetchSkills(); }, [fetchSkills]);

    useEffect(() => {
        getCocClientForWorkspace(workspaceId).skills.getWorkspaceConfig(workspaceId)
            .then((data) => {
                setDisabledSkills(data.disabledSkills ?? []);
                setExtraSkillFolders(data.extraSkillFolders ?? []);
            })
            .catch(() => {});
        getCocClientForWorkspace(workspaceId).preferences.getRepo(workspaceId)
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
        setSkillDetail(null);
        setDetailLoading(true);
        try {
            const data = await getCocClientForWorkspace(workspaceId).skills.detailWorkspace(workspaceId, name);
            setSkillDetail(data.skill || null);
        } catch {
            // ignore
        } finally {
            setDetailLoading(false);
        }
    }, [workspaceId, expandedSkill]);

    const handleDeleteSkill = async (name: string) => {
        try {
            await getCocClientForWorkspace(workspaceId).skills.deleteWorkspace(workspaceId, name);
            addToast(`Deleted skill: ${name}`, 'success');
            fetchSkills();
        } catch (err: any) {
            addToast(getSpaCocClientErrorMessage(err, `Failed to delete ${name}`), 'error');
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
            await getCocClientForWorkspace(workspaceId).skills.updateWorkspaceConfig(workspaceId, { disabledSkills: nextDisabled });
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
            await getCocClientForWorkspace(workspaceId).skills.updateWorkspaceConfig(workspaceId, { disabledSkills, extraSkillFolders: nextFolders });
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
            await getCocClientForWorkspace(workspaceId).preferences.patchRepo(workspaceId, { linkedRepoIds: nextIds });
        } catch (e: any) {
            setLinkedRepoIds(prevIds);
            addToast(e?.message ?? 'Failed to save linked repos', 'error');
        }
    };

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

    const visibleGroups = useMemo<NavGroup[]>(() => {
        return NAV_GROUPS.map(group => ({
            ...group,
            items: group.items,
        })).filter(g => g.items.length > 0);
    }, []);

    const setActiveSection= useCallback((section: ActiveSection) => {
        dispatch({ type: 'SET_SETTINGS_SECTION', section });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/settings/' + section;
    }, [dispatch, workspaceId]);

    // Filter input — client-side narrowing of the sidebar list.
    const [filterQuery, setFilterQuery] = useState('');
    const normalizedQuery = filterQuery.trim().toLowerCase();
    const filteredGroups = useMemo<NavGroup[]>(() => {
        if (!normalizedQuery) return visibleGroups;
        return visibleGroups
            .map(group => ({
                ...group,
                items: group.items.filter(item =>
                    item.label.toLowerCase().includes(normalizedQuery) ||
                    item.title.toLowerCase().includes(normalizedQuery)
                ),
            }))
            .filter(g => g.items.length > 0);
    }, [visibleGroups, normalizedQuery]);

    const enabledMcpCount = availableServers.filter(s => isEnabled(s.name)).length;
    const installedSkillsCount = skills.length;
    const hasInstructions = Object.values(instrContents).some(v => v !== null && v !== '');
    const memoryHint = !isVirtualWorkspace;
    const preferencesHint = !!ws.description || tasksFolder !== null;

    const activeNav = useMemo(() => {
        for (const g of NAV_GROUPS) {
            for (const it of g.items) if (it.id === activeSection) return it;
        }
        return NAV_GROUPS[0].items[0];
    }, [activeSection]);

    function renderBadge(id: ActiveSection): React.ReactNode {
        if (id === 'mcp' && !loading) {
            return (
                <span className="ml-auto text-[10px] font-mono px-1.5 py-px rounded text-[#6e7781] dark:text-[#8b949e] bg-[#eaeef2] dark:bg-[#2d2d30]">
                    {enabledMcpCount}
                </span>
            );
        }
        if (id === 'skills' && !skillsLoading) {
            return (
                <span className="ml-auto text-[10px] font-mono px-1.5 py-px rounded text-[#6e7781] dark:text-[#8b949e] bg-[#eaeef2] dark:bg-[#2d2d30]">
                    {installedSkillsCount}
                </span>
            );
        }
        if (id === 'instructions' && hasInstructions) {
            return <span className="ml-auto inline-block w-1.5 h-1.5 rounded-full bg-[#0969da] dark:bg-[#3794ff]" aria-label="Configured" />;
        }
        if (id === 'preferences' && preferencesHint) {
            return <span className="ml-auto inline-block w-1.5 h-1.5 rounded-full bg-[#0969da] dark:bg-[#3794ff]" aria-label="Configured" />;
        }
        if (id === 'memory' && memoryHint) {
            return <span className="ml-auto inline-block w-1.5 h-1.5 rounded-full bg-[#0969da] dark:bg-[#3794ff]" aria-label="Available" />;
        }
        return null;
    }

    return (
        <div className="flex flex-col sm:flex-row h-full overflow-hidden bg-[var(--vscode-editor-background,#fff)] dark:bg-[#191919]">
            {/* ── Left sidebar ── */}
            <nav
                className="flex-shrink-0 flex flex-col border-b sm:border-b-0 sm:border-r border-[#e0e0e0] dark:border-[#2d2d30] bg-[var(--vscode-sideBar-background,#fafbfc)] dark:bg-[#1c1c1c] overflow-y-auto sm:w-[210px]"
                data-testid="settings-sidebar"
            >
                {/* Filter input */}
                <div className="px-3 pt-3 pb-2 sticky top-0 z-10 bg-inherit">
                    <label className="flex items-center gap-1.5 h-7 rounded-md border border-[#d8dee4] dark:border-[#2d2d30] bg-white dark:bg-[#252526] px-2 focus-within:border-[#0969da] dark:focus-within:border-[#3794ff]">
                        <SearchIcon className="h-3 w-3 text-[#6e7781] dark:text-[#8b949e]" />
                        <input
                            type="search"
                            value={filterQuery}
                            onChange={e => setFilterQuery(e.target.value)}
                            placeholder="Filter settings"
                            className="flex-1 min-w-0 bg-transparent text-[12px] text-[#1f2328] dark:text-[#e6edf3] placeholder:text-[#6e7781] dark:placeholder:text-[#8b949e] outline-none"
                            data-testid="settings-filter-input"
                        />
                        <kbd
                            className="hidden sm:inline-flex items-center justify-center h-[18px] px-1 rounded text-[10px] font-mono text-[#6e7781] dark:text-[#8b949e] bg-[#eaeef2] dark:bg-[#2d2d30] border border-[#d8dee4] dark:border-[#3c3c3c] select-none"
                            aria-hidden
                        >
                            ⌘K
                        </kbd>
                    </label>
                </div>

                {/* Grouped nav */}
                <div className="flex-1 px-1.5 pb-3 flex flex-col gap-3">
                    {filteredGroups.length === 0 ? (
                        <div className="px-2.5 py-3 text-[11px] text-[#6e7781] dark:text-[#8b949e]" data-testid="settings-filter-empty">
                            No settings match “{filterQuery.trim()}”.
                        </div>
                    ) : (
                        filteredGroups.map(group => (
                            <div key={group.id} className="flex flex-col" data-testid={`nav-group-${group.id}`}>
                                <div className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#6e7781] dark:text-[#8b949e]">
                                    {group.label}
                                </div>
                                {group.items.map(item => {
                                    const isActive = activeSection === item.id;
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => setActiveSection(item.id)}
                                            className={`group flex items-center gap-2 h-7 px-2.5 rounded-md text-[12.5px] text-left transition-colors whitespace-nowrap ${
                                                isActive
                                                    ? 'bg-white dark:bg-[#252526] text-[#1f2328] dark:text-[#e6edf3] border border-[#d8dee4] dark:border-[#3c3c3c] font-semibold shadow-[0_1px_0_rgba(31,35,40,0.04)]'
                                                    : 'border border-transparent text-[#1f2328] dark:text-[#c9d1d9] hover:bg-[#eef1f4] dark:hover:bg-[#252526]'
                                            }`}
                                            data-testid={`nav-item-${item.id}`}
                                            aria-current={isActive ? 'page' : undefined}
                                        >
                                            <span className={`flex-shrink-0 ${isActive ? 'text-[#1f2328] dark:text-[#e6edf3]' : 'text-[#6e7781] dark:text-[#8b949e]'}`}>
                                                <Icon id={item.id} />
                                            </span>
                                            <span className="flex-1 truncate">{item.label}</span>
                                            {renderBadge(item.id)}
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
            </nav>

            {/* ── Right content panel ── */}
            <div className="flex-1 overflow-y-auto min-w-0" data-testid="settings-content-panel">
                {/* Section header (hidden for Agent Skills / MCP — panels ship their own header) */}
                {activeSection !== 'skills' && activeSection !== 'mcp' && (
                <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4">
                    <div className="min-w-0">
                        <h2 className="text-[18px] font-semibold leading-tight text-[#1f2328] dark:text-[#e6edf3]" data-testid="settings-section-title">
                            {activeNav.title}
                        </h2>
                        <p className="mt-0.5 text-[12.5px] text-[#6e7781] dark:text-[#8b949e]" data-testid="settings-section-description">
                            {activeNav.description}
                        </p>
                    </div>
                    {activeSection === 'info' && (
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
                    )}
                </header>
                )}

                {/* Section body */}
                <div className={activeSection === 'skills' || activeSection === 'mcp' ? '' : 'px-6 pb-8 flex flex-col gap-4'}>
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
                                <div className="flex gap-2.5">
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
                            loading={loading}
                            error={error}
                            saving={saving}
                            availableServers={availableServers}
                            sources={mcpSources}
                            enabledMcpServers={enabledMcpServers}
                            enabledMcpTools={enabledMcpTools}
                            isEnabled={isEnabled}
                            onToggle={handleToggle}
                            onRefresh={() => fetchMcpConfig(true)}
                        />
                    )}
                    {activeSection === 'skills' && (
                        <AgentSkillsPanel
                            workspaceId={workspaceId}
                            workspaceName={ws.name}
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
                </div>
            </div>
        </div>
    );
}
