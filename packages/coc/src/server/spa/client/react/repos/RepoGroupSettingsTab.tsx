/**
 * RepoGroupSettingsTab — the Settings tab of a repo-group virtual workspace.
 *
 * A group gets the same split-panel settings surface a real repo gets: the
 * shared `SettingsNavSidebar` on the left, a card content surface on the right,
 * and `#repos/<groupId>/settings/<section>` hash routing. Only the nav entries
 * differ — a group has "Group" (Member repos) and "Agent" (MCP Servers, Agent
 * Skills, LLM Tools); it has no git checkout, so Info / Plans Folder / Notes /
 * Instructions / Memory stay off the list.
 *
 * Agent settings here apply to chats run in the GROUP workspace only. They are
 * stored against the `group-` workspace id like any other workspace — enabled
 * MCP servers on the workspace record, tools and LLM-tool opt-outs in
 * `~/.coc/repos/<groupId>/preferences.json` — and nothing is written into, or
 * read back out of, the member repos.
 *
 * Membership itself (add / remove / rename the group) stays in `RepoGroupDialog`;
 * the Member repos section only edits descriptions and the read-only flag,
 * against the same `PATCH /api/repo-groups/:id`.
 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAppOptional } from '../contexts/AppContext';
import { useReposOptional } from '../contexts/ReposContext';
import { ToastContext } from '../contexts/ToastContext';
import { getCocClientForWorkspace } from './cloneRegistry';
import { AgentSkillsPanel } from '../features/skills/AgentSkillsPanel';
import { McpServersPanel } from '../features/skills/McpServersPanel';
import { useWorkspaceMcpConfigController } from '../features/skills/useWorkspaceMcpConfigController';
import { useWorkspaceSkillsController } from '../features/skills/useWorkspaceSkillsController';
import { LlmToolsPanel } from '../features/repo-settings/LlmToolsPanel';
import {
    SectionCard,
    SettingsNavCountBadge,
    SettingsNavSidebar,
    SettingsSectionHeader,
} from '../features/repo-settings/SettingsShell';
import type { SettingsSection } from '../types/dashboard';
import {
    REPO_GROUP_DEFAULT_SECTION,
    REPO_GROUP_SETTINGS_NAV,
    resolveRepoGroupSection,
} from './repoGroupSettingsSections';
import { RepoGroupMemberList } from './RepoGroupMemberList';
import { useRepoGroupMembers } from './useRepoGroupMembers';

export interface RepoGroupSettingsTabProps {
    /** The `group-<slug>` workspace id whose settings these are. */
    workspaceId: string;
    /** Base URL of the server owning the group; omit for a local group. */
    baseUrl?: string;
    /**
     * Whether the tab is the visible one. The pane stays mounted while hidden
     * (like Notes), so gate the reads on it rather than fetching MCP servers,
     * skills and members for a tab nobody is looking at.
     */
    active: boolean;
}

export function RepoGroupSettingsTab({ workspaceId, baseUrl, active }: RepoGroupSettingsTabProps) {
    // Everything below fetches on mount, so stay empty until the tab is first
    // opened — and stay mounted afterwards so switching tabs keeps the state.
    const [visited, setVisited] = useState(active);
    useEffect(() => { if (active) setVisited(true); }, [active]);

    if (!visited) return <div data-testid="repo-group-settings-tab" data-workspace={workspaceId} />;
    return <RepoGroupSettingsPane workspaceId={workspaceId} baseUrl={baseUrl} active={active} />;
}

function RepoGroupSettingsPane({ workspaceId, baseUrl, active }: RepoGroupSettingsTabProps) {
    const app = useAppOptional();
    const addToast = useContext(ToastContext)?.addToast;
    const allRepos = useReposOptional()?.repos;
    const members = useRepoGroupMembers(workspaceId, baseUrl, active);

    // The app reducer owns the section when the tab runs inside the dashboard;
    // the local copy is the fallback for a standalone mount (tests, pop-outs).
    const [localSection, setLocalSection] = useState<SettingsSection>(REPO_GROUP_DEFAULT_SECTION);
    const activeSection = resolveRepoGroupSection(app ? app.state.settingsSection : localSection);

    const setActiveSection = useCallback((section: SettingsSection) => {
        setLocalSection(section);
        app?.dispatch({ type: 'SET_SETTINGS_SECTION', section });
        location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/settings/' + section;
    }, [app, workspaceId]);

    const skillsController = useWorkspaceSkillsController({
        workspaceId,
        resolveClient: getCocClientForWorkspace,
        repos: allRepos,
        notify: addToast,
    });
    const mcp = useWorkspaceMcpConfigController({
        workspaceId,
        resolveClient: getCocClientForWorkspace,
    });

    const enabledMcpCount = mcp.availableServers.filter(s => mcp.isEnabled(s.name)).length;

    const activeNav = useMemo(() => {
        for (const group of REPO_GROUP_SETTINGS_NAV) {
            for (const item of group.items) if (item.id === activeSection) return item;
        }
        return REPO_GROUP_SETTINGS_NAV[0].items[0];
    }, [activeSection]);

    const renderBadge = useCallback((id: SettingsSection) => {
        if (id === 'members' && members) return <SettingsNavCountBadge count={members.length} />;
        if (id === 'mcp' && !mcp.loading) return <SettingsNavCountBadge count={enabledMcpCount} />;
        if (id === 'skills' && !skillsController.skillsLoading) return <SettingsNavCountBadge count={skillsController.skills.length} />;
        return null;
    }, [members, mcp.loading, enabledMcpCount, skillsController.skillsLoading, skillsController.skills.length]);

    const panelsOwnHeader = activeSection === 'skills' || activeSection === 'mcp';

    return (
        <div
            className="flex flex-col sm:flex-row h-full overflow-hidden bg-[var(--vscode-editor-background,#fff)] dark:bg-[#191919]"
            data-testid="repo-group-settings-tab"
            data-workspace={workspaceId}
        >
            <SettingsNavSidebar
                groups={REPO_GROUP_SETTINGS_NAV}
                activeSection={activeSection}
                onSelect={setActiveSection}
                renderBadge={renderBadge}
            />

            <div className="flex-1 overflow-y-auto min-w-0" data-testid="settings-content-panel">
                {!panelsOwnHeader && (
                    <SettingsSectionHeader title={activeNav.title} description={activeNav.description} />
                )}

                <div className={panelsOwnHeader ? '' : 'px-6 pb-8 flex flex-col gap-4'}>
                    {activeSection === 'members' && (
                        <SectionCard testId="repo-group-settings-members-card">
                            <p className="text-xs text-[#616161] dark:text-[#999] mb-2">
                                A description tells the model what each repo is for in this group. It is added to
                                the member listing injected into new chats.
                            </p>
                            {members
                                ? <RepoGroupMemberList workspaceId={workspaceId} baseUrl={baseUrl} members={members} />
                                : <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-settings-loading">Loading…</div>}
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
                            onRefresh={() => mcp.refresh(true)}
                            groupMode
                        />
                    )}
                    {activeSection === 'skills' && (
                        <AgentSkillsPanel
                            workspaceId={workspaceId}
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
                </div>
            </div>
        </div>
    );
}
