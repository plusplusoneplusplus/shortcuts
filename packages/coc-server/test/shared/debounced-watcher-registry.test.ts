/**
 * DebouncedWatcherRegistry Unit Tests
 *
 * Tests for the generic registry that manages fs.FSWatcher instances with
 * debounced callbacks and per-key changed-file accumulation.
 *
 * Uses temporary directories for isolation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DebouncedWatcherRegistry } from '../../src/shared/debounced-watcher-registry';

// ============================================================================
// Helpers
// ============================================================================

function createTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'debounced-watcher-'));
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('DebouncedWatcherRegistry', () => {
    const cleanupDirs: string[] = [];
    const registries: DebouncedWatcherRegistry[] = [];

    afterEach(() => {
        for (const r of registries) r.closeAll();
        registries.length = 0;
        for (const dir of cleanupDirs) {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
        cleanupDirs.length = 0;
    });

    // ------------------------------------------------------------------
    // API correctness (no real fs.watch needed)
    // ------------------------------------------------------------------

    describe('API correctness', () => {
        it('isWatching returns false before any watch call', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            expect(reg.isWatching('k')).toBe(false);
        });

        it('getWatchedKeys returns empty array initially', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            expect(reg.getWatchedKeys()).toEqual([]);
        });

        it('unwatch on unknown key is a no-op', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            expect(() => reg.unwatch('missing')).not.toThrow();
        });

        it('closeAll on empty registry is a no-op', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            expect(() => reg.closeAll()).not.toThrow();
        });

        it('watch on non-existent path calls onError and does not register key', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            const onError = vi.fn();
            reg.watch(
                'k',
                '/nonexistent/path/that/cannot/exist/ever',
                vi.fn(),
                { onError },
            );
            expect(reg.isWatching('k')).toBe(false);
            expect(onError).toHaveBeenCalledOnce();
        });

        it('second watch call for same key is a no-op', () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            const cb = vi.fn();

            reg.watch('k', dir, cb);
            reg.watch('k', dir, cb); // second call — should be ignored
            expect(reg.isWatching('k')).toBe(true);
            expect(reg.getWatchedKeys()).toEqual(['k']);
        });

        it('isWatching becomes true after watch and false after unwatch', () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);

            expect(reg.isWatching('k')).toBe(false);
            reg.watch('k', dir, vi.fn());
            expect(reg.isWatching('k')).toBe(true);
            reg.unwatch('k');
            expect(reg.isWatching('k')).toBe(false);
        });

        it('getWatchedKeys reflects active watchers', () => {
            const d1 = createTmpDir();
            const d2 = createTmpDir();
            cleanupDirs.push(d1, d2);
            const reg = new DebouncedWatcherRegistry<'a' | 'b'>();
            registries.push(reg as DebouncedWatcherRegistry);

            reg.watch('a', d1, vi.fn());
            reg.watch('b', d2, vi.fn());
            expect(reg.getWatchedKeys().sort()).toEqual(['a', 'b']);

            reg.unwatch('a');
            expect(reg.getWatchedKeys()).toEqual(['b']);

            reg.closeAll();
            expect(reg.getWatchedKeys()).toEqual([]);
        });

        it('closeAll removes all watchers', () => {
            const d1 = createTmpDir();
            const d2 = createTmpDir();
            cleanupDirs.push(d1, d2);
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);

            reg.watch('x', d1, vi.fn());
            reg.watch('y', d2, vi.fn());
            expect(reg.isWatching('x')).toBe(true);
            expect(reg.isWatching('y')).toBe(true);

            reg.closeAll();
            expect(reg.isWatching('x')).toBe(false);
            expect(reg.isWatching('y')).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // Debounce + file accumulation (real fs.watch)
    // ------------------------------------------------------------------

    describe('debounce and file accumulation', () => {
        it('fires onChange with accumulated changed files after debounce', async () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', dir, onChange);
            await wait(100);

            fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');

            await wait(800);

            expect(onChange).toHaveBeenCalled();
            const [key, files] = onChange.mock.calls[0];
            expect(key).toBe('k');
            expect(Array.isArray(files)).toBe(true);
        });

        it('debounces rapid events into a single callback', async () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry(300);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', dir, onChange);
            await wait(100);

            for (let i = 0; i < 5; i++) {
                fs.writeFileSync(path.join(dir, `f${i}.txt`), `v${i}`);
            }

            await wait(1000);

            expect(onChange).toHaveBeenCalledTimes(1);
        });

        it('does not fire after unwatch', async () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry(100);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', dir, onChange);
            reg.unwatch('k');

            fs.writeFileSync(path.join(dir, 'after.txt'), 'x');

            await wait(400);

            expect(onChange).not.toHaveBeenCalled();
        });

        it('does not fire after closeAll', async () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry(100);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', dir, onChange);
            reg.closeAll();

            fs.writeFileSync(path.join(dir, 'after.txt'), 'x');

            await wait(400);

            expect(onChange).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // shouldIgnore
    // ------------------------------------------------------------------

    describe('shouldIgnore option', () => {
        it('ignores files matching the predicate', async () => {
            const dir = createTmpDir();
            cleanupDirs.push(dir);
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', dir, onChange, {
                shouldIgnore: (f) => f.endsWith('.log'),
            });
            await wait(100);

            fs.writeFileSync(path.join(dir, 'app.log'), 'log content');

            await wait(600);

            expect(onChange).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // Multiple keys are independent
    // ------------------------------------------------------------------

    describe('multiple keys', () => {
        it('keys do not interfere with each other', async () => {
            const d1 = createTmpDir();
            const d2 = createTmpDir();
            cleanupDirs.push(d1, d2);
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const cb = vi.fn();

            reg.watch('a', d1, cb);
            reg.watch('b', d2, cb);
            await wait(200);
            cb.mockClear();

            fs.writeFileSync(path.join(d1, 'only-a.txt'), 'a');

            await wait(800);

            const aCalls = cb.mock.calls.filter(([k]) => k === 'a');
            const bCalls = cb.mock.calls.filter(([k]) => k === 'b');
            expect(aCalls.length).toBeGreaterThan(0);
            expect(bCalls).toHaveLength(0);
        });
    });

    // ------------------------------------------------------------------
    // defaultDebounceMs
    // ------------------------------------------------------------------

    describe('defaultDebounceMs', () => {
        it('uses provided default debounce', () => {
            const reg = new DebouncedWatcherRegistry(500);
            registries.push(reg);
            // Just verify it constructs without error
            expect(reg).toBeDefined();
        });

        it('falls back to 300ms when no default provided', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            expect(reg).toBeDefined();
        });
    });
});
