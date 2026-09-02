/**
 * RepoGroupSettingsTab — the Settings tab of a repo-group virtual workspace.
 *
 * A repo group has no git, no MCP config and no per-repo preferences, so it does
 * NOT reuse `RepoSettingsTab` and its section sidebar. It is a single scrolling
 * pane of cards; today the only card is "Member repos", where each member's
 * description — the note the server injects into new chats to say what that repo
 * is for inside THIS group — is edited inline.
 *
 * Membership itself (add / remove / rename the group) stays in `RepoGroupDialog`;
 * this tab only edits descriptions, against the same `PATCH /api/repo-groups/:id`.
 */
import { RepoGroupMemberList } from './RepoGroupMemberList';
import { useRepoGroupMembers } from './useRepoGroupMembers';

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
            className="h-full overflow-y-auto px-4 py-4"
            data-testid="repo-group-settings-tab"
            data-workspace={workspaceId}
        >
            <section
                className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
                data-testid="repo-group-settings-members-card"
            >
                <header className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <h2 className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc]">Member repos</h2>
                    <p className="text-xs text-[#616161] dark:text-[#999] mt-0.5">
                        A description tells the model what each repo is for in this group. It is added to the
                        member listing injected into new chats.
                    </p>
                </header>
                {members
                    ? <RepoGroupMemberList workspaceId={workspaceId} baseUrl={baseUrl} members={members} />
                    : <div className="text-xs text-[#848484] px-3 py-2" data-testid="repo-group-settings-loading">Loading…</div>}
            </section>
        </div>
    );
}
