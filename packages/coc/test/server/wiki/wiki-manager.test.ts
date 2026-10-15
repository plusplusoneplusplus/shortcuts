/**
 * Tests register/unregister lifecycle, multi-wiki independence,
 * lazy ContextBuilder, FileWatcher integration,
 * ConversationSessionManager integration, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { FakeNativeWatchService } from '../../helpers/fake-native-watch-service';
import { getServerLogger } from '../../../src/server/logging/server-logger';
import {
    WikiManager,
    WikiData,
    ContextBuilder,
    ConversationSessionManager,
} from '../../../src/server/wiki/index';
import type {
    ComponentGraph,
    AskAIFunction,
} from '../../../src/server/wiki/index';

vi.mock('fs', async importOriginal => ({ ...await importOriginal<typeof import('fs')>() }));

// ============================================================================
// Test Helpers
// ============================================================================

function makeComponentGraph(overrides?: Partial<ComponentGraph>): ComponentGraph {
    return {
        project: {
            name: 'test-project',
            description: 'A test project',
            language: 'TypeScript',
            buildSystem: 'npm',
            entryPoints: ['src/index.ts'],
        },
        components: [
            {
                id: 'auth-module',
                name: 'Authentication Module',
                path: 'src/auth',
                purpose: 'Handles user authentication',
                keyFiles: ['src/auth/index.ts'],
                dependencies: ['db-layer'],
                dependents: [],
                complexity: 'medium',
                category: 'core',
            },
            {
                id: 'db-layer',
                name: 'Database Layer',
                path: 'src/db',
                purpose: 'Manages database connections',
                keyFiles: ['src/db/index.ts'],
                dependencies: [],
                dependents: ['auth-module'],
                complexity: 'high',
                category: 'infra',
            },
        ],
        categories: [
            { name: 'core', description: 'Core logic' },
            { name: 'infra', description: 'Infrastructure' },
        ],
        architectureNotes: 'Simple architecture.',
        ...overrides,
    };
}

function createTempWikiDir(graph: ComponentGraph): string {
    const tmpDir = fs.mkdtempSync(path.resolve('.coc-wikimgr-test-'));
    fs.writeFileSync(
        path.join(tmpDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
    );
    // Write component markdown so ContextBuilder has content to index
    const componentsDir = path.join(tmpDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const mod of graph.components) {
        fs.writeFileSync(
            path.join(componentsDir, `${mod.id}.md`),
            `# ${mod.name}\n\n${mod.purpose}`,
        );
    }
    return tmpDir;
}

function createTempWikiDir2(graph: ComponentGraph): string {
    // Second helper to create a distinct wiki dir with different content
    const tmpDir = fs.mkdtempSync(path.resolve('.coc-wikimgr-test2-'));
    fs.writeFileSync(
        path.join(tmpDir, 'component-graph.json'),
        JSON.stringify(graph, null, 2),
    );
    const componentsDir = path.join(tmpDir, 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    for (const mod of graph.components) {
        fs.writeFileSync(
            path.join(componentsDir, `${mod.id}.md`),
            `# ${mod.name}\n\nAlternate wiki: ${mod.purpose}`,
        );
    }
    return tmpDir;
}

function removeTempDir(dirPath: string): void {
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {
        // Ignore cleanup errors
    }
}

const noopAI: AskAIFunction = async (prompt) => `AI response to: ${prompt}`;

// ============================================================================
// Tests
// ============================================================================

describe('WikiManager', () => {
    let tempDirs: string[] = [];

    function makeTempDir(graph?: ComponentGraph): string {
        const dir = createTempWikiDir(graph ?? makeComponentGraph());
        tempDirs.push(dir);
        return dir;
    }

    function makeTempDir2(graph?: ComponentGraph): string {
        const dir = createTempWikiDir2(graph ?? makeComponentGraph());
        tempDirs.push(dir);
        return dir;
    }

    afterEach(() => {
        vi.restoreAllMocks();
        for (const dir of tempDirs) {
            removeTempDir(dir);
        }
        tempDirs = [];
    });

    // ========================================================================
    // Register / unregister lifecycle
    // ========================================================================

    describe('register / unregister lifecycle', () => {
        it('should register a wiki with valid wikiDir and return runtime via get()', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'wiki-1', wikiDir, aiEnabled: false });

            const runtime = manager.get('wiki-1');
            expect(runtime).toBeDefined();
            expect(runtime!.wikiData).toBeInstanceOf(WikiData);
            expect(runtime!.wikiData.isLoaded).toBe(true);
            expect(runtime!.registration.wikiId).toBe('wiki-1');

            manager.disposeAll();
        });

        it('should include registered wiki ID in getRegisteredIds()', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'wiki-a', wikiDir, aiEnabled: false });

            expect(manager.getRegisteredIds()).toContain('wiki-a');

            manager.disposeAll();
        });

        it('should return undefined from get() after unregister', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'wiki-x', wikiDir, aiEnabled: false });
            const removed = manager.unregister('wiki-x');

            expect(removed).toBe(true);
            expect(manager.get('wiki-x')).toBeUndefined();
            expect(manager.getRegisteredIds()).not.toContain('wiki-x');
        });

        it('should return false when unregistering unknown wiki ID', () => {
            const manager = new WikiManager();
            expect(manager.unregister('nonexistent')).toBe(false);
        });

        it('should replace cleanly when registering same ID twice', () => {
            const dir1 = makeTempDir();
            const dir2 = makeTempDir2();
            const manager = new WikiManager();

            manager.register({ wikiId: 'wiki-dup', wikiDir: dir1, aiEnabled: false });
            manager.register({ wikiId: 'wiki-dup', wikiDir: dir2, aiEnabled: false });

            const runtime = manager.get('wiki-dup');
            expect(runtime).toBeDefined();
            // Should point to the second directory
            expect(runtime!.registration.wikiDir).toBe(path.resolve(dir2));
            expect(manager.getRegisteredIds().filter(id => id === 'wiki-dup')).toHaveLength(1);

            manager.disposeAll();
        });
    });

    // ========================================================================
    // Multi-wiki independence
    // ========================================================================

    describe('multi-wiki independence', () => {
        it('should have independent WikiData instances', () => {
            const graph1 = makeComponentGraph({ architectureNotes: 'Graph 1' });
            const graph2 = makeComponentGraph({ architectureNotes: 'Graph 2' });
            const dir1 = makeTempDir(graph1);
            const dir2 = makeTempDir2(graph2);
            const manager = new WikiManager();

            manager.register({ wikiId: 'w1', wikiDir: dir1, aiEnabled: false });
            manager.register({ wikiId: 'w2', wikiDir: dir2, aiEnabled: false });

            const r1 = manager.get('w1')!;
            const r2 = manager.get('w2')!;
            expect(r1.wikiData).not.toBe(r2.wikiData);
            expect(r1.wikiData.graph.architectureNotes).toBe('Graph 1');
            expect(r2.wikiData.graph.architectureNotes).toBe('Graph 2');

            manager.disposeAll();
        });

        it('should have independent ConversationSessionManagers', () => {
            const dir1 = makeTempDir();
            const dir2 = makeTempDir2();
            const manager = new WikiManager({ aiSendMessage: noopAI });

            manager.register({ wikiId: 'w1', wikiDir: dir1, aiEnabled: true });
            manager.register({ wikiId: 'w2', wikiDir: dir2, aiEnabled: true });

            const r1 = manager.get('w1')!;
            const r2 = manager.get('w2')!;
            expect(r1.sessionManager).not.toBeNull();
            expect(r2.sessionManager).not.toBeNull();
            expect(r1.sessionManager).not.toBe(r2.sessionManager);

            manager.disposeAll();
        });

        it('should not affect other wikis when unregistering one', () => {
            const dir1 = makeTempDir();
            const dir2 = makeTempDir2();
            const manager = new WikiManager({ aiSendMessage: noopAI });

            manager.register({ wikiId: 'w1', wikiDir: dir1, aiEnabled: true });
            manager.register({ wikiId: 'w2', wikiDir: dir2, aiEnabled: true });

            manager.unregister('w1');

            expect(manager.get('w1')).toBeUndefined();
            expect(manager.get('w2')).toBeDefined();
            expect(manager.get('w2')!.wikiData.isLoaded).toBe(true);

            manager.disposeAll();
        });
    });

    // ========================================================================
    // Lazy ContextBuilder
    // ========================================================================

    describe('lazy ContextBuilder', () => {
        it('should be null after register()', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: false });

            expect(manager.get('w')!.contextBuilder).toBeNull();

            manager.disposeAll();
        });

        it('should create ContextBuilder on ensureContextBuilder()', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: false });
            const cb = manager.ensureContextBuilder('w');

            expect(cb).toBeInstanceOf(ContextBuilder);
            expect(manager.get('w')!.contextBuilder).toBe(cb);

            manager.disposeAll();
        });

        it('should return cached instance on subsequent calls', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: false });
            const cb1 = manager.ensureContextBuilder('w');
            const cb2 = manager.ensureContextBuilder('w');

            expect(cb1).toBe(cb2);

            manager.disposeAll();
        });

        it('should invalidate ContextBuilder after reloadWikiData()', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: false });
            const cb1 = manager.ensureContextBuilder('w');

            manager.reloadWikiData('w');
            expect(manager.get('w')!.contextBuilder).toBeNull();

            const cb2 = manager.ensureContextBuilder('w');
            expect(cb2).toBeInstanceOf(ContextBuilder);
            expect(cb2).not.toBe(cb1);

            manager.disposeAll();
        });

        it('should throw for unregistered wiki ID', () => {
            const manager = new WikiManager();
            expect(() => manager.ensureContextBuilder('no-such')).toThrow('Wiki not registered');
        });
    });

    // ========================================================================
    // Cleanup on dispose
    // ========================================================================

    describe('cleanup on dispose', () => {
        it('should destroy all session managers and clear registry', () => {
            const dir1 = makeTempDir();
            const dir2 = makeTempDir2();
            const manager = new WikiManager({ aiSendMessage: noopAI });

            manager.register({ wikiId: 'w1', wikiDir: dir1, aiEnabled: true });
            manager.register({ wikiId: 'w2', wikiDir: dir2, aiEnabled: true });

            const sm1 = manager.get('w1')!.sessionManager!;
            const sm2 = manager.get('w2')!.sessionManager!;

            // Create sessions to verify they get cleaned up
            sm1.create();
            sm2.create();
            expect(sm1.size).toBe(1);
            expect(sm2.size).toBe(1);

            manager.disposeAll();

            expect(sm1.size).toBe(0);
            expect(sm2.size).toBe(0);
            expect(manager.getRegisteredIds()).toHaveLength(0);
        });

    });

    // ========================================================================
    // Invalid wiki directory
    // ========================================================================

    describe('invalid wiki directory', () => {
        it('should throw for non-existent wikiDir', () => {
            const manager = new WikiManager();
            const fakeDir = path.resolve('does-not-exist-wiki-fixture');

            expect(() => manager.register({
                wikiId: 'bad',
                wikiDir: fakeDir,
                aiEnabled: false,
            })).toThrow(/does not exist/);

            // Nothing left in registry
            expect(manager.getRegisteredIds()).toHaveLength(0);
        });

        it('should throw for wikiDir missing component-graph.json', () => {
            const tmpDir = fs.mkdtempSync(path.resolve('.coc-wikimgr-empty-'));
            tempDirs.push(tmpDir);

            const manager = new WikiManager();

            expect(() => manager.register({
                wikiId: 'bad',
                wikiDir: tmpDir,
                aiEnabled: false,
            })).toThrow(/component-graph\.json/);

            expect(manager.getRegisteredIds()).toHaveLength(0);
        });

        it('should throw with wiki ID context for malformed graph', () => {
            const tmpDir = fs.mkdtempSync(path.resolve('.coc-wikimgr-bad-'));
            tempDirs.push(tmpDir);
            fs.writeFileSync(path.join(tmpDir, 'component-graph.json'), '{ invalid json');

            const manager = new WikiManager();

            expect(() => manager.register({
                wikiId: 'my-wiki',
                wikiDir: tmpDir,
                aiEnabled: false,
            })).toThrow(/my-wiki/);

            expect(manager.getRegisteredIds()).toHaveLength(0);
        });
    });

    // ========================================================================
    // ConversationSessionManager integration
    // ========================================================================

    describe('ConversationSessionManager integration', () => {
        it('should create sessionManager when aiEnabled=true and aiSendMessage provided', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager({ aiSendMessage: noopAI });

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: true });

            const runtime = manager.get('w')!;
            expect(runtime.sessionManager).not.toBeNull();
            expect(runtime.sessionManager).toBeInstanceOf(ConversationSessionManager);

            manager.disposeAll();
        });

        describe('WikiManager FileWatcher integration', () => {
            let watchService: FakeNativeWatchService;
            const wikiDir = path.resolve('wiki-fixture');
            const repoDir = path.resolve('repo-fixture');
            const timestamp = new Date(0);
            const directoryStats: fs.Stats = {
                dev: 0, ino: 0, mode: fs.constants.S_IFDIR | 0o755, nlink: 1,
                uid: 0, gid: 0, rdev: 0, size: 0, blksize: 4096, blocks: 0,
                atimeMs: 0, mtimeMs: 0, ctimeMs: 0, birthtimeMs: 0,
                atime: timestamp, mtime: timestamp, ctime: timestamp, birthtime: timestamp,
                isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false,
                isBlockDevice: () => false, isCharacterDevice: () => false,
                isFIFO: () => false, isSocket: () => false,
            };

            beforeEach(() => {
                watchService = new FakeNativeWatchService();
                vi.spyOn(fs, 'existsSync').mockReturnValue(true);
                vi.spyOn(fs, 'statSync').mockReturnValue(directoryStats);
                vi.spyOn(WikiData.prototype, 'load').mockImplementation(() => {});
                vi.spyOn(WikiData.prototype, 'reload').mockImplementation(() => {});
                vi.spyOn(WikiData.prototype, 'graph', 'get').mockReturnValue(makeComponentGraph());
                for (const method of ['mkdtempSync', 'mkdirSync', 'writeFileSync', 'readFileSync', 'readdirSync', 'rmSync'] as const) {
                    vi.spyOn(fs, method).mockImplementation(() => {
                        throw new Error(`Watcher integration must not perform filesystem I/O: ${method}`);
                    });
                }
            });

            afterEach(() => {
                watchService.dispose();
                vi.restoreAllMocks();
            });

            it('should create FileWatcher when watch=true and repoPath set', () => {
                const manager = new WikiManager({ watchService });
                manager.register({
                    wikiId: 'w',
                    workspaceId: 'workspace-a',
                    wikiDir,
                    aiEnabled: false,
                    watch: true,
                    repoPath: repoDir,
                });

                const runtime = manager.get('w')!;
                expect(runtime.fileWatcher).not.toBeNull();
                expect(runtime.fileWatcher!.isWatching).toBe(true);
                expect(watchService.subscriptions.get(1)?.options.workspaceId).toBe('workspace-a');
                manager.disposeAll();
                expect(runtime.fileWatcher!.isWatching).toBe(false);
                expect(watchService.subscriptions.size).toBe(0);
            });

            it('should not create FileWatcher when watch=false', () => {
                const manager = new WikiManager({ watchService });
                manager.register({ wikiId: 'w', wikiDir, aiEnabled: false, watch: false });
                expect(manager.get('w')!.fileWatcher).toBeNull();
                manager.disposeAll();
            });

            it('should not create FileWatcher when watch=true but no repoPath', () => {
                const manager = new WikiManager({ watchService });
                manager.register({ wikiId: 'w', wikiDir, aiEnabled: false, watch: true });
                expect(manager.get('w')!.fileWatcher).toBeNull();
                manager.disposeAll();
            });

            it('reloads and invalidates context between rebuilding and reloaded callbacks', () => {
                const order: string[] = [];
                const reload = vi.mocked(WikiData.prototype.reload).mockImplementation(() => { order.push('reload'); });
                const onWikiReloaded = vi.fn(() => { order.push('reloaded'); });
                const onWikiRebuilding = vi.fn(() => { order.push('rebuilding'); });
                const manager = new WikiManager({ watchService, onWikiReloaded, onWikiRebuilding });
                manager.register({
                    wikiId: 'w', workspaceId: 'workspace-a', wikiDir,
                    aiEnabled: false, watch: true, repoPath: repoDir, watchDebounceMs: 100,
                });

                manager.ensureContextBuilder('w');
                expect(manager.get('w')!.contextBuilder).not.toBeNull();
                expect(watchService.subscriptions.get(1)?.options.debounceMs).toBe(100);
                watchService.emit(1, ['src/auth/new-file.ts']);
                expect(order).toEqual(['rebuilding', 'reload', 'reloaded']);
                expect(reload).toHaveBeenCalledOnce();
                expect(onWikiRebuilding).toHaveBeenCalledWith('w', ['auth-module']);
                expect(onWikiReloaded).toHaveBeenCalledWith('w', ['auth-module']);
                expect(manager.get('w')!.contextBuilder).toBeNull();
                manager.disposeAll();
            });

            it('reloads all component ids on rescan and isolates shared physical roots by workspace', () => {
                const onWikiReloaded = vi.fn();
                const manager = new WikiManager({ watchService, onWikiReloaded });
                const registration = { wikiDir, repoPath: repoDir, watch: true, aiEnabled: false };
                manager.register({ ...registration, wikiId: 'a', workspaceId: 'workspace-a' });
                manager.register({ ...registration, wikiId: 'b', workspaceId: 'workspace-b' });
                const stale = watchService.subscriptions.get(1)!.onBatch;
                watchService.emit(2, [], true);
                expect(WikiData.prototype.reload).toHaveBeenCalledOnce();
                expect(onWikiReloaded).toHaveBeenCalledExactlyOnceWith('b', ['auth-module', 'db-layer']);
                manager.unregister('a');
                stale({ subscriptionId: 1, paths: [], rescan: true });
                expect(onWikiReloaded).toHaveBeenCalledOnce();
                expect(watchService.subscriptions.has(2)).toBe(true);
                manager.disposeAll();
            });

            it('requires an explicit owning workspace for repository watching', () => {
                const manager = new WikiManager({ watchService });
                expect(() => manager.register({
                    wikiId: 'w', wikiDir, repoPath: repoDir, watch: true, aiEnabled: false,
                })).toThrow('workspaceId is required');
                expect(watchService.subscriptions.size).toBe(0);
            });

            it.each([true, false])('logs ordinary subscription failures with error callback enabled: %s', hasCallback => {
                const error = new Error('watch failed');
                vi.spyOn(watchService, 'subscribe').mockImplementationOnce(() => { throw error; });
                const warn = vi.spyOn(getServerLogger(), 'warn').mockImplementation(() => {});
                const onWikiError = vi.fn();
                const manager = new WikiManager({ watchService, onWikiError: hasCallback ? onWikiError : undefined });
                manager.register({
                    wikiId: 'w', workspaceId: 'workspace-a', wikiDir,
                    repoPath: repoDir, watch: true, aiEnabled: false,
                });
                expect(warn).toHaveBeenCalledExactlyOnceWith({
                    err: error, wikiId: 'w', workspaceId: 'workspace-a',
                }, 'Wiki repository watcher failed to start');
                if (hasCallback) expect(onWikiError).toHaveBeenCalledExactlyOnceWith('w', error);
                else expect(onWikiError).not.toHaveBeenCalled();
                expect(manager.get('w')!.fileWatcher).toBeNull();
                manager.disposeAll();
            });

            it('propagates native load errors and cleans up allocated AI session timers', () => {
                const error = new NativeAddonLoadError('missing native watch');
                vi.spyOn(watchService, 'subscribe').mockImplementationOnce(() => { throw error; });
                const destroy = vi.spyOn(ConversationSessionManager.prototype, 'destroyAll');
                const manager = new WikiManager({ watchService, aiSendMessage: noopAI });
                expect(() => manager.register({
                    wikiId: 'w', workspaceId: 'workspace-a', wikiDir,
                    repoPath: repoDir, watch: true, aiEnabled: true,
                })).toThrow(error);
                expect(destroy).toHaveBeenCalledOnce();
                expect(manager.getRegisteredIds()).toEqual([]);
            });
        });

        it('should not create sessionManager when aiEnabled=false', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager({ aiSendMessage: noopAI });

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: false });

            expect(manager.get('w')!.sessionManager).toBeNull();

            manager.disposeAll();
        });

        it('should not create sessionManager when aiEnabled=true but no aiSendMessage', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: true });

            expect(manager.get('w')!.sessionManager).toBeNull();

            manager.disposeAll();
        });

        it('should destroy sessions on unregister', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager({ aiSendMessage: noopAI });

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: true });
            const sm = manager.get('w')!.sessionManager!;
            sm.create();
            expect(sm.size).toBe(1);

            manager.unregister('w');
            expect(sm.size).toBe(0);
        });
    });

    // ========================================================================
    // reloadWikiData
    // ========================================================================

    describe('reloadWikiData', () => {
        it('should silently ignore unknown wiki ID', () => {
            const manager = new WikiManager();
            expect(() => manager.reloadWikiData('nonexistent')).not.toThrow();
        });

        it('should reload WikiData and invalidate ContextBuilder', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({ wikiId: 'w', wikiDir, aiEnabled: false });
            const cb1 = manager.ensureContextBuilder('w');
            expect(cb1).toBeInstanceOf(ContextBuilder);

            // Mutate file on disk
            const compDir = path.join(wikiDir, 'components');
            fs.writeFileSync(path.join(compDir, 'auth-module.md'), '# Updated Auth\n\nNew content.');

            manager.reloadWikiData('w');

            // ContextBuilder invalidated
            expect(manager.get('w')!.contextBuilder).toBeNull();
            // WikiData is still loaded
            expect(manager.get('w')!.wikiData.isLoaded).toBe(true);
        });
    });

});
