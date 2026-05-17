/**
 * RepoCopilotTab — Split-panel layout with sidebar navigation for MCP Servers,
 * Agent Skills, and Custom Instructions.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useGlobalToast } from '../../contexts/ToastContext';
import { useApp } from '../../contexts/AppContext';
import { McpServersPanel } from '../skills/McpServersPanel';
import type { McpServerEntry, McpServerSources } from '../skills/McpServersPanel';
import { AgentSkillsPanel } from '../skills/AgentSkillsPanel';
import type { Skill, SkillDetail } from '../skills/AgentSkillsPanel';
import { CustomInstructionsPanel } from '../skills/CustomInstructionsPanel';
import type { InstructionMode } from '../skills/CustomInstructionsPanel';
import type { SettingsSection } from '../../types/dashboard';

interface RepoCopilotTabProps {
    workspaceId: string;
}

type ActiveSection = SettingsSection;

const NAV_ITEMS: { id: ActiveSection; label: string; icon: string }[] = [
    { id: 'mcp', label: 'MCP Servers', icon: '🖥️' },
    { id: 'skills', label: 'Agent Skills', icon: '🧩' },
    { id: 'instructions', label: 'Custom Instructions', icon: '📝' },
];

export function RepoCopilotTab({ workspaceId }: RepoCopilotTabProps) {
    const { addToast } = useGlobalToast();
    const { state, dispatch } = useApp();

    // ── MCP state ────────────────────────────────────────────────────────────
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [availableServers, setAvailableServers] = useState<McpServerEntry[]>([]);
    const [mcpSources, setMcpSources] = useState<McpServerSources | undefined>(undefined);
    const [enabledMcpServers, setEnabledMcpServers] = useState<string[] | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        setMcpSources(undefined);
        getSpaCocClient().workspaces.getMcpConfig(workspaceId)
            .then((data) => {
                setAvailableServers(data.availableServers ?? []);
                setMcpSources(data.sources);
                setEnabledMcpServers(data.enabledMcpServers ?? null);
            })
            .catch((e: unknown) => setError(getSpaCocClientErrorMessage(e, 'Failed to load MCP config')))
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
        setEnabledMcpServers(nextValue); // optimistic update
        setSaving(true);
        try {
            await getSpaCocClient().workspaces.updateMcpConfig(workspaceId, { enabledMcpServers: nextValue });
        } catch (e: any) {
            setError(e.message ?? 'Failed to save');
            setEnabledMcpServers(prevValue); // revert on error
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

    const fetchSkills = useCallback(async () => {
        setSkillsLoading(true);
        try {
            const skills = await getSpaCocClient().skills.listWorkspace(workspaceId);
            setSkills(skills);
        } catch {
            // ignore
        } finally {
            setSkillsLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => { fetchSkills(); }, [fetchSkills]);

    // Fetch disabled skills config
    useEffect(() => {
        getSpaCocClient().skills.getWorkspaceConfig(workspaceId)
            .then((data) => {
                setDisabledSkills(data.disabledSkills ?? []);
                setExtraSkillFolders(data.extraSkillFolders ?? []);
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
            const data = await getSpaCocClient().skills.detailWorkspace(workspaceId, name);
            setSkillDetail(data.skill || null);
        } catch {
            // ignore
        } finally {
            setDetailLoading(false);
        }
    }, [workspaceId, expandedSkill]);

    const handleDeleteSkill = async (name: string) => {
        try {
            await getSpaCocClient().skills.deleteWorkspace(workspaceId, name);
            addToast(`Deleted skill: ${name}`, 'success');
            fetchSkills();
        } catch (err: unknown) {
            addToast(getSpaCocClientErrorMessage(err, 'Failed to delete skill'), 'error');
        }
        setDeleteConfirm(null);
    };

    const handleSkillToggle= async (skillName: string, enabled: boolean) => {
        const nextDisabled = enabled
            ? disabledSkills.filter(n => n !== skillName)
            : [...disabledSkills, skillName];
        const prevDisabled = disabledSkills;
        setDisabledSkills(nextDisabled); // optimistic update
        setSkillToggleSaving(true);
        try {
            await getSpaCocClient().skills.updateWorkspaceConfig(workspaceId, { disabledSkills: nextDisabled });
        } catch (e: any) {
            setDisabledSkills(prevDisabled); // revert on error
            addToast(e?.message ?? 'Failed to save skill config', 'error');
        } finally {
            setSkillToggleSaving(false);
        }
    };

    const handleExtraSkillFoldersChange = async (nextFolders: string[]) => {
        const prevFolders = extraSkillFolders;
        setExtraSkillFolders(nextFolders); // optimistic update
        try {
            await getSpaCocClient().skills.updateWorkspaceConfig(workspaceId, { disabledSkills, extraSkillFolders: nextFolders });
        } catch (e: any) {
            setExtraSkillFolders(prevFolders); // revert on error
            addToast(e?.message ?? 'Failed to save skill config', 'error');
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
            const data = await getSpaCocClient().workspaces.getInstructions(workspaceId);
            setInstrContents(data);
            setInstrDraft({
                base: data.base ?? '',
                ask: data.ask ?? '',
                plan: data.plan ?? '',
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
            await getSpaCocClient().workspaces.updateInstruction(workspaceId, mode, { content });
            setInstrContents(prev => ({ ...prev, [mode]: content || null }));
            addToast('Instructions saved', 'success');
        } catch (e: unknown) {
            addToast(getSpaCocClientErrorMessage(e, 'Failed to save instructions'), 'error');
        } finally {
            setInstrSaving(false);
        }
    };

    const handleInstrDelete = async (mode: InstructionMode) => {
        setInstrSaving(true);
        try {
            await getSpaCocClient().workspaces.deleteInstruction(workspaceId, mode);
            setInstrContents(prev => ({ ...prev, [mode]: null }));
            setInstrDraft(prev => ({ ...prev, [mode]: '' }));
            addToast('Instructions deleted', 'success');
        } catch (e: unknown) {
            if (e instanceof CocApiError && e.status === 404) {
                setInstrContents(prev => ({ ...prev, [mode]: null }));
                setInstrDraft(prev => ({ ...prev, [mode]: '' }));
                addToast('Instructions deleted', 'success');
                return;
            }
            addToast(getSpaCocClientErrorMessage(e, 'Failed to delete instructions'), 'error');
        } finally {
            setInstrSaving(false);
        }
    };

    // ── Sidebar navigation state ──────────────────────────────────────────────
    const copilotSections = ['mcp', 'skills', 'instructions'] as const;
    type CopilotSection = typeof copilotSections[number];
    const activeSection: CopilotSection = (copilotSections as readonly string[]).includes(state.settingsSection)
        ? (state.settingsSection as CopilotSection)
        : 'mcp';

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
                data-testid="copilot-sidebar"
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
            <div className="flex-1 overflow-y-auto p-4" data-testid="copilot-content-panel">
                {activeSection === 'mcp' && (
                    <McpServersPanel
                        loading={loading}
                        error={error}
                        saving={saving}
                        availableServers={availableServers}
                        sources={mcpSources}
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
            </div>
        </div>
    );
}
