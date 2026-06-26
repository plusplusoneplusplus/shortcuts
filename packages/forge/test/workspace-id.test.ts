/**
 * Workspace ID generation tests.
 *
 * Covers the machine-scoped (v2) physical workspace ID scheme: same path on
 * different hostnames must produce different IDs; same hostname + same path must
 * be stable; path normalization; and the discriminators that keep virtual/system
 * workspaces out of the machine-scoping/migration paths.
 */

import path from 'path';
import { describe, it, expect } from 'vitest';
import {
    computeWorkspaceId,
    normalizeWorkspaceRootPath,
    normalizeWorkspaceHostname,
    isV2WorkspaceId,
    isLegacyPhysicalWorkspaceId,
    isPhysicalWorkspaceId,
    WORKSPACE_ID_V2_PREFIX,
} from '../src/index';

const ABS = path.resolve('/home/alice/projects/myrepo');

describe('computeWorkspaceId', () => {
    it('produces a ws-v2- prefixed id', () => {
        const id = computeWorkspaceId('host-a', ABS);
        expect(id.startsWith(WORKSPACE_ID_V2_PREFIX)).toBe(true);
        expect(id).toMatch(/^ws-v2-[0-9a-f]{24}$/);
    });

    it('is stable for the same hostname + same path', () => {
        const a = computeWorkspaceId('host-a', ABS);
        const b = computeWorkspaceId('host-a', ABS);
        expect(a).toBe(b);
    });

    it('produces DIFFERENT ids for the same path on different hostnames', () => {
        const onA = computeWorkspaceId('machine-a', ABS);
        const onB = computeWorkspaceId('machine-b', ABS);
        expect(onA).not.toBe(onB);
    });

    it('produces different ids for different paths on the same hostname', () => {
        const one = computeWorkspaceId('host-a', path.resolve('/repos/one'));
        const two = computeWorkspaceId('host-a', path.resolve('/repos/two'));
        expect(one).not.toBe(two);
    });

    it('normalizes trailing separators and duplicate separators to the same id', () => {
        const base = computeWorkspaceId('host-a', path.resolve('/repos/proj'));
        const trailing = computeWorkspaceId('host-a', path.resolve('/repos/proj') + path.sep);
        const dup = computeWorkspaceId('host-a', '/repos//proj');
        expect(trailing).toBe(base);
        expect(dup).toBe(base);
    });

    it('falls back to a stable identity for an empty/whitespace hostname', () => {
        const empty = computeWorkspaceId('', ABS);
        const blank = computeWorkspaceId('   ', ABS);
        const nil = computeWorkspaceId(null, ABS);
        expect(empty).toBe(blank);
        expect(empty).toBe(nil);
        expect(empty.startsWith(WORKSPACE_ID_V2_PREFIX)).toBe(true);
    });

    it('treats the hostname/path boundary as delimiter-safe (no aliasing)', () => {
        // Without a safe delimiter, host "ab" + path "/c" could alias host "a"
        // + path "b/c". The NUL delimiter prevents that.
        const left = computeWorkspaceId('ab', path.resolve('/c'));
        const right = computeWorkspaceId('a', path.resolve('/b/c'));
        expect(left).not.toBe(right);
    });
});

describe('normalizeWorkspaceRootPath', () => {
    it('strips a trailing separator', () => {
        expect(normalizeWorkspaceRootPath(path.resolve('/x/y') + path.sep)).toBe(path.resolve('/x/y'));
    });

    it('returns an absolute path unchanged when already canonical', () => {
        const abs = path.resolve('/x/y');
        expect(normalizeWorkspaceRootPath(abs)).toBe(abs);
    });
});

describe('normalizeWorkspaceHostname', () => {
    it('trims and falls back to unknown-host', () => {
        expect(normalizeWorkspaceHostname('  Foo  ')).toBe('Foo');
        expect(normalizeWorkspaceHostname('')).toBe('unknown-host');
        expect(normalizeWorkspaceHostname(undefined)).toBe('unknown-host');
        expect(normalizeWorkspaceHostname(null)).toBe('unknown-host');
    });
});

describe('workspace id discriminators', () => {
    const v2 = computeWorkspaceId('host-a', ABS);
    const legacy = 'ws-1a2b3c'; // old path-only scheme

    it('classifies v2 ids', () => {
        expect(isV2WorkspaceId(v2)).toBe(true);
        expect(isLegacyPhysicalWorkspaceId(v2)).toBe(false);
        expect(isPhysicalWorkspaceId(v2)).toBe(true);
    });

    it('classifies legacy path-only ids', () => {
        expect(isV2WorkspaceId(legacy)).toBe(false);
        expect(isLegacyPhysicalWorkspaceId(legacy)).toBe(true);
        expect(isPhysicalWorkspaceId(legacy)).toBe(true);
    });

    it('excludes virtual/system workspaces from every physical discriminator', () => {
        for (const virtual of ['my_work', 'my_life', 'global-workspace-00']) {
            expect(isV2WorkspaceId(virtual)).toBe(false);
            expect(isLegacyPhysicalWorkspaceId(virtual)).toBe(false);
            expect(isPhysicalWorkspaceId(virtual)).toBe(false);
        }
    });

    it('handles null/undefined ids safely', () => {
        expect(isV2WorkspaceId(null)).toBe(false);
        expect(isLegacyPhysicalWorkspaceId(undefined)).toBe(false);
        expect(isPhysicalWorkspaceId(null)).toBe(false);
    });
});
