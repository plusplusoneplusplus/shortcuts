/**
 * Tests for repoGrouping utility functions — groupKey and applyGroupOrder.
 */

import { describe, it, expect } from 'vitest';
import {
    groupKey,
    applyGroupOrder,
    groupReposByRemote,
    normalizeRemoteUrl,
    remoteUrlLabel,
} from '../../../../src/server/spa/client/react/repos/repoGrouping';
import type { RepoGroup, RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGroup(normalizedUrl: string | null, repoIds: string[]): RepoGroup {
    return {
        normalizedUrl,
        label: normalizedUrl ?? repoIds[0] ?? 'unknown',
        repos: repoIds.map(id => ({ workspace: { id, name: id, rootPath: `/repos/${id}` } })),
        expanded: true,
    };
}

// ── groupKey ─────────────────────────────────────────────────────────────────

describe('groupKey', () => {
    it('returns normalizedUrl for grouped repos', () => {
        const g = makeGroup('github.com/user/repo', ['ws-1', 'ws-2']);
        expect(groupKey(g)).toBe('github.com/user/repo');
    });

    it('returns workspace:{id} for ungrouped repos (no normalizedUrl)', () => {
        const g = makeGroup(null, ['ws-abc']);
        expect(groupKey(g)).toBe('workspace:ws-abc');
    });

    it('returns workspace:unknown when ungrouped group has no repos', () => {
        const g: RepoGroup = { normalizedUrl: null, label: 'empty', repos: [], expanded: true };
        expect(groupKey(g)).toBe('workspace:unknown');
    });
});

// ── applyGroupOrder ───────────────────────────────────────────────────────────

describe('applyGroupOrder', () => {
    it('returns groups unchanged when order is empty', () => {
        const groups = [makeGroup('github.com/a', ['1']), makeGroup('github.com/b', ['2'])];
        expect(applyGroupOrder(groups, [])).toEqual(groups);
    });

    it('reorders two groups', () => {
        const gA = makeGroup('github.com/a', ['1']);
        const gB = makeGroup('github.com/b', ['2']);
        const result = applyGroupOrder([gA, gB], ['github.com/b', 'github.com/a']);
        expect(result[0]).toBe(gB);
        expect(result[1]).toBe(gA);
    });

    it('puts groups not in order array at the end', () => {
        const gA = makeGroup('github.com/a', ['1']);
        const gB = makeGroup('github.com/b', ['2']);
        const gC = makeGroup('github.com/c', ['3']);
        const result = applyGroupOrder([gA, gB, gC], ['github.com/c', 'github.com/a']);
        expect(groupKey(result[0])).toBe('github.com/c');
        expect(groupKey(result[1])).toBe('github.com/a');
        expect(groupKey(result[2])).toBe('github.com/b');
    });

    it('handles ungrouped repos with workspace: keys', () => {
        const gA = makeGroup(null, ['ws-1']);
        const gB = makeGroup(null, ['ws-2']);
        const result = applyGroupOrder([gA, gB], ['workspace:ws-2', 'workspace:ws-1']);
        expect(groupKey(result[0])).toBe('workspace:ws-2');
        expect(groupKey(result[1])).toBe('workspace:ws-1');
    });

    it('does not mutate the original groups array', () => {
        const gA = makeGroup('github.com/a', ['1']);
        const gB = makeGroup('github.com/b', ['2']);
        const original = [gA, gB];
        applyGroupOrder(original, ['github.com/b', 'github.com/a']);
        expect(original[0]).toBe(gA);
    });
});
