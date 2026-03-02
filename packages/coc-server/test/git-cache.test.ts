/**
 * Unit tests for GitCacheService.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { GitCacheService } from '../src/git-cache';

describe('GitCacheService', () => {
    let cache: GitCacheService;

    beforeEach(() => {
        cache = new GitCacheService();
    });

    // ========================================================================
    // get / set
    // ========================================================================

    it('returns undefined for unknown key', () => {
        expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('stores and retrieves a value', () => {
        cache.set('ws1:commits:50:0', { commits: [1, 2] });
        expect(cache.get('ws1:commits:50:0')).toEqual({ commits: [1, 2] });
    });

    it('overwrites existing value', () => {
        cache.set('ws1:commits:50:0', 'old');
        cache.set('ws1:commits:50:0', 'new');
        expect(cache.get('ws1:commits:50:0')).toBe('new');
    });

    // ========================================================================
    // invalidateMutable
    // ========================================================================

    describe('invalidateMutable', () => {
        it('removes mutable keys for the workspace', () => {
            cache.set('ws1:commits:50:0', 'data');
            cache.set('ws1:branch-range', 'range');
            cache.invalidateMutable('ws1');
            expect(cache.get('ws1:commits:50:0')).toBeUndefined();
            expect(cache.get('ws1:branch-range')).toBeUndefined();
        });

        it('preserves immutable commit-files and commit-diff keys', () => {
            cache.set('ws1:commit-files:abc123', { files: [] });
            cache.set('ws1:commit-diff:abc123', { diff: 'patch' });
            cache.invalidateMutable('ws1');
            expect(cache.get('ws1:commit-files:abc123')).toEqual({ files: [] });
            expect(cache.get('ws1:commit-diff:abc123')).toEqual({ diff: 'patch' });
        });

        it('does not affect other workspaces', () => {
            cache.set('ws1:commits:50:0', 'ws1-data');
            cache.set('ws2:commits:50:0', 'ws2-data');
            cache.invalidateMutable('ws1');
            expect(cache.get('ws1:commits:50:0')).toBeUndefined();
            expect(cache.get('ws2:commits:50:0')).toBe('ws2-data');
        });
    });

    // ========================================================================
    // invalidateWorkspace
    // ========================================================================

    describe('invalidateWorkspace', () => {
        it('removes all keys for the workspace including immutable', () => {
            cache.set('ws1:commits:50:0', 'data');
            cache.set('ws1:commit-files:abc123', { files: [] });
            cache.set('ws1:commit-diff:abc123', { diff: 'patch' });
            cache.invalidateWorkspace('ws1');
            expect(cache.get('ws1:commits:50:0')).toBeUndefined();
            expect(cache.get('ws1:commit-files:abc123')).toBeUndefined();
            expect(cache.get('ws1:commit-diff:abc123')).toBeUndefined();
        });

        it('does not affect other workspaces', () => {
            cache.set('ws1:commits:50:0', 'ws1');
            cache.set('ws2:commits:50:0', 'ws2');
            cache.invalidateWorkspace('ws1');
            expect(cache.get('ws2:commits:50:0')).toBe('ws2');
        });
    });

    // ========================================================================
    // size / clear
    // ========================================================================

    it('reports correct size', () => {
        expect(cache.size).toBe(0);
        cache.set('a', 1);
        cache.set('b', 2);
        expect(cache.size).toBe(2);
    });

    it('clear removes all entries', () => {
        cache.set('ws1:commits:50:0', 'data');
        cache.set('ws2:branch-range', 'range');
        cache.clear();
        expect(cache.size).toBe(0);
    });
});
