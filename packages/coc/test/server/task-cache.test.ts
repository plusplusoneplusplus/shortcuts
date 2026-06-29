/**
 * Tests for TaskCacheService — in-memory TTL cache for task scan results.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TaskCacheService } from '../../src/server/tasks/task-cache';

let cache: TaskCacheService;

beforeEach(() => {
    cache = new TaskCacheService(1000); // 1 second TTL for tests
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('TaskCacheService', () => {
    // ========================================================================
    // key()
    // ========================================================================

    describe('key()', () => {
        it('builds key from workspaceId and taskRootPath', () => {
            expect(TaskCacheService.key('ws1', '/path/to/tasks')).toBe('ws1:/path/to/tasks');
        });
    });

    // ========================================================================
    // get / set
    // ========================================================================

    describe('get / set', () => {
        it('returns undefined for missing key', () => {
            expect(cache.get('missing')).toBeUndefined();
        });

        it('stores and retrieves a value', () => {
            cache.set('k1', { hello: 'world' });
            expect(cache.get('k1')).toEqual({ hello: 'world' });
        });

        it('returns typed value', () => {
            cache.set('k1', [1, 2, 3]);
            const val = cache.get<number[]>('k1');
            expect(val).toEqual([1, 2, 3]);
        });

        it('returns undefined after TTL expires', () => {
            const now = Date.now();
            vi.spyOn(Date, 'now').mockReturnValue(now);

            cache.set('k1', 'data');
            expect(cache.get('k1')).toBe('data');

            // Jump past TTL
            vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
            expect(cache.get('k1')).toBeUndefined();
        });

        it('cleans up expired entry on get', () => {
            const now = Date.now();
            vi.spyOn(Date, 'now').mockReturnValue(now);

            cache.set('k1', 'data');
            expect(cache.size).toBe(1);

            vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
            cache.get('k1'); // triggers cleanup
            expect(cache.size).toBe(0);
        });

        it('overwrites existing entry', () => {
            cache.set('k1', 'old');
            cache.set('k1', 'new');
            expect(cache.get('k1')).toBe('new');
        });
    });

    // ========================================================================
    // invalidateWorkspace
    // ========================================================================

    describe('invalidateWorkspace', () => {
        it('removes all entries for a workspace', () => {
            cache.set('ws1:/tasks', 'a');
            cache.set('ws1:/other', 'b');
            cache.set('ws2:/tasks', 'c');

            cache.invalidateWorkspace('ws1');

            expect(cache.get('ws1:/tasks')).toBeUndefined();
            expect(cache.get('ws1:/other')).toBeUndefined();
            expect(cache.get('ws2:/tasks')).toBe('c');
        });

        it('no-op for unknown workspace', () => {
            cache.set('ws1:/tasks', 'a');
            cache.invalidateWorkspace('ws99');
            expect(cache.get('ws1:/tasks')).toBe('a');
        });
    });

    // ========================================================================
    // invalidateAll / clear
    // ========================================================================

    describe('invalidateAll', () => {
        it('removes all entries', () => {
            cache.set('ws1:/a', 1);
            cache.set('ws2:/b', 2);
            cache.invalidateAll();
            expect(cache.size).toBe(0);
        });
    });

    describe('clear', () => {
        it('removes all entries', () => {
            cache.set('k1', 1);
            cache.set('k2', 2);
            cache.clear();
            expect(cache.size).toBe(0);
        });
    });

    // ========================================================================
    // size
    // ========================================================================

    describe('size', () => {
        it('reflects number of entries', () => {
            expect(cache.size).toBe(0);
            cache.set('a', 1);
            expect(cache.size).toBe(1);
            cache.set('b', 2);
            expect(cache.size).toBe(2);
        });
    });

    // ========================================================================
    // Default TTL
    // ========================================================================

    describe('default TTL', () => {
        it('uses 5 minute default', () => {
            const defaultCache = new TaskCacheService();
            const now = Date.now();
            vi.spyOn(Date, 'now').mockReturnValue(now);

            defaultCache.set('k', 'v');
            // Still valid at 4:59
            vi.spyOn(Date, 'now').mockReturnValue(now + 4 * 60 * 1000 + 59 * 1000);
            expect(defaultCache.get('k')).toBe('v');

            // Expired at 5:01
            vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60 * 1000 + 1);
            expect(defaultCache.get('k')).toBeUndefined();
        });
    });

    // ========================================================================
    // Unified-cache backing: LRU cap + workspace-tagged invalidation
    // ========================================================================

    describe('unified-cache backing', () => {
        // Behavior change logged in progress.md (AC-06): the cache was
        // previously unbounded; it now applies the default 500-entry LRU cap.
        it('evicts the least-recently-used entry past the default 500-entry cap', () => {
            for (let i = 0; i < 500; i++) {
                cache.set(`ws:/task-${i}`, i);
            }
            expect(cache.size).toBe(500);

            // One more entry evicts the oldest (task-0); newest survives.
            cache.set('ws:/task-500', 500);
            expect(cache.size).toBe(500);
            expect(cache.get('ws:/task-0')).toBeUndefined();
            expect(cache.get('ws:/task-500')).toBe(500);
        });

        it('invalidateWorkspace keys off the workspace prefix of the cache key', () => {
            cache.set(TaskCacheService.key('wsA', '/repo/tasks'), 'a');
            cache.set(TaskCacheService.key('wsA', '/repo/other'), 'b');
            cache.set(TaskCacheService.key('wsB', '/repo/tasks'), 'c');

            cache.invalidateWorkspace('wsA');

            expect(cache.get(TaskCacheService.key('wsA', '/repo/tasks'))).toBeUndefined();
            expect(cache.get(TaskCacheService.key('wsA', '/repo/other'))).toBeUndefined();
            expect(cache.get(TaskCacheService.key('wsB', '/repo/tasks'))).toBe('c');
        });
    });
});
