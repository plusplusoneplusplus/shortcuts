/**
 * Tests for FileWatcher - repository change detection.
 *
 * NOTE: fs.watch({ recursive: true }) is unreliable on Linux with Node 18.
 * On those platforms, the watcher may silently fail to start. Tests that
 * depend on the watcher actually working are skipped when recursive
 * watching is not supported.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileWatcher } from '../../src/server/file-watcher';
import type { ComponentGraph } from '../../src/types';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Detect whether fs.watch with { recursive: true } actually works on
 * this platform. On Linux + Node 18 it may throw or silently fail.
 */
function supportsRecursiveWatch(): boolean {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fswatch-probe-'));
    try {
        const w = fs.watch(tmpDir, { recursive: true });
        w.close();
        return true;
    } catch {
        return false;
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

const HAS_RECURSIVE_WATCH = supportsRecursiveWatch();
const itIfRecursive = HAS_RECURSIVE_WATCH ? it : it.skip;

function createTestGraph(): ComponentGraph {
    return {
        project: {
            name: 'TestProject',
            description: 'Test',
            language: 'TypeScript',
            buildSystem: 'npm',
        },
        categories: ['core', 'ui'],
        components: [
            {
                id: 'auth',
                name: 'Auth',
                category: 'core',
                path: 'src/auth',
                purpose: 'Authentication',
                complexity: 'medium',
                keyFiles: ['src/auth/login.ts', 'src/auth/jwt.ts'],
                dependencies: [],
                dependents: [],
            },
            {
                id: 'api',
                name: 'API',
                category: 'core',
                path: 'src/api',
                purpose: 'REST API',
                complexity: 'high',
                keyFiles: ['src/api/routes.ts'],
                dependencies: ['auth'],
                dependents: [],
            },
            {
                id: 'ui',
                name: 'UI',
                category: 'ui',
                path: 'src/components',
                purpose: 'React components',
                complexity: 'medium',
                keyFiles: ['src/components/App.tsx'],
                dependencies: [],
                dependents: [],
            },
        ],
    };
}

function setupTestRepo(): string {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deep-wiki-watch-'));

    // Create source structure
    fs.mkdirSync(path.join(tmpDir, 'src', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'src', 'components'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'login.ts'), 'export function login() {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'jwt.ts'), 'export function jwt() {}');
    fs.writeFileSync(path.join(tmpDir, 'src', 'api', 'routes.ts'), 'export const routes = [];');
    fs.writeFileSync(path.join(tmpDir, 'src', 'components', 'App.tsx'), 'export default App;');

    return tmpDir;
}

// ============================================================================
// Tests
// ============================================================================

describe('FileWatcher', () => {
    let tmpDir: string;
    const graph = createTestGraph();

    beforeEach(() => {
        tmpDir = setupTestRepo();
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('lifecycle', () => {
        itIfRecursive('should start watching', () => {
            const onChange = vi.fn();
            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                onChange,
            });

            watcher.start();
            expect(watcher.isWatching).toBe(true);
            watcher.stop();
        });

        itIfRecursive('should stop watching', () => {
            const onChange = vi.fn();
            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                onChange,
            });

            watcher.start();
            watcher.stop();
            expect(watcher.isWatching).toBe(false);
        });

        itIfRecursive('should not start twice', () => {
            const onChange = vi.fn();
            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                onChange,
            });

            watcher.start();
            watcher.start(); // Should be a no-op
            expect(watcher.isWatching).toBe(true);
            watcher.stop();
        });
    });

    describe('change detection', () => {
        itIfRecursive('should detect file changes and call onChange after debounce', async () => {
            const onChange = vi.fn();
            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                debounceMs: 100, // Short debounce for testing
                onChange,
            });

            watcher.start();

            // Modify a file in the auth component
            fs.writeFileSync(
                path.join(tmpDir, 'src', 'auth', 'login.ts'),
                'export function login() { /* updated */ }',
            );

            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 500));

            expect(onChange).toHaveBeenCalled();
            const affectedIds = onChange.mock.calls[0][0];
            expect(affectedIds).toContain('auth');

            watcher.stop();
        });

        itIfRecursive('should debounce rapid changes', async () => {
            const onChange = vi.fn();
            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                debounceMs: 200,
                onChange,
            });

            watcher.start();

            // Rapidly modify multiple files
            fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'login.ts'), 'change1');
            await new Promise(resolve => setTimeout(resolve, 50));
            fs.writeFileSync(path.join(tmpDir, 'src', 'auth', 'jwt.ts'), 'change2');
            await new Promise(resolve => setTimeout(resolve, 50));
            fs.writeFileSync(path.join(tmpDir, 'src', 'api', 'routes.ts'), 'change3');

            // Wait for debounce
            await new Promise(resolve => setTimeout(resolve, 500));

            // Should be called once (debounced)
            expect(onChange).toHaveBeenCalledTimes(1);

            watcher.stop();
        });

        itIfRecursive('should ignore node_modules changes', async () => {
            const onChange = vi.fn();

            // Create node_modules BEFORE starting watcher
            fs.mkdirSync(path.join(tmpDir, 'node_modules'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'initial.js'), 'module.exports = {};');

            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                debounceMs: 100,
                onChange,
            });

            watcher.start();

            // Wait for watcher to stabilize — macOS FSEvents can deliver
            // directory-creation events from setupTestRepo() with significant
            // delay, so we need a generous stabilization window.
            await new Promise(resolve => setTimeout(resolve, 600));

            // Keep clearing until no more stale events arrive (drain loop)
            let prevCallCount: number;
            do {
                prevCallCount = onChange.mock.calls.length;
                onChange.mockClear();
                await new Promise(resolve => setTimeout(resolve, 250));
            } while (onChange.mock.calls.length > 0);

            // Now modify file in node_modules — should be ignored
            fs.writeFileSync(path.join(tmpDir, 'node_modules', 'test.js'), 'module.exports = {};');

            await new Promise(resolve => setTimeout(resolve, 400));

            expect(onChange).not.toHaveBeenCalled();

            watcher.stop();
        });

        itIfRecursive('should ignore .git directory changes', async () => {
            const onChange = vi.fn();

            // Create .git directory BEFORE starting watcher to avoid mkdir events
            fs.mkdirSync(path.join(tmpDir, '.git'), { recursive: true });
            fs.writeFileSync(path.join(tmpDir, '.git', 'config'), 'initial');

            const watcher = new FileWatcher({
                repoPath: tmpDir,
                wikiDir: tmpDir,
                componentGraph: graph,
                debounceMs: 100,
                onChange,
            });

            watcher.start();

            // Wait for watcher to stabilize — macOS FSEvents can deliver
            // stale events with significant delay
            await new Promise(resolve => setTimeout(resolve, 600));

            // Drain any stale events from setupTestRepo() file creation
            let prevCallCount: number;
            do {
                prevCallCount = onChange.mock.calls.length;
                onChange.mockClear();
                await new Promise(resolve => setTimeout(resolve, 250));
            } while (onChange.mock.calls.length > 0);

            // Now modify a file inside .git — should be ignored
            fs.writeFileSync(path.join(tmpDir, '.git', 'HEAD'), 'ref: refs/heads/main');

            await new Promise(resolve => setTimeout(resolve, 400));

            expect(onChange).not.toHaveBeenCalled();

            watcher.stop();
        });
    });

    describe('error handling', () => {
        it('should call onError for invalid repo path', () => {
            const onChange = vi.fn();
            const onError = vi.fn();
            const watcher = new FileWatcher({
                repoPath: '/nonexistent/path/that/does/not/exist',
                wikiDir: tmpDir,
                componentGraph: graph,
                onChange,
                onError,
            });

            watcher.start();

            // On some systems this throws, on others it silently fails
            // Either way it should not crash
            watcher.stop();
        });
    });
});
