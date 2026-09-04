/**
 * RepoGroupDialog — create or edit a repo group (a named virtual workspace
 * that references a set of already-registered repo workspaces).
 *
 * A group lives in exactly ONE server's registry: the local dashboard's, or an
 * online remote (ssh/devtunnel) CoC server's. The "Server" dropdown picks which,
 * and every request the dialog makes — load, create, save — is routed to that
 * server's base URL. Membership is therefore scoped to that same server's repo
 * workspaces, so a group can never span two servers. The server is fixed once
 * the group exists, so the dropdown is disabled in edit mode.
 *
 * Membership is a checkbox multi-select drawn ONLY from registered repo
 * workspaces — there is no free-form path entry, so arbitrary/unregistered paths
 * cannot become members. In edit mode the current membership is loaded from
 * `GET /api/repo-groups/:id`; stale members (root path missing on disk, or
 * workspace no longer registered) are badged so the user can drop them. Keeping
 * a removed workspace checked is rejected by the server on save and the
 * validation message surfaces inline.
 *
 * Each checked member also carries an optional free-form description saying what
 * that repo is for inside this group, and a read-only flag marking it as one the
 * agent should not modify. Both are edited here as pending state and sent with
 * the rest of the form on Save — unlike the group page's list, which PATCHes a
 * single member as soon as its field changes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { isRemoteRepo, type RepoData } from './repoGrouping';
import { REPO_GROUP_DESCRIPTION_PLACEHOLDER, REPO_GROUP_READ_ONLY_LABEL } from './RepoGroupMemberList';
import {
    createRepoGroup,
    getRepoGroup,
    listRepoGroupServerOptions,
    updateRepoGroup,
    LOCAL_REPO_GROUP_SERVER,
    LOCAL_REPO_GROUP_SERVER_ID,
    REPO_GROUP_DESCRIPTION_MAX_LENGTH,
    type RepoGroupMember,
    type RepoGroupServerOption,
} from './repoGroupService';
import { getRepositoryApiErrorMessage } from './repositoryService';

export interface RepoGroupDialogProps {
    open: boolean;
    /** Workspace id of the group being edited; null = create a new group. */
    groupId?: string | null;
    /**
     * Base URL of the server owning the group being edited (absent for a local
     * group, and ignored in create mode where the dropdown decides).
     */
    groupBaseUrl?: string;
    /** Known repos — filtered here to the selected server's repo workspaces. */
    repos: RepoData[];
    onClose: () => void;
    /** Called after a successful create/save; the caller closes and refetches. */
    onSaved: () => void;
}

interface MemberOption {
    workspaceId: string;
    name: string;
    rootPath?: string;
    staleReason?: RepoGroupMember['staleReason'];
}

function staleBadgeLabel(reason: RepoGroupMember['staleReason']): string {
    return reason === 'workspace-removed' ? 'removed' : 'path missing';
}

/** The remote server id a repo belongs to, or `local` for a local workspace. */
function repoServerId(repo: RepoData): string {
    if (!isRemoteRepo(repo)) return LOCAL_REPO_GROUP_SERVER_ID;
    const remote = (repo.workspace as { remote?: { serverId?: unknown } }).remote;
    return typeof remote?.serverId === 'string' ? remote.serverId : LOCAL_REPO_GROUP_SERVER_ID;
}

/**
 * A remote server that predates the repo-group feature has no `/api/repo-groups`
 * route, so every call 404s. Reword that one case — any other failure keeps the
 * server's own message, which is the source of truth for membership validation.
 */
function isMissingRouteError(error: unknown): boolean {
    return typeof (error as { status?: unknown })?.status === 'number' && (error as { status: number }).status === 404;
}

export function RepoGroupDialog({ open, groupId, groupBaseUrl, repos, onClose, onSaved }: RepoGroupDialogProps) {
    const [name, setName] = useState('');
    const [checked, setChecked] = useState<Set<string>>(new Set());
    // Pending descriptions keyed by workspace id. Only the checked members' entries
    // are sent on save, so leftovers from a member the user unchecked are ignored
    // rather than resurrected.
    const [descriptions, setDescriptions] = useState<Record<string, string>>({});
    // Pending read-only flags, same keying and same checked-only submission rule.
    const [readOnly, setReadOnly] = useState<Record<string, boolean>>({});
    const [staleMembers, setStaleMembers] = useState<RepoGroupMember[]>([]);
    const [servers, setServers] = useState<RepoGroupServerOption[]>([LOCAL_REPO_GROUP_SERVER]);
    const [serverId, setServerId] = useState<string>(LOCAL_REPO_GROUP_SERVER_ID);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const editing = !!groupId;

    // Server list: Local + online remotes. Fetched per open so a server that went
    // offline since last time is not offered.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        listRepoGroupServerOptions()
            .then(options => { if (!cancelled) setServers(options); })
            .catch(() => { if (!cancelled) setServers([LOCAL_REPO_GROUP_SERVER]); });
        return () => { cancelled = true; };
    }, [open]);

    // The group under edit is pinned to its own server; a new group starts local.
    const editingServerId = useMemo(() => {
        if (!editing) return null;
        if (!groupBaseUrl) return LOCAL_REPO_GROUP_SERVER_ID;
        return servers.find(s => s.baseUrl === groupBaseUrl)?.id ?? groupBaseUrl;
    }, [editing, groupBaseUrl, servers]);

    const selectedServerId = editingServerId ?? serverId;
    const selectedBaseUrl = editing
        ? groupBaseUrl
        : servers.find(s => s.id === serverId)?.baseUrl;

    useEffect(() => {
        if (!open) return;
        setName('');
        setChecked(new Set());
        setDescriptions({});
        setReadOnly({});
        setStaleMembers([]);
        setError(null);
        setSaving(false);
        setServerId(LOCAL_REPO_GROUP_SERVER_ID);
        if (!groupId) return;
        let cancelled = false;
        setLoading(true);
        getRepoGroup(groupId, groupBaseUrl)
            .then(group => {
                if (cancelled) return;
                setName(group.name);
                setChecked(new Set(group.members.map(m => m.workspaceId)));
                setDescriptions(Object.fromEntries(
                    group.members
                        .filter(m => typeof m.description === 'string' && m.description.length > 0)
                        .map(m => [m.workspaceId, m.description as string]),
                ));
                setReadOnly(Object.fromEntries(
                    group.members
                        .filter(m => m.readOnly === true)
                        .map(m => [m.workspaceId, true]),
                ));
                setStaleMembers(group.members.filter(m => m.stale));
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(getRepositoryApiErrorMessage(err, 'Failed to load repo group'));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, groupId, groupBaseUrl]);

    // Eligible members: the SELECTED server's registered repo workspaces, deduped
    // by id. Repos from any other server live in another registry, so that server
    // would reject them — they are not offered, which is what keeps a group's
    // members single-server.
    const options = useMemo<MemberOption[]>(() => {
        const staleById = new Map(staleMembers.map(m => [m.workspaceId, m]));
        const seen = new Set<string>();
        const opts: MemberOption[] = [];
        for (const repo of repos) {
            const id = String(repo.workspace?.id ?? '');
            if (!id || seen.has(id) || repoServerId(repo) !== selectedServerId) continue;
            seen.add(id);
            opts.push({
                workspaceId: id,
                name: String(repo.workspace?.name ?? id),
                rootPath: typeof repo.workspace?.rootPath === 'string' ? repo.workspace.rootPath : undefined,
                staleReason: staleById.get(id)?.staleReason,
            });
        }
        // Members whose workspace registration is gone are not in `repos`; they
        // still render (badged) so the user can uncheck them before saving.
        for (const member of staleMembers) {
            if (seen.has(member.workspaceId)) continue;
            seen.add(member.workspaceId);
            opts.push({
                workspaceId: member.workspaceId,
                name: member.name ?? member.workspaceId,
                rootPath: member.rootPath,
                staleReason: member.staleReason,
            });
        }
        return opts;
    }, [repos, staleMembers, selectedServerId]);

    const toggleMember = useCallback((workspaceId: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(workspaceId)) next.delete(workspaceId);
            else next.add(workspaceId);
            return next;
        });
    }, []);

    // Switching servers drops the previous server's picks outright: their ids mean
    // nothing in the new server's registry, so carrying them over could only
    // produce a cross-server group.
    const changeServer = useCallback((nextServerId: string) => {
        setServerId(nextServerId);
        setChecked(new Set());
        setDescriptions({});
        setReadOnly({});
        setError(null);
    }, []);

    const handleSave = useCallback(async () => {
        const members = options.filter(o => checked.has(o.workspaceId)).map(o => o.workspaceId);
        // Every member gets a key so clearing a field sends '' and the server drops
        // the old text; unchecked members are absent, and the server prunes theirs.
        const memberDescriptions = Object.fromEntries(
            members.map(id => [id, (descriptions[id] ?? '').trim()]),
        );
        // Same rule for the flag: an explicit `false` is what makes unticking the
        // box clear a previously saved entry server-side.
        const memberReadOnly = Object.fromEntries(
            members.map(id => [id, readOnly[id] === true]),
        );
        setSaving(true);
        setError(null);
        try {
            if (groupId) {
                await updateRepoGroup(
                    groupId,
                    { name: name.trim(), members, descriptions: memberDescriptions, readOnly: memberReadOnly },
                    selectedBaseUrl,
                );
            } else {
                await createRepoGroup(
                    { name: name.trim(), members, descriptions: memberDescriptions, readOnly: memberReadOnly },
                    selectedBaseUrl,
                );
            }
            onSaved();
        } catch (err: unknown) {
            setError(isMissingRouteError(err)
                ? "This server doesn't support repo groups."
                : getRepositoryApiErrorMessage(err, 'Failed to save repo group'));
            setSaving(false);
        }
    }, [groupId, name, options, checked, descriptions, readOnly, selectedBaseUrl, onSaved]);

    // Editing a group on a server that is no longer in the list (offline since) —
    // still show which server it belongs to rather than a blank select.
    const serverChoices = useMemo<RepoGroupServerOption[]>(() => {
        if (editingServerId && !servers.some(s => s.id === editingServerId)) {
            return [...servers, { id: editingServerId, label: editingServerId }];
        }
        return servers;
    }, [servers, editingServerId]);

    return (
        <Dialog
            id="repo-group-dialog"
            open={open}
            onClose={onClose}
            title={groupId ? 'Edit repo group' : 'New repo group'}
            footer={
                <>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button
                        variant="primary"
                        data-testid="repo-group-save-btn"
                        loading={saving}
                        disabled={!name.trim() || loading}
                        onClick={handleSave}
                    >
                        {groupId ? 'Save' : 'Create'}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor="repo-group-name-input">Group name</label>
                <input
                    id="repo-group-name-input"
                    data-testid="repo-group-name-input"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g. Platform repos"
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4]"
                />

                <label className="text-xs font-medium text-[#616161] dark:text-[#999]" htmlFor="repo-group-server-select">Server</label>
                <select
                    id="repo-group-server-select"
                    data-testid="repo-group-server-select"
                    value={selectedServerId}
                    disabled={editing}
                    title={editing ? "A group's server cannot be changed after it is created" : undefined}
                    onChange={e => changeServer(e.target.value)}
                    className="px-2 py-1 text-sm rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] outline-none focus:border-[#0078d4] disabled:opacity-60"
                >
                    {serverChoices.map(option => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>

                <div className="text-xs font-medium text-[#616161] dark:text-[#999]">Member repos</div>
                {loading ? (
                    <div className="text-xs text-[#848484] py-2">Loading…</div>
                ) : options.length === 0 ? (
                    <div className="text-xs text-[#848484] py-2" data-testid="repo-group-no-repos">
                        No registered repos available. Add a repository to CoC first.
                    </div>
                ) : (
                    <div
                        className="border border-[#e0e0e0] dark:border-[#3c3c3c] rounded max-h-52 overflow-y-auto"
                        data-testid="repo-group-member-list"
                    >
                        {options.map(option => (
                            // A div, not a label wrapper: the description input has to
                            // sit inside the row without every keystroke's click
                            // toggling the checkbox.
                            <div
                                key={option.workspaceId}
                                className="flex flex-col gap-0.5 px-3 py-1.5 hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-xs"
                            >
                                <label
                                    className="flex items-center gap-2 cursor-pointer"
                                    htmlFor={`repo-group-member-check-${option.workspaceId}`}
                                >
                                    <input
                                        type="checkbox"
                                        id={`repo-group-member-check-${option.workspaceId}`}
                                        checked={checked.has(option.workspaceId)}
                                        onChange={() => toggleMember(option.workspaceId)}
                                        data-testid={`repo-group-member-check-${option.workspaceId}`}
                                    />
                                    <span className="font-medium text-[#1e1e1e] dark:text-[#cccccc]">{option.name}</span>
                                    {option.staleReason && (
                                        <span
                                            data-testid="repo-group-stale-badge"
                                            title={option.staleReason === 'workspace-removed'
                                                ? 'This workspace is no longer registered in CoC'
                                                : 'The repo folder no longer exists on disk'}
                                            className="px-1 rounded text-[10px] font-semibold bg-[#fff1e5] text-[#bc4c00] dark:bg-[#bc4c00]/20 dark:text-[#f0883e]"
                                        >
                                            {staleBadgeLabel(option.staleReason)}
                                        </span>
                                    )}
                                    {option.rootPath && (
                                        <span className="text-[#848484] truncate">{option.rootPath}</span>
                                    )}
                                </label>
                                {/* Only a member can carry a description, so the field
                                    appears once the repo is checked. */}
                                {checked.has(option.workspaceId) && (
                                    <>
                                    <input
                                        type="text"
                                        value={descriptions[option.workspaceId] ?? ''}
                                        maxLength={REPO_GROUP_DESCRIPTION_MAX_LENGTH}
                                        placeholder={REPO_GROUP_DESCRIPTION_PLACEHOLDER}
                                        aria-label={`Description for ${option.name}`}
                                        data-testid={`repo-group-member-description-${option.workspaceId}`}
                                        onChange={e => {
                                            const value = e.target.value;
                                            setDescriptions(prev => ({ ...prev, [option.workspaceId]: value }));
                                        }}
                                        className="ml-5 px-1.5 py-0.5 rounded border border-transparent bg-transparent text-[#1e1e1e] dark:text-[#cccccc] placeholder:text-[#a0a0a0] dark:placeholder:text-[#6a6a6a] outline-none hover:border-[#e0e0e0] dark:hover:border-[#3c3c3c] focus:border-[#0078d4] focus:bg-white dark:focus:bg-[#1e1e1e]"
                                    />
                                    <label
                                        className="ml-5 flex items-center gap-1.5 w-fit text-[11px] text-[#616161] dark:text-[#999] cursor-pointer"
                                        htmlFor={`repo-group-member-read-only-${option.workspaceId}`}
                                    >
                                        <input
                                            type="checkbox"
                                            id={`repo-group-member-read-only-${option.workspaceId}`}
                                            checked={readOnly[option.workspaceId] === true}
                                            aria-label={`Read-only for ${option.name}`}
                                            data-testid={`repo-group-member-read-only-${option.workspaceId}`}
                                            onChange={e => {
                                                const value = e.target.checked;
                                                setReadOnly(prev => ({ ...prev, [option.workspaceId]: value }));
                                            }}
                                        />
                                        {REPO_GROUP_READ_ONLY_LABEL}
                                    </label>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div
                        className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                        data-testid="repo-group-error"
                    >
                        {error}
                    </div>
                )}
            </div>
        </Dialog>
    );
}
