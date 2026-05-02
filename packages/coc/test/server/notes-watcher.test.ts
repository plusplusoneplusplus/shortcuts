/**
 * NotesWatcher Unit Tests
 *
 * Tests for the NotesWatcher class which watches notes directories
 * for file changes and fires debounced callbacks with changed paths.
 *
 * Uses mocked fs.watch/fs.statSync and fake timers for determinism.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        watch: vi.fn(actual.watch),
        statSync: vi.fn(actual.statSync),
    };
});

import * as fs from 'fs';
import { NotesWatcher } from '../../src/server/notes/notes-watcher';

// ============================================================================
// Helpers
// ============================================================================

function createFakeWatcher() {
    const emitter = new EventEmitter();
    let changeListener: ((event: string, filename: string | null) => void) | undefined;

    const fakeWatcher = Object.assign(emitter, {
        close: vi.fn(),
        ref: vi.fn().mockReturnThis(),
        unref: vi.fn().mockReturnThis(),
    }) as unknown as fs.FSWatcher;

    return {
        watcher: fakeWatcher,
        captureListener(listener: (event: string, filename: string | null) => void) {
            changeListener = listener;
        },
        emit(filename: string) {
            changeListener?.('change', filename);
        },
    };
}

function mockFsWatchAndStat(fakeWatchers: ReturnType<typeof createFakeWatcher>[]) {
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
    (fs.statSync as ReturnType<typeof vi.fn>).mockReturnValue({ isDirectory: () => true } as any);
}

// ============================================================================
// Tests
// ============================================================================

describe('NotesWatcher', () => {
    const cleanupWatchers: NotesWatcher[] = [];

    afterEach(() => {
        for (const tw of cleanupWatchers) tw.closeAll();
        cleanupWatchers.length = 0;
    });

    // ------------------------------------------------------------------
    // Debounce
    // ------------------------------------------------------------------

    describe('debounce', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            mockFsWatchAndStat([fakeWatcherA]);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.statSync).mockRestore();
            vi.useRealTimers();
        });

        it('should fire callback with changed paths after debounce window', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit('test.md');
            expect(callback).not.toHaveBeenCalled();

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith('ws1', ['test.md']);
        });

        it('should accumulate multiple changed files into single callback', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit('a.md');
            fakeWatcherA.emit('b.md');
            fakeWatcherA.emit('sub/c.md');

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledOnce();
            const paths = callback.mock.calls[0][1] as string[];
            expect(paths).toContain('a.md');
            expect(paths).toContain('b.md');
            expect(paths).toContain('sub/c.md');
        });

        it('should deduplicate the same file changed multiple times', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit('same.md');
            fakeWatcherA.emit('same.md');
            fakeWatcherA.emit('same.md');

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledOnce();
            const paths = callback.mock.calls[0][1] as string[];
            expect(paths).toHaveLength(1);
            expect(paths[0]).toBe('same.md');
        });

        it('should ignore non-markdown files', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit('image.png');
            fakeWatcherA.emit('data.json');
            fakeWatcherA.emit('script.js');

            vi.advanceTimersByTime(300);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should ignore null filenames', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit(null as any);

            vi.advanceTimersByTime(300);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should reset debounce timer on new events', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit('first.md');
            vi.advanceTimersByTime(200);
            expect(callback).not.toHaveBeenCalled();

            fakeWatcherA.emit('second.md');
            vi.advanceTimersByTime(200);
            expect(callback).not.toHaveBeenCalled();

            vi.advanceTimersByTime(100);
            expect(callback).toHaveBeenCalledOnce();
        });

        it('should normalize backslash paths to forward slashes', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', 'C:\\Users\\test\\notes');

            fakeWatcherA.emit('sub\\nested.md');

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledOnce();
            const paths = callback.mock.calls[0][1] as string[];
            // Relative path should use forward slashes
            expect(paths[0]).toBe('sub/nested.md');
        });
    });

    // ------------------------------------------------------------------
    // unwatchWorkspace
    // ------------------------------------------------------------------

    describe('unwatchWorkspace', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            mockFsWatchAndStat([fakeWatcherA]);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.statSync).mockRestore();
            vi.useRealTimers();
        });

        it('should stop firing callbacks after unwatchWorkspace', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');

            fakeWatcherA.emit('file.md');
            watcher.unwatchWorkspace('ws1');

            vi.advanceTimersByTime(500);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should report isWatching correctly', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);

            expect(watcher.isWatching('ws1')).toBe(false);
            watcher.watchWorkspace('ws1', '/fake/notes');
            expect(watcher.isWatching('ws1')).toBe(true);
            watcher.unwatchWorkspace('ws1');
            expect(watcher.isWatching('ws1')).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // closeAll
    // ------------------------------------------------------------------

    describe('closeAll', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;
        let fakeWatcherB: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            fakeWatcherB = createFakeWatcher();
            mockFsWatchAndStat([fakeWatcherA, fakeWatcherB]);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.statSync).mockRestore();
            vi.useRealTimers();
        });

        it('should stop all watchers on closeAll', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes1');
            watcher.watchWorkspace('ws2', '/fake/notes2');

            expect(watcher.isWatching('ws1')).toBe(true);
            expect(watcher.isWatching('ws2')).toBe(true);

            watcher.closeAll();

            expect(watcher.isWatching('ws1')).toBe(false);
            expect(watcher.isWatching('ws2')).toBe(false);

            fakeWatcherA.emit('post.md');
            fakeWatcherB.emit('post.md');

            vi.advanceTimersByTime(500);
            expect(callback).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------
    // Multiple workspaces
    // ------------------------------------------------------------------

    describe('multiple workspaces', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;
        let fakeWatcherB: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            fakeWatcherB = createFakeWatcher();
            mockFsWatchAndStat([fakeWatcherA, fakeWatcherB]);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.statSync).mockRestore();
            vi.useRealTimers();
        });

        it('should isolate callbacks per workspace', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes1');
            watcher.watchWorkspace('ws2', '/fake/notes2');

            fakeWatcherA.emit('a.md');
            vi.advanceTimersByTime(300);

            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith('ws1', ['a.md']);
        });
    });

    // ------------------------------------------------------------------
    // Non-existent directory
    // ------------------------------------------------------------------

    describe('non-existent directory', () => {
        beforeEach(() => {
            (fs.statSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
                throw new Error('ENOENT');
            });
        });

        afterEach(() => {
            vi.mocked(fs.statSync).mockRestore();
        });

        it('should silently skip non-existent directories', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);

            // Should not throw
            watcher.watchWorkspace('ws1', '/does-not-exist');
            expect(watcher.isWatching('ws1')).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // Duplicate watch
    // ------------------------------------------------------------------

    describe('duplicate watch', () => {
        let fakeWatcherA: ReturnType<typeof createFakeWatcher>;

        beforeEach(() => {
            vi.useFakeTimers();
            fakeWatcherA = createFakeWatcher();
            mockFsWatchAndStat([fakeWatcherA]);
        });

        afterEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.statSync).mockRestore();
            vi.useRealTimers();
        });

        it('should no-op if workspace is already being watched', () => {
            const callback = vi.fn();
            const watcher = new NotesWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/notes');
            watcher.watchWorkspace('ws1', '/fake/notes');

            expect(fs.watch).toHaveBeenCalledTimes(1);
        });
    });
});
