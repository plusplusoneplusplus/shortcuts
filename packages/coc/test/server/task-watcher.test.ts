/**
 * TaskWatcher Unit Tests
 *
 * Tests for the TaskWatcher class which watches a repo-scoped tasks directory
 * for file changes and fires debounced callbacks.
 *
 * The "debounce" / "unwatchWorkspace" / "closeAll" / "multiple workspaces"
 * groups mock `fs.watch`/`fs.statSync` and use fake timers so tests are
 * deterministic — no real filesystem events or wall-clock waits.
 *
 * The "non-existent directory" group uses real temp dirs for path-validation
 * behavior that depends on the actual filesystem.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
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
import { TaskWatcher } from '../../src/server/task-watcher';

// ============================================================================
// Helpers
// ============================================================================

function createTmpWorkspace(): { root: string; tasksDir: string } {
    const root = (fs.mkdtempSync as any).call(fs, path.join(os.tmpdir(), 'taskwatcher-'));
    const tasksDir = path.join(root, '.vscode', 'tasks');
    (fs.mkdirSync as any).call(fs, tasksDir, { recursive: true });
    return { root, tasksDir };
}

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

describe('TaskWatcher', () => {
    const cleanupDirs: string[] = [];
    const cleanupWatchers: TaskWatcher[] = [];

    afterEach(() => {
        for (const tw of cleanupWatchers) {
            tw.closeAll();
        }
        cleanupWatchers.length = 0;

        for (const dir of cleanupDirs) {
            try {
                fs.rmSync(dir, { recursive: true, force: true });
            } catch {
                // Ignore
            }
        }
        cleanupDirs.length = 0;
    });

    // ------------------------------------------------------------------
    // Debounce (mocked fs.watch + fake timers)
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

        it('should fire callback after debounce window', () => {
            const callback = vi.fn();
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/tasks');

            fakeWatcherA.emit('test.md');
            expect(callback).not.toHaveBeenCalled();

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledOnce();
            expect(callback).toHaveBeenCalledWith('ws1');
        });

        it('should debounce multiple rapid events into a single callback', () => {
            const callback = vi.fn();
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/tasks');

            for (let i = 0; i < 10; i++) {
                fakeWatcherA.emit(`rapid-${i}.md`);
            }

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith('ws1');
        });

        it('should reset debounce timer on new events', () => {
            const callback = vi.fn();
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/tasks');

            fakeWatcherA.emit('first.md');
            vi.advanceTimersByTime(200);
            expect(callback).not.toHaveBeenCalled();

            fakeWatcherA.emit('second.md');
            vi.advanceTimersByTime(200);
            expect(callback).not.toHaveBeenCalled();

            vi.advanceTimersByTime(100);
            expect(callback).toHaveBeenCalledOnce();
        });
    });

    // ------------------------------------------------------------------
    // unwatchWorkspace (mocked fs.watch + fake timers)
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
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/tasks');

            fakeWatcherA.emit('file.md');
            watcher.unwatchWorkspace('ws1');

            vi.advanceTimersByTime(500);
            expect(callback).not.toHaveBeenCalled();
        });

        it('should report isWatching correctly', () => {
            const callback = vi.fn();
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);

            expect(watcher.isWatching('ws1')).toBe(false);
            watcher.watchWorkspace('ws1', '/fake/tasks');
            expect(watcher.isWatching('ws1')).toBe(true);
            watcher.unwatchWorkspace('ws1');
            expect(watcher.isWatching('ws1')).toBe(false);
        });
    });

    // ------------------------------------------------------------------
    // closeAll (mocked fs.watch + fake timers)
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
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/tasks1');
            watcher.watchWorkspace('ws2', '/fake/tasks2');

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
    // Multiple workspaces (mocked fs.watch + fake timers)
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

        it('should track multiple workspaces independently', () => {
            const callback = vi.fn();
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);
            watcher.watchWorkspace('ws1', '/fake/tasks1');
            watcher.watchWorkspace('ws2', '/fake/tasks2');

            fakeWatcherA.emit('ws1-task.md');

            vi.advanceTimersByTime(300);

            expect(callback).toHaveBeenCalledWith('ws1');
            const ws2Calls = callback.mock.calls.filter((c: any) => c[0] === 'ws2');
            expect(ws2Calls).toHaveLength(0);
        });

        it('should not double-watch the same workspace', () => {
            const callback = vi.fn();
            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);

            watcher.watchWorkspace('ws1', '/fake/tasks');
            watcher.watchWorkspace('ws1', '/fake/tasks');

            fakeWatcherA.emit('dup.md');

            vi.advanceTimersByTime(300);
            expect(callback).toHaveBeenCalledTimes(1);
        });
    });

    // ------------------------------------------------------------------
    // Non-existent directory (real filesystem)
    // ------------------------------------------------------------------

    describe('non-existent directory', () => {
        beforeEach(() => {
            vi.mocked(fs.watch).mockRestore();
            vi.mocked(fs.statSync).mockRestore();
        });

        it('should not throw when watching a workspace without a tasks directory', () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwatcher-nodir-'));
            cleanupDirs.push(root);
            const tasksDir = path.join(root, '.vscode', 'tasks');
            const callback = vi.fn();

            const watcher = new TaskWatcher(callback);
            cleanupWatchers.push(watcher);

            expect(() => watcher.watchWorkspace('ws-nodir', tasksDir)).not.toThrow();
            expect(watcher.isWatching('ws-nodir')).toBe(false);
        });
    });
});
