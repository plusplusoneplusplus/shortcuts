/**
 * pinnedScopes — pure model for the scope pins rendered as segments in the
 * ScopeSlideSwitcher.
 *
 * The central invariant under test is the discriminated key space: a `RepoGroup`
 * key (git-remote clustering) and a repo-group *virtual workspace* id are both
 * "repo groups" in the UI and must never resolve into each other.
 */
import { describe, expect, it } from 'vitest';
import {
    MAX_PINNED_SCOPES,
    isPinnedScope,
    movePinnedScope,
    parsePinnedScope,
    parsePinnedScopes,
    resolvePinnedScopes,
    serializePinnedScope,
    togglePinnedScope,
    type PinnedScopeRef,
} from '../../../../src/server/spa/client/react/features/remote-shell/pinnedScopes';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';
import { groupReposByRemote } from '../../../../src/server/spa/client/react/repos/repoGrouping';

const repo = (id: string, name: string, remoteUrl?: string) => ({
    workspace: { id, name, color: '#0078d4', remoteUrl, rootPath: `/r/${id}` },
    gitInfo: { isGitRepo: !!remoteUrl, branch: 'main', dirty: false, remoteUrl },
}) as any;

const SHORTCUTS = 'https://github.com/acme/shortcuts.git';
const FORGE = 'https://github.com/acme/forge.git';

const repoPin = (key: string): PinnedScopeRef => ({ kind: 'repo', key });
const groupPin = (key: string): PinnedScopeRef => ({ kind: 'group', key });

describe('serialize / parse', () => {
    it('round-trips both kinds through a prefixed string', () => {
        expect(serializePinnedScope(repoPin('github.com/acme/app'))).toBe('repo:github.com/acme/app');
        expect(serializePinnedScope(groupPin('group-ai'))).toBe('group:group-ai');
        expect(parsePinnedScope('repo:github.com/acme/app')).toEqual(repoPin('github.com/acme/app'));
        expect(parsePinnedScope('group:group-ai')).toEqual(groupPin('group-ai'));
    });

    it('splits on the FIRST colon so a `workspace:<id>` group key survives', () => {
        // `groupKey` falls back to `workspace:<id>` for an un-remoted clone, so
        // the key itself contains a colon.
        expect(parsePinnedScope('repo:workspace:ws-1')).toEqual(repoPin('workspace:ws-1'));
        expect(serializePinnedScope(repoPin('workspace:ws-1'))).toBe('repo:workspace:ws-1');
    });

    it('rejects unprefixed, unknown-prefix, empty-key and non-string entries', () => {
        for (const bad of ['group-ai', 'other:x', 'repo:', ':x', '', 42, null, undefined, {}]) {
            expect(parsePinnedScope(bad)).toBeNull();
        }
    });

    it('parses a stored list, dropping invalid entries and duplicates', () => {
        const parsed = parsePinnedScopes(['repo:a', 'bogus', 'repo:a', 'group:g', 42]);
        expect(parsed).toEqual([repoPin('a'), groupPin('g')]);
    });

    it('keeps `repo:x` and `group:x` distinct — the collision the prefix exists for', () => {
        const parsed = parsePinnedScopes(['repo:x', 'group:x']);
        expect(parsed).toEqual([repoPin('x'), groupPin('x')]);
        expect(isPinnedScope(parsed, repoPin('x'))).toBe(true);
        expect(isPinnedScope(parsed, groupPin('x'))).toBe(true);
        expect(isPinnedScope([repoPin('x')], groupPin('x'))).toBe(false);
    });

    it('caps a stored list at the limit', () => {
        const raw = Array.from({ length: 20 }, (_, i) => `repo:r${i}`);
        expect(parsePinnedScopes(raw)).toHaveLength(MAX_PINNED_SCOPES);
    });

    it('returns an empty list for a non-array', () => {
        expect(parsePinnedScopes(undefined)).toEqual([]);
        expect(parsePinnedScopes('repo:a')).toEqual([]);
    });
});

describe('togglePinnedScope', () => {
    it('appends when absent and removes when present', () => {
        const pinned = togglePinnedScope([], repoPin('a'));
        expect(pinned).toEqual([repoPin('a')]);
        expect(togglePinnedScope(pinned, repoPin('a'))).toEqual([]);
    });

    it('appends to the end, preserving user order', () => {
        expect(togglePinnedScope([repoPin('a')], groupPin('g'))).toEqual([repoPin('a'), groupPin('g')]);
    });

    it('refuses a new pin past the cap instead of evicting the oldest', () => {
        const full = Array.from({ length: MAX_PINNED_SCOPES }, (_, i) => repoPin(`r${i}`));
        expect(togglePinnedScope(full, repoPin('new'))).toEqual(full);
        // Unpinning still works while full.
        expect(togglePinnedScope(full, repoPin('r0'))).toHaveLength(MAX_PINNED_SCOPES - 1);
    });
});

describe('movePinnedScope', () => {
    const pins = [repoPin('a'), repoPin('b'), groupPin('c')];

    it('moves left and right', () => {
        expect(movePinnedScope(pins, repoPin('b'), -1)).toEqual([repoPin('b'), repoPin('a'), groupPin('c')]);
        expect(movePinnedScope(pins, repoPin('b'), 1)).toEqual([repoPin('a'), groupPin('c'), repoPin('b')]);
    });

    it('is a no-op at the ends and for an unknown ref', () => {
        expect(movePinnedScope(pins, repoPin('a'), -1)).toEqual(pins);
        expect(movePinnedScope(pins, groupPin('c'), 1)).toEqual(pins);
        expect(movePinnedScope(pins, repoPin('missing'), 1)).toEqual(pins);
    });
});

describe('resolvePinnedScopes', () => {
    const repos = [repo('a', 'shortcuts', SHORTCUTS), repo('b', 'shortcuts-2', SHORTCUTS), repo('c', 'forge', FORGE)];
    const groups = groupReposByRemote(repos, {});
    const ctx = (over: Partial<Parameters<typeof resolvePinnedScopes>[1]> = {}) => ({
        groups,
        groupWorkspaces: [{ id: 'group-ai', name: 'ai-repos' }],
        cloneStatus: {},
        unseenCounts: {},
        ...over,
    });

    it('resolves a repo pin to its cluster label and primary clone as the click target', () => {
        const [resolved] = resolvePinnedScopes([repoPin('github.com/acme/shortcuts')], ctx());
        expect(resolved.label).toBe('shortcuts');
        expect(resolved.targetId).toBe('a');
        expect(resolved.workspaceId).toBe('a');
        expect(resolved.id).toBe('repo:github.com/acme/shortcuts');
    });

    // Regression: a repo pin used to hard-code `group.repos[0]`, so clicking it
    // snapped you back to the cluster's primary clone every time instead of the
    // machine you were last on. It now shares `pickCloneForGroup` with the
    // picker's `chooseGroup`.
    describe('remembered clone', () => {
        it('targets the clone the user was last on for that cluster', () => {
            const [resolved] = resolvePinnedScopes(
                [repoPin('github.com/acme/shortcuts')],
                ctx({ lastCloneByRemote: { 'github.com/acme/shortcuts': 'b' } }),
            );
            expect(resolved.targetId).toBe('b');
            // Same value — so the pop-out / right-click menu land on that clone too.
            expect(resolved.workspaceId).toBe('b');
        });

        it('honours a REMOTE clone selection id', () => {
            const remoteClone = {
                workspace: {
                    id: 'r1',
                    name: 'shortcuts@box-2',
                    remoteUrl: SHORTCUTS,
                    baseUrl: 'http://box-2:3000',
                    remote: { serverId: 'box-2', cloneKey: buildRemoteCloneKey('box-2', 'r1') },
                },
                gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: SHORTCUTS },
            } as any;
            const withRemote = groupReposByRemote([...repos, remoteClone], {});
            const key = buildRemoteCloneKey('box-2', 'r1');
            const [resolved] = resolvePinnedScopes(
                [repoPin('github.com/acme/shortcuts')],
                ctx({ groups: withRemote, lastCloneByRemote: { 'github.com/acme/shortcuts': key } }),
            );
            expect(resolved.targetId).toBe(key);
        });

        it('falls back to the primary when the remembered clone is gone (machine offline)', () => {
            const [resolved] = resolvePinnedScopes(
                [repoPin('github.com/acme/shortcuts')],
                ctx({ lastCloneByRemote: { 'github.com/acme/shortcuts': 'vanished' } }),
            );
            expect(resolved.targetId).toBe('a');
        });

        it('ignores a memory recorded for a DIFFERENT cluster', () => {
            const [resolved] = resolvePinnedScopes(
                [repoPin('github.com/acme/shortcuts')],
                // 'c' is the forge clone: real, but not a member of this cluster.
                ctx({ lastCloneByRemote: { 'github.com/acme/shortcuts': 'c', 'github.com/acme/forge': 'c' } }),
            );
            expect(resolved.targetId).toBe('a');
        });

        it('is unaffected on a single-clone cluster', () => {
            const [resolved] = resolvePinnedScopes(
                [repoPin('github.com/acme/forge')],
                ctx({ lastCloneByRemote: { 'github.com/acme/forge': 'c' } }),
            );
            expect(resolved.targetId).toBe('c');
        });

        it('resolves identically with no map at all (cold load / corrupt storage)', () => {
            const bare = { groups, groupWorkspaces: [], cloneStatus: {}, unseenCounts: {} };
            const [resolved] = resolvePinnedScopes([repoPin('github.com/acme/shortcuts')], bare);
            expect(resolved.targetId).toBe('a');
            const [empty] = resolvePinnedScopes(
                [repoPin('github.com/acme/shortcuts')],
                ctx({ lastCloneByRemote: {} }),
            );
            expect(empty.targetId).toBe('a');
        });

        it('leaves `group:` pins alone — they have no clones to choose between', () => {
            const [resolved] = resolvePinnedScopes(
                [groupPin('group-ai')],
                ctx({ lastCloneByRemote: { 'group-ai': 'b' } }),
            );
            expect(resolved.targetId).toBe('group-ai');
        });
    });

    it('sums unseen counts across every clone of a pinned remote', () => {
        const [resolved] = resolvePinnedScopes(
            [repoPin('github.com/acme/shortcuts')],
            ctx({ unseenCounts: { a: 2, b: 3, c: 9 } }),
        );
        expect(resolved.unseen).toBe(5);
    });

    it('resolves a group pin to the virtual workspace name and id', () => {
        const [resolved] = resolvePinnedScopes([groupPin('group-ai')], ctx({ unseenCounts: { 'group-ai': 4 } }));
        expect(resolved.label).toBe('ai-repos');
        expect(resolved.targetId).toBe('group-ai');
        expect(resolved.unseen).toBe(4);
        // Neutral dot: a group aggregates clones with independent health.
        expect(resolved.color).toBe('#848484');
    });

    it('falls back to the raw group id while the workspace list is still loading', () => {
        const [resolved] = resolvePinnedScopes([groupPin('group-ai')], ctx({ groupWorkspaces: [] as any }));
        expect(resolved).toBeUndefined();
        const [named] = resolvePinnedScopes([groupPin('group-ai')], ctx({ groupWorkspaces: [{ id: 'group-ai' }] }));
        expect(named.label).toBe('group-ai');
    });

    it('drops stale pins from the rendered set without touching the stored list', () => {
        const stored = [repoPin('github.com/acme/gone'), groupPin('group-deleted'), repoPin('github.com/acme/forge')];
        const resolved = resolvePinnedScopes(stored, ctx());
        expect(resolved.map(r => r.label)).toEqual(['forge']);
        // The caller's array is untouched — stale pins come back with their target.
        expect(stored).toHaveLength(3);
    });

    it('never resolves a `group:` pin against the git-remote cluster space (or vice versa)', () => {
        // Same bare key in both spaces; only the correctly-kinded pin resolves.
        const groupsWithColliding = groupReposByRemote([repo('group-ai', 'group-ai')], {});
        const collidingCtx = ctx({ groups: groupsWithColliding });
        expect(resolvePinnedScopes([groupPin('workspace:group-ai')], collidingCtx)).toEqual([]);
        expect(resolvePinnedScopes([repoPin('group-ai')], collidingCtx)).toEqual([]);
        expect(resolvePinnedScopes([repoPin('workspace:group-ai')], collidingCtx)).toHaveLength(1);
        expect(resolvePinnedScopes([groupPin('group-ai')], collidingCtx)).toHaveLength(1);
    });

    it('preserves stored order', () => {
        const resolved = resolvePinnedScopes(
            [repoPin('github.com/acme/forge'), groupPin('group-ai'), repoPin('github.com/acme/shortcuts')],
            ctx(),
        );
        expect(resolved.map(r => r.label)).toEqual(['forge', 'ai-repos', 'shortcuts']);
    });
});
