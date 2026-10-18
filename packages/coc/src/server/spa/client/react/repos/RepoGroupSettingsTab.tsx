/**
 * RepoGroupSettingsTab — the Settings page of a repo-group virtual workspace,
 * shown in the group's right-panel Settings tab.
 *
 * A group gets the same split-panel settings surface a real repo gets: the
 * shared `SettingsNavSidebar` on the left and a card content surface on the
 * right. Section navigation stays inside the page. Only the nav entries
 * differ - a group has "Group" (Member repos) and "Agent" (MCP Servers, Agent
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
 * the Member repos section only edits descriptions and the read-only policy,
 * against the same `PATCH /api/repo-groups/:id`.
 */
import { useCallback, useContext, useMemo, useState } from 'react';
import { useAppOptional } from '../contexts/AppContext';
import { useReposOptional } from '../contexts/ReposContext';
import { ToastContext } from '../contexts/ToastContext';
import { useWorkspaceSettingsClientResolver, useWorkspaceSettingsRepos } from '../features/repo-settings/workspaceSettingsClient';
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
    selectionId?: string;
    /** Base URL of the server owning the group; omit for a local group. */
    baseUrl?: string;
}

/** Mounted lazily, and kept mounted, by the shared Settings host. */
export function RepoGroupSettingsTab({ workspaceId, selectionId = workspaceId, baseUrl }: RepoGroupSettingsTabProps) {
    const app = useAppOptional();
    const addToast = useContext(ToastContext)?.addToast;
    const allRepos = useWorkspaceSettingsRepos(workspaceId, useReposOptional()?.repos);
    const resolveClient = useWorkspaceSettingsClientResolver(workspaceId);
    const members = useRepoGroupMembers(workspaceId, baseUrl, true);

    // The app reducer owns the section when the tab runs inside the dashboard;
    // the local copy is the fallback for a standalone mount (tests, pop-outs).
    const [localSection, setLocalSection] = useState<SettingsSection>(REPO_GROUP_DEFAULT_SECTION);
    const activeSection = resolveRepoGroupSection(app ? app.state.settingsSection : localSection);

    const setActiveSection = useCallback((section: SettingsSection) => {
        setLocalSection(section);
        app?.dispatch({ type: 'SET_SETTINGS_SECTION', section });
    }, [app]);

    const skillsController = useWorkspaceSkillsController({
        workspaceId,
        resolveClient,
        repos: allRepos,
        notify: addToast,
    });
    const mcp = useWorkspaceMcpConfigController({
        workspaceId,
        resolveClient,
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
                        members
                            ? <RepoGroupMemberList key={selectionId} workspaceId={workspaceId} selectionId={selectionId} baseUrl={baseUrl} members={members} />
                            : <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-settings-loading">Loading…</div>
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
                            resolveClient={resolveClient}
                            allRepos={allRepos}
                            groupMode
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
