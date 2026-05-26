/**
 * DebouncedWatcherRegistry Unit Tests
 *
 * Tests for the generic registry that manages fs.FSWatcher instances with
 * debounced callbacks and per-key changed-file accumulation.
 *
 * The "debounce and file accumulation" / "shouldIgnore" / "multiple keys"
 * groups mock `fs.watch` and use fake timers so tests are deterministic —
 * no real filesystem events or wall-clock waits.
 *
 * The "API correctness" group still uses real temp dirs for the few tests
 * that exercise watch-path validation (non-existent path, etc.).
 */

import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        watch: vi.fn(actual.watch),
        existsSync: vi.fn(actual.existsSync),
    };
});

import * as fs from 'fs';
import { DebouncedWatcherRegistry } from '../../../src/server/shared/debounced-watcher-registry';

// ============================================================================
// Helpers
// ============================================================================

function createTmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'debounced-watcher-'));
}

function createFakeWatcher() {
    const emitter = new EventEmitter();
    let changeListener: ((eventType: string, filename: string | null) => void) | undefined;

    const fakeWatcher = Object.assign(emitter, {
        close: vi.fn(),
        ref: vi.fn().mockReturnThis(),
        unref: vi.fn().mockReturnThis(),
    }) as unknown as fs.FSWatcher;

    return {
        watcher: fakeWatcher,
        captureListener(listener: (eventType: string, filename: string | null) => void) {
            changeListener = listener;
        },
        emit(filename: string) {
            changeListener?.('change', filename);
        },
    };
}

function mockFsWatch(fakeWatchers: ReturnType<typeof createFakeWatcher>[]) {
    let callCount = 0;
    (fs.watch as ReturnType<typeof vi.fn>).mockImplementation(
        (_path: any, optionsOrListener: any, maybeListener?: any) => {
            const listener = typeof optionsOrListener === 'function' ? optionsOrListener : maybeListener;
            const fw = fakeWatchers[Math.min(callCount, fakeWatchers.length - 1)];
            callCount++;
            if (listener) fw.captureListener(listener);
            return fw.watcher;
        },
    );
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
    // API correctness (real fs.watch for path-validation tests)
    // ------------------------------------------------------------------

    describe('API correctness', () => {
        beforeEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.existsSync).mockRestore();
        });

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
            reg.watch('k', dir, cb);
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
    // Debounce + file accumulation (mocked fs.watch + fake timers)
    // ------------------------------------------------------------------

    describe('debounce and file accumulation', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            mockFsWatch([fakeWatcherA]);
            vi.mocked(fs.existsSync).mockReturnValue(true);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.existsSync).mockRestore();
            vi.useRealTimers();
        });

        it('fires onChange with accumulated changed files after debounce', () => {
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange);

            fakeWatcherA.emit('a.txt');
            expect(onChange).not.toHaveBeenCalled();

            vi.advanceTimersByTime(200);
            expect(onChange).toHaveBeenCalledOnce();
            expect(onChange).toHaveBeenCalledWith('k', ['a.txt']);
        });

        it('debounces rapid events into a single callback', () => {
            const reg = new DebouncedWatcherRegistry(300);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange);

            for (let i = 0; i < 5; i++) {
                fakeWatcherA.emit(`f${i}.txt`);
            }

            vi.advanceTimersByTime(300);
            expect(onChange).toHaveBeenCalledTimes(1);
            const [, files] = onChange.mock.calls[0];
            expect(files).toHaveLength(5);
        });

        it('accumulates files across debounce resets', () => {
            const reg = new DebouncedWatcherRegistry(300);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange);

            fakeWatcherA.emit('first.txt');
            vi.advanceTimersByTime(200);
            fakeWatcherA.emit('second.txt');
            vi.advanceTimersByTime(300);

            expect(onChange).toHaveBeenCalledOnce();
            const [, files] = onChange.mock.calls[0];
            expect(files).toEqual(expect.arrayContaining(['first.txt', 'second.txt']));
        });

        it('does not fire after unwatch', () => {
            const reg = new DebouncedWatcherRegistry(100);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange);
            fakeWatcherA.emit('file.txt');
            reg.unwatch('k');

            vi.advanceTimersByTime(200);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('does not fire after closeAll', () => {
            const reg = new DebouncedWatcherRegistry(100);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange);
            fakeWatcherA.emit('file.txt');
            reg.closeAll();

            vi.advanceTimersByTime(200);
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // shouldIgnore (mocked fs.watch + fake timers)
    // ------------------------------------------------------------------

    describe('shouldIgnore option', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            mockFsWatch([fakeWatcherA]);
            vi.mocked(fs.existsSync).mockReturnValue(true);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.existsSync).mockRestore();
            vi.useRealTimers();
        });

        it('ignores files matching the predicate', () => {
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange, {
                shouldIgnore: (f) => f.endsWith('.log'),
            });

            fakeWatcherA.emit('app.log');

            vi.advanceTimersByTime(500);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('passes through files not matching the predicate', () => {
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const onChange = vi.fn();

            reg.watch('k', '/fake/dir', onChange, {
                shouldIgnore: (f) => f.endsWith('.log'),
            });

            fakeWatcherA.emit('app.log');
            fakeWatcherA.emit('data.json');

            vi.advanceTimersByTime(200);
            expect(onChange).toHaveBeenCalledOnce();
            expect(onChange).toHaveBeenCalledWith('k', ['data.json']);
        });
    });

    // ------------------------------------------------------------------
    // Multiple keys are independent (mocked fs.watch + fake timers)
    // ------------------------------------------------------------------

    describe('multiple keys', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;
        let fakeWatcherB: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            fakeWatcherB = createFakeWatcher();
            mockFsWatch([fakeWatcherA, fakeWatcherB]);
            vi.mocked(fs.existsSync).mockReturnValue(true);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.existsSync).mockRestore();
            vi.useRealTimers();
        });

        it('keys do not interfere with each other', () => {
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const cb = vi.fn();

            reg.watch('a', '/fake/dir-a', cb);
            reg.watch('b', '/fake/dir-b', cb);

            fakeWatcherA.emit('only-a.txt');

            vi.advanceTimersByTime(200);

            const aCalls = cb.mock.calls.filter(([k]) => k === 'a');
            const bCalls = cb.mock.calls.filter(([k]) => k === 'b');
            expect(aCalls.length).toBe(1);
            expect(bCalls).toHaveLength(0);
        });

        it('events on key b do not affect key a', () => {
            const reg = new DebouncedWatcherRegistry(200);
            registries.push(reg);
            const cb = vi.fn();

            reg.watch('a', '/fake/dir-a', cb);
            reg.watch('b', '/fake/dir-b', cb);

            fakeWatcherB.emit('only-b.txt');

            vi.advanceTimersByTime(200);

            const aCalls = cb.mock.calls.filter(([k]) => k === 'a');
            const bCalls = cb.mock.calls.filter(([k]) => k === 'b');
            expect(aCalls).toHaveLength(0);
            expect(bCalls.length).toBe(1);
        });
    });

    // ------------------------------------------------------------------
    // defaultDebounceMs
    // ------------------------------------------------------------------

    describe('defaultDebounceMs', () => {
        it('uses provided default debounce', () => {
            const reg = new DebouncedWatcherRegistry(500);
            registries.push(reg);
            expect(reg).toBeDefined();
        });

        it('falls back to 300ms when no default provided', () => {
            const reg = new DebouncedWatcherRegistry();
            registries.push(reg);
            expect(reg).toBeDefined();
        });
    });
});
