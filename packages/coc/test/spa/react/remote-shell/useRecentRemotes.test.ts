import { describe, expect, it } from 'vitest';
import {
    getPresentRecentRemoteKeys,
    mergeRecentRemoteUse,
    resolveRecentRemoteGroups,
} from '../../../../src/server/spa/client/react/features/remote-shell/useRecentRemotes';
import type { RepoGroup } from '../../../../src/server/spa/client/react/repos/repoGrouping';

const group = (normalizedUrl: string, label: string): RepoGroup => ({
    normalizedUrl,
    label,
    expanded: true,
    repos: [{
        workspace: { id: label, name: label, remoteUrl: `https://${normalizedUrl}.git` },
        gitInfo: { isGitRepo: true, branch: 'main', dirty: false, remoteUrl: `https://${normalizedUrl}.git` },
    }],
});

describe('recent remote helpers', () => {
    it('dedupes and caps MRU keys with the newest key first', () => {
        const merged = mergeRecentRemoteUse(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'c');
        expect(merged).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h']);
        expect(mergeRecentRemoteUse(merged, 'i')).toEqual(['i', 'c', 'a', 'b', 'd', 'e', 'f', 'g']);
    });

    it('drops stale keys that no longer have a present remote group', () => {
        const groups = [group('github.com/acme/shortcuts', 'shortcuts'), group('github.com/acme/forge', 'forge')];
        expect(getPresentRecentRemoteKeys(['stale', 'github.com/acme/forge', 'github.com/acme/forge'], groups))
            .toEqual(['github.com/acme/forge']);
    });

    it('falls back to default group order until the user has saved recents', () => {
        const groups = [
            group('github.com/acme/a', 'a'),
            group('github.com/acme/b', 'b'),
            group('github.com/acme/c', 'c'),
            group('github.com/acme/d', 'd'),
            group('github.com/acme/e', 'e'),
        ];
        const resolved = resolveRecentRemoteGroups(groups, []);
        expect(resolved.recentGroups.map(g => g.label)).toEqual(['a', 'b', 'c', 'd']);
        expect(resolved.remainingGroups.map(g => g.label)).toEqual(['e']);
    });

    it('orders saved recents first and leaves the rest for Show all', () => {
        const groups = [
            group('github.com/acme/a', 'a'),
            group('github.com/acme/b', 'b'),
            group('github.com/acme/c', 'c'),
        ];
        const resolved = resolveRecentRemoteGroups(groups, ['github.com/acme/c', 'github.com/acme/a']);
        expect(resolved.recentGroups.map(g => g.label)).toEqual(['c', 'a']);
        expect(resolved.remainingGroups.map(g => g.label)).toEqual(['b']);
    });
});
