/**
 * `pickCloneForGroup` — THE single rule for "which clone of this git-remote
 * cluster do I open?".
 *
 * It exists because the rule used to be written twice — once in the remotes
 * picker (`WorkspaceIdentityChip.chooseGroup`, which honoured a remembered
 * clone) and once in the pin segments (`resolvePinnedScopes`, which always took
 * `repos[0]`). They drifted, so clicking a pinned repo tab snapped you back to
 * the cluster's primary clone instead of the machine you were last on.
 */
import { describe, expect, it } from 'vitest';
import {
    buildRemoteCloneKey,
    pickCloneForGroup,
} from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { groupReposByRemote } from '../../../../src/server/spa/client/react/repos/repoGrouping';

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';

const local = (id: string, remoteUrl = SHORTCUTS) => ({
    workspace: { id, name: id, remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
}) as any;

const remote = (id: string, serverId: string, remoteUrl = SHORTCUTS) => ({
    workspace: {
        id,
        name: `${id}@${serverId}`,
        remoteUrl,
        rootPath: `/r/${id}`,
        baseUrl: `http://${serverId}:3000`,
        remote: { serverId, cloneKey: buildRemoteCloneKey(serverId, id) },
    },
    gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl },
}) as any;

describe('pickCloneForGroup', () => {
    const localClone = local('a');
    const boxOne = remote('b', 'box-1');
    const boxTwo = remote('c', 'box-2');
    const repos = [localClone, boxOne, boxTwo];
    const [group] = groupReposByRemote(repos, {});

    it('returns the remembered clone when it still exists in the cluster', () => {
        const remembered = buildRemoteCloneKey('box-2', 'c');
        expect(pickCloneForGroup(group, repos, remembered)).toBe(remembered);
    });

    it('falls back to the cluster primary when nothing is remembered', () => {
        // `sortClonesLocalFirst` keeps the local checkout at repos[0].
        expect(pickCloneForGroup(group, repos, undefined)).toBe('a');
        expect(pickCloneForGroup(group, repos, null)).toBe('a');
        expect(pickCloneForGroup(group, repos, '')).toBe('a');
    });

    it('falls back to the primary when the remembered clone is gone (machine offline / repo removed)', () => {
        const stale = buildRemoteCloneKey('box-3', 'z');
        expect(pickCloneForGroup(group, repos, stale)).toBe('a');
    });

    it('falls back to the primary when the remembered clone belongs to a DIFFERENT cluster', () => {
        const other = local('d', 'https://github.com/acme/forge.git');
        const all = [...repos, other];
        const [shortcutsGroup] = groupReposByRemote(all, {});
        expect(pickCloneForGroup(shortcutsGroup, all, 'd')).toBe('a');
    });

    it('is a no-op for a single-clone cluster: always that clone', () => {
        const solo = [local('solo')];
        const [soloGroup] = groupReposByRemote(solo, {});
        expect(pickCloneForGroup(soloGroup, solo, undefined)).toBe('solo');
        expect(pickCloneForGroup(soloGroup, solo, 'solo')).toBe('solo');
        expect(pickCloneForGroup(soloGroup, solo, 'ghost')).toBe('solo');
    });

    it('returns undefined for an empty cluster rather than a dead target', () => {
        expect(pickCloneForGroup({ repos: [] }, repos, undefined)).toBeUndefined();
        expect(pickCloneForGroup({ repos: [] }, repos, 'a')).toBeUndefined();
    });
});
