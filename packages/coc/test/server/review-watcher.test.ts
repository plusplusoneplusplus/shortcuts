/**
 * Review File Watcher Tests
 *
 * Tests for the ReviewFileWatcher:
 * - watchFile starts fs.watch
 * - File change broadcasts WebSocket event
 * - Debounce prevents duplicate events
 * - unwatchFile closes watcher
 * - closeAll cleans up all watchers
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReviewFileWatcher } from '../../src/server/review-watcher';

// ============================================================================
// Mock WebSocket Server
// ============================================================================

function createMockWsServer() {
    const events: Array<{ filePath: string; message: any }> = [];
    return {
        broadcastFileEvent: vi.fn((filePath: string, message: any) => {
            events.push({ filePath, message });
        }),
        events,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ReviewFileWatcher', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-watcher-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('watchFile starts watching a file', () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);
        const testFile = path.join(tmpDir, 'test.md');
        fs.writeFileSync(testFile, '# Test');

        watcher.watchFile('test.md');
        expect(watcher.watchCount).toBe(1);
        watcher.closeAll();
    });

    it('watchFile does nothing for already-watched file', () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);
        const testFile = path.join(tmpDir, 'test.md');
        fs.writeFileSync(testFile, '# Test');

        watcher.watchFile('test.md');
        watcher.watchFile('test.md');
        expect(watcher.watchCount).toBe(1);
        watcher.closeAll();
    });

    it('watchFile ignores non-existent files', () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);

        watcher.watchFile('does-not-exist.md');
        expect(watcher.watchCount).toBe(0);
        watcher.closeAll();
    });

    it('file change broadcasts WebSocket event after debounce', async () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);
        const testFile = path.join(tmpDir, 'test.md');
        fs.writeFileSync(testFile, '# Test');

        watcher.watchFile('test.md');

        // Trigger change — use appendFileSync which is more reliably detected by fs.watch
        await new Promise(r => setTimeout(r, 100));
        fs.appendFileSync(testFile, '\n## Updated');

        // Wait for fs.watch + debounce (fs.watch can be slow on some platforms)
        await new Promise(r => setTimeout(r, 500));

        expect(wsServer.broadcastFileEvent).toHaveBeenCalled();
        const call = wsServer.broadcastFileEvent.mock.calls[0];
        expect(call[0]).toBe('test.md');
        expect(call[1].type).toBe('document-updated');
        expect(call[1].filePath).toBe('test.md');

        watcher.closeAll();
    });

    it('debounce prevents duplicate events for rapid changes', async () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 100);
        const testFile = path.join(tmpDir, 'test.md');
        fs.writeFileSync(testFile, '# Test');

        watcher.watchFile('test.md');

        // Trigger 3 rapid changes
        fs.writeFileSync(testFile, '# Update 1');
        await new Promise(r => setTimeout(r, 20));
        fs.writeFileSync(testFile, '# Update 2');
        await new Promise(r => setTimeout(r, 20));
        fs.writeFileSync(testFile, '# Update 3');

        // Wait for debounce to fire
        await new Promise(r => setTimeout(r, 300));

        // Should have been debounced to fewer broadcasts
        // (fs.watch may fire multiple events per write, but debouncing limits them)
        const callCount = wsServer.broadcastFileEvent.mock.calls.length;
        expect(callCount).toBeGreaterThanOrEqual(1);
        // With 100ms debounce and ~40ms between writes, we expect at most 2-3 events
        expect(callCount).toBeLessThanOrEqual(3);

        watcher.closeAll();
    });

    it('unwatchFile closes watcher', () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);
        const testFile = path.join(tmpDir, 'test.md');
        fs.writeFileSync(testFile, '# Test');

        watcher.watchFile('test.md');
        expect(watcher.watchCount).toBe(1);

        watcher.unwatchFile('test.md');
        expect(watcher.watchCount).toBe(0);
    });

    it('unwatchFile is safe for non-watched files', () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);

        // Should not throw
        watcher.unwatchFile('nonexistent.md');
        expect(watcher.watchCount).toBe(0);
    });

    it('closeAll cleans up all watchers', () => {
        const wsServer = createMockWsServer();
        const watcher = new ReviewFileWatcher(tmpDir, wsServer as any, 50);

        fs.writeFileSync(path.join(tmpDir, 'a.md'), '# A');
        fs.writeFileSync(path.join(tmpDir, 'b.md'), '# B');
        fs.writeFileSync(path.join(tmpDir, 'c.md'), '# C');

        watcher.watchFile('a.md');
        watcher.watchFile('b.md');
        watcher.watchFile('c.md');
        expect(watcher.watchCount).toBe(3);

        watcher.closeAll();
        expect(watcher.watchCount).toBe(0);
    });
});
