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
import { AgentSkillsPanel } from '../skills/AgentSkillsPanel';
import { useWorkspaceSkillsController } from '../skills/useWorkspaceSkillsController';
import { useWorkspaceMcpConfigController } from '../skills/useWorkspaceMcpConfigController';
import { CustomInstructionsPanel } from '../skills/CustomInstructionsPanel';
import type { InstructionMode } from '../skills/CustomInstructionsPanel';
import type { SettingsSection } from '../../types/dashboard';

interface RepoCopilotTabProps {
    workspaceId: string;
}

type ActiveSection = SettingsSection;

const resolveSpaClient = () => getSpaCocClient();

const NAV_ITEMS: { id: ActiveSection; label: string; icon: string }[] = [
    { id: 'mcp', label: 'MCP Servers', icon: '🖥️' },
    { id: 'skills', label: 'Agent Skills', icon: '🧩' },
    { id: 'instructions', label: 'Custom Instructions', icon: '📝' },
];

export function RepoCopilotTab({ workspaceId }: RepoCopilotTabProps) {
    const { addToast } = useGlobalToast();
    const { state, dispatch } = useApp();
    const skillsController = useWorkspaceSkillsController({
        workspaceId,
        resolveClient: resolveSpaClient,
        notify: addToast,
    });

    // ── MCP policy ───────────────────────────────────────────────────────────
    // One owner for loading, optimistic state, and serialized field-specific
    // writes, shared with the repo Settings surface.
    const mcp = useWorkspaceMcpConfigController({
        workspaceId,
        resolveClient: resolveSpaClient,
    });
    const refreshMcp = mcp.refresh;
    const handleRefreshMcp = useCallback(() => { refreshMcp(true); }, [refreshMcp]);

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
            const data = await getSpaCocClient().workspaces.getInstructions(workspaceId);
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
    const enabledMcpCount = mcp.availableServers.filter(s => mcp.isEnabled(s.name)).length;
    const installedSkillsCount = skillsController.skills.length;
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
                    if (item.id === 'mcp' && !mcp.loading) {
                        badge = (
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#616161] dark:text-[#999]">
                                {enabledMcpCount}
                            </span>
                        );
                    } else if (item.id === 'skills' && !skillsController.skillsLoading) {
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
                        onRefresh={handleRefreshMcp}
                        onMutate={handleRefreshMcp}
                    />
                )}
                {activeSection === 'skills' && (
                    <AgentSkillsPanel
                        workspaceId={workspaceId}
                        controller={skillsController}
                        resolveClient={resolveSpaClient}
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
