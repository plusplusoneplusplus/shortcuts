/**
 * Owner-scoped reads behind the collapsed rail's Git tiles.
 *
 * A repo reads its `git-info` (shared through `api/workspaceReads.ts`) and its
 * working tree; a group reads one `git-info` batch for its live members. Reads
 * run on mount, owner change, preview open and when `ReposContext` refreshes
 * the owner's git-info after a `git-changed` event — never on a timer. Owner
 * changes and unmount discard late responses; unresolved remote owners read
 * nothing and stay unavailable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CocClient, GitInfoResponse } from '@plusplusoneplusplus/coc-client';
import { readWorkspaceGitInfo, workspaceReadSource } from '../../api/workspaceReads';
import { useReposOptional } from '../../contexts/ReposContext';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { isRemoteWorkspace } from '../../repos/remoteWorkspaceAggregation';
import type { RepoGroupMember } from '../../repos/repoGroupService';
import {
    summarizeWorkingTree,
    type GroupRailGitInput,
    type GroupRailGitMember,
    type RailGitRead,
    type RepoRailGitInput,
} from './railGitModel';

const IDLE: RailGitRead<never> = { loading: true, failed: false };
const UNAVAILABLE: RailGitRead<never> = { loading: false, failed: true };

function settle<T, R>(previous: RailGitRead<T>, result: PromiseSettledResult<R>, map: (value: R) => T): RailGitRead<T> {
    return result.status === 'fulfilled'
        ? { data: map(result.value), readAt: Date.now(), loading: false, failed: false }
        : { ...previous, loading: false, failed: true };
}

/**
 * Bumps when `ReposContext` replaces git-info for any of these workspaces on
 * this owner — the existing local/remote `git-changed` refresh path.
 */
function useOwnerGitInfoVersion(workspaceIds: readonly string[], baseUrl: string | undefined): number {
    const repos = useReposOptional()?.repos;
    const key = workspaceIds.join('\u0000');
    const selected = useMemo(() => key.split('\u0000').map(id => repos?.find(repo =>
        repo.workspace?.id === id
        && (baseUrl ? isRemoteWorkspace(repo.workspace) && repo.workspace.baseUrl === baseUrl : !isRemoteWorkspace(repo.workspace)),
    )?.gitInfo), [repos, key, baseUrl]);
    const ref = useRef({ selected, version: 0 });
    if (ref.current.selected.length !== selected.length || ref.current.selected.some((info, i) => info !== selected[i])) {
        ref.current = { selected, version: ref.current.version + 1 };
    }
    return ref.current.version;
}

interface OwnerOptions {
    client: CocClient;
    /** Concrete dashboard selection; a remote clone key must resolve to a client. */
    routingRef: string;
    enabled: boolean;
}

function useOwnerRead<S>(ownerKey: string, initial: S, unresolvedState: S, unresolved: boolean) {
    const [state, setState] = useState({ key: ownerKey, value: initial });
    const generation = useRef(0);
    useEffect(() => () => { generation.current++; }, [ownerKey]);
    const value = unresolved ? unresolvedState : state.key === ownerKey ? state.value : initial;
    return { value, setState, generation };
}

export function useRepoRailGit({ client, routingRef, enabled, workspaceId }: OwnerOptions & { workspaceId: string }) {
    const baseUrl = client.options?.baseUrl;
    const unresolved = !!parseRemoteCloneKey(routingRef) && !baseUrl;
    const ownerKey = `${routingRef}\u0000${workspaceReadSource(client)}\u0000${workspaceId}`;
    const initial: RepoRailGitInput = { info: IDLE, tree: IDLE };
    const { value, setState, generation } = useOwnerRead(ownerKey, initial, { info: UNAVAILABLE, tree: UNAVAILABLE }, unresolved);
    const version = useOwnerGitInfoVersion([workspaceId], baseUrl);

    const read = useCallback((refresh: boolean) => {
        if (!enabled || unresolved) return;
        const current = ++generation.current;
        setState(prev => {
            const base = prev.key === ownerKey ? prev.value : initial;
            return { key: ownerKey, value: { info: { ...base.info, loading: true }, tree: { ...base.tree, loading: true } } };
        });
        void Promise.allSettled([
            readWorkspaceGitInfo(client, workspaceId, refresh),
            client.git.getWorkingTreeChanges(workspaceId),
        ]).then(([info, tree]) => {
            if (current !== generation.current) return;
            setState(prev => prev.key !== ownerKey ? prev : {
                key: ownerKey,
                value: {
                    info: settle(prev.value.info, info, (data: GitInfoResponse) => data),
                    tree: settle(prev.value.tree, tree, summarizeWorkingTree),
                },
            });
        });
        // `initial` is rebuilt each render; its content is constant.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [enabled, unresolved, ownerKey, client, workspaceId, generation, setState]);

    useEffect(() => { read(false); }, [read, version]);
    const refresh = useCallback(() => read(true), [read]);
    return { input: value, refresh };
}

export function useGroupRailGit({ client, routingRef, enabled, members }: OwnerOptions & { members: readonly RepoGroupMember[] | undefined }) {
    const baseUrl = client.options?.baseUrl;
    const unresolved = !!parseRemoteCloneKey(routingRef) && !baseUrl;
    const liveIds = useMemo(() => (members ?? []).filter(m => !m.stale).map(m => m.workspaceId), [members]);
    const idsKey = liveIds.join('\u0000');
    const ownerKey = `${routingRef}\u0000${workspaceReadSource(client)}\u0000${idsKey}`;
    const initial = { read: IDLE as RailGitRead<Record<string, GitInfoResponse | null>> };
    const { value, setState, generation } = useOwnerRead(ownerKey, initial, { read: UNAVAILABLE }, unresolved);
    const version = useOwnerGitInfoVersion(liveIds, baseUrl);

    const read = useCallback(() => {
        if (!enabled || unresolved || members === undefined) return;
        const ids = idsKey ? idsKey.split('\u0000') : [];
        const current = ++generation.current;
        if (ids.length === 0) {
            setState({ key: ownerKey, value: { read: { data: {}, readAt: Date.now(), loading: false, failed: false } } });
            return;
        }
        setState(prev => ({ key: ownerKey, value: { read: { ...(prev.key === ownerKey ? prev.value.read : IDLE), loading: true } } }));
        void Promise.allSettled([client.workspaces.gitInfoBatch(ids)]).then(([batch]) => {
            if (current !== generation.current) return;
            setState(prev => prev.key !== ownerKey ? prev : {
                key: ownerKey,
                value: { read: settle(prev.value.read, batch, data => data?.results ?? {}) },
            });
        });
    }, [enabled, unresolved, members, idsKey, ownerKey, client, generation, setState]);

    useEffect(() => { read(); }, [read, version]);

    const input = useMemo<GroupRailGitInput>(() => {
        const results = value.read.data;
        const rows: GroupRailGitMember[] | undefined = members?.map(member => ({
            id: member.workspaceId,
            name: member.name || member.workspaceId,
            stale: member.stale,
            // A failed first read is unavailable, not "still reading".
            info: results ? results[member.workspaceId] ?? null : value.read.failed ? null : undefined,
        }));
        return { members: rows, read: value.read };
    }, [members, value.read]);
    return { input, refresh: read };
}
