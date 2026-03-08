/**
 * TaskWatcher Unit Tests
 *
 * Tests for the TaskWatcher class which watches `.vscode/tasks/`
 * directories for file changes and fires debounced callbacks.
 *
 * Uses temporary directories for isolation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskWatcher } from '../../src/server/task-watcher';

// ============================================================================
// Helpers
// ============================================================================

function createTmpWorkspace(): { root: string; tasksDir: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwatcher-'));
    const tasksDir = path.join(root, '.vscode', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    return { root, tasksDir };
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    // Basic watching
    // ------------------------------------------------------------------

    it('should fire callback when a .md file is created in .vscode/tasks/', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir);

        // Let the watcher fully register (macOS FSEvents can be slow)
        await wait(200);

        // Create a file
        fs.writeFileSync(path.join(tasksDir, 'test.md'), '# Task');

        // Wait for debounce (300ms) + generous margin for CI
        await wait(1500);

        expect(callback).toHaveBeenCalledWith('ws1');
    });

    it('should fire callback when a file is modified', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);

        fs.writeFileSync(path.join(tasksDir, 'existing.md'), '# Initial');

        const callback = vi.fn();
        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir);

        // Wait a bit for watcher to stabilize
        await wait(100);

        // Modify the file
        fs.writeFileSync(path.join(tasksDir, 'existing.md'), '# Updated');

        await wait(600);

        expect(callback).toHaveBeenCalledWith('ws1');
    });

    it('should fire callback when a file is deleted', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);

        fs.writeFileSync(path.join(tasksDir, 'to-delete.md'), '# Delete me');

        const callback = vi.fn();
        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir);

        await wait(100);

        // Delete the file
        fs.unlinkSync(path.join(tasksDir, 'to-delete.md'));

        await wait(600);

        expect(callback).toHaveBeenCalledWith('ws1');
    });

    // ------------------------------------------------------------------
    // Debounce
    // ------------------------------------------------------------------

    it('should debounce multiple rapid events into a single callback', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir);

        // Rapid-fire 10 writes within 100ms
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(tasksDir, `rapid-${i}.md`), `# Task ${i}`);
        }

        // Wait 500ms after the last event (debounce is 300ms)
        await wait(800);

        // Should have been coalesced into a single callback
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('ws1');
    });

    // ------------------------------------------------------------------
    // unwatchWorkspace
    // ------------------------------------------------------------------

    it('should stop firing callbacks after unwatchWorkspace', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir);

        // Unwatch immediately
        watcher.unwatchWorkspace('ws1');

        fs.writeFileSync(path.join(tasksDir, 'after-unwatch.md'), '# After');

        await wait(600);

        expect(callback).not.toHaveBeenCalled();
    });

    it('should report isWatching correctly', () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);

        expect(watcher.isWatching('ws1')).toBe(false);

        watcher.watchWorkspace('ws1', tasksDir);
        expect(watcher.isWatching('ws1')).toBe(true);

        watcher.unwatchWorkspace('ws1');
        expect(watcher.isWatching('ws1')).toBe(false);
    });

    // ------------------------------------------------------------------
    // closeAll
    // ------------------------------------------------------------------

    it('should stop all watchers on closeAll', async () => {
        const { root: root1, tasksDir: tasksDir1 } = createTmpWorkspace();
        const { root: root2, tasksDir: tasksDir2 } = createTmpWorkspace();
        cleanupDirs.push(root1, root2);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir1);
        watcher.watchWorkspace('ws2', tasksDir2);

        expect(watcher.isWatching('ws1')).toBe(true);
        expect(watcher.isWatching('ws2')).toBe(true);

        watcher.closeAll();

        expect(watcher.isWatching('ws1')).toBe(false);
        expect(watcher.isWatching('ws2')).toBe(false);

        // Write after closeAll should not trigger callback
        fs.writeFileSync(path.join(tasksDir1, 'post.md'), '# After');
        fs.writeFileSync(path.join(tasksDir2, 'post.md'), '# After');

        await wait(600);

        expect(callback).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Non-existent directory
    // ------------------------------------------------------------------

    it('should not throw when watching a workspace without .vscode/tasks/', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwatcher-nodir-'));
        cleanupDirs.push(root);
        const tasksDir = path.join(root, '.vscode', 'tasks');
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);

        // Should not throw — tasksDir does not exist
        expect(() => watcher.watchWorkspace('ws-nodir', tasksDir)).not.toThrow();
        expect(watcher.isWatching('ws-nodir')).toBe(false);
    });

    it('should not fire callbacks for a non-existent directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwatcher-nodir2-'));
        cleanupDirs.push(root);
        const tasksDir = path.join(root, '.vscode', 'tasks');
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws-nodir', tasksDir);

        await wait(600);

        expect(callback).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Duplicate watch
    // ------------------------------------------------------------------

    it('should not double-watch the same workspace', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);

        watcher.watchWorkspace('ws1', tasksDir);
        watcher.watchWorkspace('ws1', tasksDir); // second call should be no-op

        await wait(200);

        fs.writeFileSync(path.join(tasksDir, 'dup.md'), '# Dup');

        await wait(1200);

        // Should only get one callback, not two
        expect(callback).toHaveBeenCalledTimes(1);
    });

    // ------------------------------------------------------------------
    // Error handling — directory deleted mid-watch
    // ------------------------------------------------------------------

    it('should handle directory deletion gracefully during watch', async () => {
        const { root, tasksDir } = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir);

        await wait(100);

        // Delete the watched directory
        fs.rmSync(tasksDir, { recursive: true, force: true });

        // Should not crash — wait for any error events to propagate
        await wait(600);

        // The watcher should have cleaned up
        // (On some platforms it may still report as watching until the error fires)
        // The important thing is no crash occurred.
    });

    // ------------------------------------------------------------------
    // Multiple workspaces
    // ------------------------------------------------------------------

    it('should track multiple workspaces independently', async () => {
        const { root: root1, tasksDir: tasksDir1 } = createTmpWorkspace();
        const { root: root2, tasksDir: tasksDir2 } = createTmpWorkspace();
        cleanupDirs.push(root1, root2);
        const callback = vi.fn();

        const watcher = new TaskWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', tasksDir1);
        watcher.watchWorkspace('ws2', tasksDir2);

        // Give FSEvents/inotify time to fully register and settle
        // (macOS FSEvents may fire for the initial directory creation)
        await wait(800);
        callback.mockClear();

        // Write to ws1 only
        fs.writeFileSync(path.join(tasksDir1, 'ws1-task.md'), '# WS1');

        await wait(800);

        // Only ws1 callback should have fired
        expect(callback).toHaveBeenCalledWith('ws1');
        const ws2Calls = callback.mock.calls.filter((c: any) => c[0] === 'ws2');
        expect(ws2Calls).toHaveLength(0);
    });
});
