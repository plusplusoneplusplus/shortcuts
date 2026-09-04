/**
 * RepoGroupSettingsTab — the Settings tab of a repo-group virtual workspace.
 *
 * A repo group has no git, no MCP config and no per-repo preferences, so it does
 * not use the repo-specific settings sections or URL routing. It renders the
 * shared settings shell with one local section, "Repos", where each member's
 * description is edited inline.
 *
 * Membership itself (add / remove / rename the group) stays in `RepoGroupDialog`;
 * this tab only edits descriptions, against the same `PATCH /api/repo-groups/:id`.
 */
import { SettingsShell, type SettingsShellNavGroup } from '../features/repo-settings/SettingsShell';
import { RepoGroupMemberList } from './RepoGroupMemberList';
import { useRepoGroupMembers } from './useRepoGroupMembers';

const REPOS_SECTION_ID = 'repos' as const;
const REPO_GROUP_SETTINGS_NAV: SettingsShellNavGroup<typeof REPOS_SECTION_ID>[] = [{
    id: 'repos',
    items: [{
        id: REPOS_SECTION_ID,
        label: 'Repos',
        title: 'Repos',
        description: 'A description tells the model what each repo is for in this group. It is added to the member listing injected into new chats.',
    }],
}];

export interface RepoGroupSettingsTabProps {
    /** The `group-<slug>` workspace id whose settings these are. */
    workspaceId: string;
    /** Base URL of the server owning the group; omit for a local group. */
    baseUrl?: string;
    /**
     * Whether the tab is the visible one. The pane stays mounted while hidden
     * (like Notes), so gate the member read on it rather than fetching for a tab
     * nobody is looking at.
     */
    active: boolean;
}

export function RepoGroupSettingsTab({ workspaceId, baseUrl, active }: RepoGroupSettingsTabProps) {
    const members = useRepoGroupMembers(workspaceId, baseUrl, active);

    return (
        <div
            className="h-full"
            data-testid="repo-group-settings-tab"
            data-workspace={workspaceId}
        >
            <SettingsShell
                groups={REPO_GROUP_SETTINGS_NAV}
                activeSectionId={REPOS_SECTION_ID}
                onSelect={() => undefined}
            >
                {members
                    ? <RepoGroupMemberList workspaceId={workspaceId} baseUrl={baseUrl} members={members} />
                    : <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-settings-loading">Loading…</div>}
            </SettingsShell>
        </div>
    );
}
