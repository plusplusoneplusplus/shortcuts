/**
 * RepoGroupDialog — create or edit a repo group (a named virtual workspace
 * that references a set of already-registered repo workspaces).
 *
 * Membership is a checkbox multi-select drawn ONLY from CoC's registered local
 * repo workspaces — there is no free-form path entry, so arbitrary/unregistered
 * paths cannot become members. In edit mode the current membership is loaded
 * from `GET /api/repo-groups/:id`; stale members (root path missing on disk, or
 * workspace no longer registered) are badged so the user can drop them. Keeping
 * a removed workspace checked is rejected by the server on save and the
 * validation message surfaces inline.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { isRemoteRepo, type RepoData } from './repoGrouping';
import { createRepoGroup, getRepoGroup, updateRepoGroup, type RepoGroupMember } from './repoGroupService';
import { getRepositoryApiErrorMessage } from './repositoryService';

export interface RepoGroupDialogProps {
    open: boolean;
    /** Workspace id of the group being edited; null = create a new group. */
    groupId?: string | null;
    /** Known repos — filtered here to registered local repo workspaces. */
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

export function RepoGroupDialog({ open, groupId, repos, onClose, onSaved }: RepoGroupDialogProps) {
    const [name, setName] = useState('');
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [staleMembers, setStaleMembers] = useState<RepoGroupMember[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        setName('');
        setChecked(new Set());
        setStaleMembers([]);
        setError(null);
        setSaving(false);
        if (!groupId) return;
        let cancelled = false;
        setLoading(true);
        getRepoGroup(groupId)
            .then(group => {
                if (cancelled) return;
                setName(group.name);
                setChecked(new Set(group.members.map(m => m.workspaceId)));
                setStaleMembers(group.members.filter(m => m.stale));
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(getRepositoryApiErrorMessage(err, 'Failed to load repo group'));
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, groupId]);

    // Eligible members: registered local repo workspaces, deduped by id. Remote
    // (agent-hosted) checkouts live in another server's registry, so the server
    // would reject them — they are not offered.
    const options = useMemo<MemberOption[]>(() => {
        const staleById = new Map(staleMembers.map(m => [m.workspaceId, m]));
        const seen = new Set<string>();
        const opts: MemberOption[] = [];
        for (const repo of repos) {
            const id = String(repo.workspace?.id ?? '');
            if (!id || seen.has(id) || isRemoteRepo(repo)) continue;
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
    }, [repos, staleMembers]);

    const toggleMember = useCallback((workspaceId: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(workspaceId)) next.delete(workspaceId);
            else next.add(workspaceId);
            return next;
        });
    }, []);

    const handleSave = useCallback(async () => {
        const members = options.filter(o => checked.has(o.workspaceId)).map(o => o.workspaceId);
        setSaving(true);
        setError(null);
        try {
            if (groupId) {
                await updateRepoGroup(groupId, { name: name.trim(), members });
            } else {
                await createRepoGroup({ name: name.trim(), members });
            }
            onSaved();
        } catch (err: unknown) {
            setError(getRepositoryApiErrorMessage(err, 'Failed to save repo group'));
            setSaving(false);
        }
    }, [groupId, name, options, checked, onSaved]);

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
                            <label
                                key={option.workspaceId}
                                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-[#f5f5f5] dark:hover:bg-[#2a2a2a] text-xs"
                            >
                                <input
                                    type="checkbox"
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
