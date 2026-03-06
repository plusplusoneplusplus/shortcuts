/**
 * TemplateWatcher Unit Tests
 *
 * Tests for the TemplateWatcher class which watches `.vscode/templates/`
 * directories for file changes and fires debounced callbacks.
 *
 * Uses temporary directories for isolation.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemplateWatcher } from '../../src/server/template-watcher';

// ============================================================================
// Helpers
// ============================================================================

function createTmpWorkspace(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'templatewatcher-'));
    const templatesDir = path.join(root, '.vscode', 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    return root;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('TemplateWatcher', () => {
    const cleanupDirs: string[] = [];
    const cleanupWatchers: TemplateWatcher[] = [];

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

    it('should fire callback when a .yaml file is created in .vscode/templates/', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root);

        // Let the watcher fully register (macOS FSEvents can be slow)
        await wait(200);

        // Create a file
        const templatesDir = path.join(root, '.vscode', 'templates');
        fs.writeFileSync(path.join(templatesDir, 'test.yaml'), 'name: test');

        // Wait for debounce (300ms) + generous margin for CI
        await wait(1500);

        expect(callback).toHaveBeenCalledWith('ws1');
    });

    it('should fire callback when a file is modified', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);

        const templatesDir = path.join(root, '.vscode', 'templates');
        fs.writeFileSync(path.join(templatesDir, 'existing.yaml'), 'name: initial');

        const callback = vi.fn();
        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root);

        await wait(100);

        // Modify the file
        fs.writeFileSync(path.join(templatesDir, 'existing.yaml'), 'name: updated');

        await wait(600);

        expect(callback).toHaveBeenCalledWith('ws1');
    });

    it('should fire callback when a file is deleted', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);

        const templatesDir = path.join(root, '.vscode', 'templates');
        fs.writeFileSync(path.join(templatesDir, 'to-delete.yaml'), 'name: doomed');

        const callback = vi.fn();
        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root);

        await wait(100);

        fs.unlinkSync(path.join(templatesDir, 'to-delete.yaml'));

        await wait(600);

        expect(callback).toHaveBeenCalledWith('ws1');
    });

    // ------------------------------------------------------------------
    // Debounce
    // ------------------------------------------------------------------

    it('should debounce multiple rapid events into a single callback', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root);

        const templatesDir = path.join(root, '.vscode', 'templates');

        // Rapid-fire 10 writes within 100ms
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(templatesDir, `rapid-${i}.yaml`), `name: r${i}`);
        }

        // Wait 500ms after the last event (debounce is 300ms)
        await wait(800);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('ws1');
    });

    // ------------------------------------------------------------------
    // unwatchWorkspace
    // ------------------------------------------------------------------

    it('should stop firing callbacks after unwatchWorkspace', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root);

        watcher.unwatchWorkspace('ws1');

        const templatesDir = path.join(root, '.vscode', 'templates');
        fs.writeFileSync(path.join(templatesDir, 'after-unwatch.yaml'), 'name: after');

        await wait(600);

        expect(callback).not.toHaveBeenCalled();
    });

    it('should report isWatching correctly', () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);

        expect(watcher.isWatching('ws1')).toBe(false);

        watcher.watchWorkspace('ws1', root);
        expect(watcher.isWatching('ws1')).toBe(true);

        watcher.unwatchWorkspace('ws1');
        expect(watcher.isWatching('ws1')).toBe(false);
    });

    // ------------------------------------------------------------------
    // closeAll
    // ------------------------------------------------------------------

    it('should stop all watchers on closeAll', async () => {
        const root1 = createTmpWorkspace();
        const root2 = createTmpWorkspace();
        cleanupDirs.push(root1, root2);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root1);
        watcher.watchWorkspace('ws2', root2);

        expect(watcher.isWatching('ws1')).toBe(true);
        expect(watcher.isWatching('ws2')).toBe(true);

        watcher.closeAll();

        expect(watcher.isWatching('ws1')).toBe(false);
        expect(watcher.isWatching('ws2')).toBe(false);

        // Write after closeAll should not trigger callback
        fs.writeFileSync(path.join(root1, '.vscode', 'templates', 'post.yaml'), 'name: after');
        fs.writeFileSync(path.join(root2, '.vscode', 'templates', 'post.yaml'), 'name: after');

        await wait(600);

        expect(callback).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Non-existent directory
    // ------------------------------------------------------------------

    it('should not throw when watching a workspace without .vscode/templates/', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'templatewatcher-nodir-'));
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);

        expect(() => watcher.watchWorkspace('ws-nodir', root)).not.toThrow();
        expect(watcher.isWatching('ws-nodir')).toBe(false);
    });

    it('should not fire callbacks for a non-existent directory', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'templatewatcher-nodir2-'));
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws-nodir', root);

        await wait(600);

        expect(callback).not.toHaveBeenCalled();
    });

    // ------------------------------------------------------------------
    // Duplicate watch
    // ------------------------------------------------------------------

    it('should not double-watch the same workspace (idempotent)', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);

        watcher.watchWorkspace('ws1', root);
        watcher.watchWorkspace('ws1', root); // second call should be no-op

        await wait(200);

        const templatesDir = path.join(root, '.vscode', 'templates');
        fs.writeFileSync(path.join(templatesDir, 'dup.yaml'), 'name: dup');

        await wait(1200);

        // Should only get one callback, not two
        expect(callback).toHaveBeenCalledTimes(1);
    });

    // ------------------------------------------------------------------
    // Error handling — directory deleted mid-watch
    // ------------------------------------------------------------------

    it('should handle directory deletion gracefully during watch', async () => {
        const root = createTmpWorkspace();
        cleanupDirs.push(root);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root);

        await wait(100);

        // Delete the watched directory
        const templatesDir = path.join(root, '.vscode', 'templates');
        fs.rmSync(templatesDir, { recursive: true, force: true });

        // Should not crash
        await wait(600);
    });

    // ------------------------------------------------------------------
    // Multiple workspaces
    // ------------------------------------------------------------------

    it('should track multiple workspaces independently', async () => {
        const root1 = createTmpWorkspace();
        const root2 = createTmpWorkspace();
        cleanupDirs.push(root1, root2);
        const callback = vi.fn();

        const watcher = new TemplateWatcher(callback);
        cleanupWatchers.push(watcher);
        watcher.watchWorkspace('ws1', root1);
        watcher.watchWorkspace('ws2', root2);

        // Give FSEvents/inotify time to fully register and settle
        await wait(800);
        callback.mockClear();

        // Write to ws1 only
        fs.writeFileSync(path.join(root1, '.vscode', 'templates', 'ws1-tmpl.yaml'), 'name: ws1');

        await wait(800);

        // Only ws1 callback should have fired
        expect(callback).toHaveBeenCalledWith('ws1');
        const ws2Calls = callback.mock.calls.filter((c: any) => c[0] === 'ws2');
        expect(ws2Calls).toHaveLength(0);
    });
});
