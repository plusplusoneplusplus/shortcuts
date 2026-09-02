/**
 * useRepoGroupMembers — one-shot read of a repo group's resolved membership.
 *
 * Shared by the two surfaces that need it: `RepoGroupView`'s right-dock target
 * picker and the group's Settings tab (`RepoGroupSettingsTab`). Kept in its own
 * module so the Settings tab does not have to import the view that renders it.
 */
import { useEffect, useState } from 'react';
import { getRepoGroup, type RepoGroupMember } from './repoGroupService';

/**
 * Fetch the group's members. Returns `undefined` while the request is in flight
 * or when it fails — the dock reads that as "no picker" (better than flashing an
 * empty one, and it degrades to a scope-only dock rather than an error state)
 * and the Settings tab reads it as "still loading".
 *
 * `enabled` lets a consumer that is not on screen skip the request entirely.
 */
export function useRepoGroupMembers(
    workspaceId: string,
    baseUrl: string | undefined,
    enabled: boolean,
): RepoGroupMember[] | undefined {
    const [members, setMembers] = useState<RepoGroupMember[] | undefined>(undefined);
    useEffect(() => {
        if (!enabled) {
            setMembers(undefined);
            return;
        }
        let cancelled = false;
        setMembers(undefined);
        getRepoGroup(workspaceId, baseUrl)
            .then(group => {
                if (!cancelled) setMembers(group.members ?? []);
            })
            .catch(() => {
                if (!cancelled) setMembers(undefined);
            });
        return () => { cancelled = true; };
    }, [workspaceId, baseUrl, enabled]);
    return members;
}
