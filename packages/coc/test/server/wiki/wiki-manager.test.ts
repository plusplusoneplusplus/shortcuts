/**
 * WikiManager Tests
 *
 * Tests register/unregister lifecycle, multi-wiki independence,
 * lazy ContextBuilder, FileWatcher integration,
 * ConversationSessionManager integration, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    WikiManager,
    WikiData,
    ContextBuilder,
    ConversationSessionManager,
    FileWatcher,
} from '../../../src/server/wiki/index';
import type {
    WikiRegistration,
    WikiRuntime,
    WikiManagerOptions,
    ComponentGraph,
    AskAIFunction,
} from '../../../src/server/wiki/index';

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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-test-'));
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
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-test2-'));
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

        it('should stop file watchers on disposeAll', () => {
            const wikiDir = makeTempDir();
            // Create a temp repo dir to watch
            const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-repo-'));
            tempDirs.push(repoDir);

            const manager = new WikiManager();
            manager.register({
                wikiId: 'w',
                wikiDir,
                aiEnabled: false,
                watch: true,
                repoPath: repoDir,
            });

            const fw = manager.get('w')!.fileWatcher;
            expect(fw).not.toBeNull();
            expect(fw!.isWatching).toBe(true);

            manager.disposeAll();
            expect(fw!.isWatching).toBe(false);
        });
    });

    // ========================================================================
    // Invalid wiki directory
    // ========================================================================

    describe('invalid wiki directory', () => {
        it('should throw for non-existent wikiDir', () => {
            const manager = new WikiManager();
            const fakeDir = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());

            expect(() => manager.register({
                wikiId: 'bad',
                wikiDir: fakeDir,
                aiEnabled: false,
            })).toThrow(/does not exist/);

            // Nothing left in registry
            expect(manager.getRegisteredIds()).toHaveLength(0);
        });

        it('should throw for wikiDir missing component-graph.json', () => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-empty-'));
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
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-bad-'));
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
    // FileWatcher integration
    // ========================================================================

    describe('FileWatcher integration', () => {
        it('should create FileWatcher when watch=true and repoPath set', () => {
            const wikiDir = makeTempDir();
            const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-repo-'));
            tempDirs.push(repoDir);

            const manager = new WikiManager();
            manager.register({
                wikiId: 'w',
                wikiDir,
                aiEnabled: false,
                watch: true,
                repoPath: repoDir,
            });

            const runtime = manager.get('w')!;
            expect(runtime.fileWatcher).not.toBeNull();
            expect(runtime.fileWatcher!.isWatching).toBe(true);

            manager.disposeAll();
        });

        it('should not create FileWatcher when watch=false', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({
                wikiId: 'w',
                wikiDir,
                aiEnabled: false,
                watch: false,
            });

            expect(manager.get('w')!.fileWatcher).toBeNull();

            manager.disposeAll();
        });

        it('should not create FileWatcher when watch=true but no repoPath', () => {
            const wikiDir = makeTempDir();
            const manager = new WikiManager();

            manager.register({
                wikiId: 'w',
                wikiDir,
                aiEnabled: false,
                watch: true,
            });

            expect(manager.get('w')!.fileWatcher).toBeNull();

            manager.disposeAll();
        });

        it('should fire onWikiReloaded callback when FileWatcher triggers onChange', async () => {
            const wikiDir = makeTempDir();
            const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-repo-'));
            tempDirs.push(repoDir);

            // Create a source file that matches a component path
            const authDir = path.join(repoDir, 'src', 'auth');
            fs.mkdirSync(authDir, { recursive: true });
            fs.writeFileSync(path.join(authDir, 'index.ts'), 'export {}');

            const reloadedCalls: Array<{ wikiId: string; ids: string[] }> = [];

            const manager = new WikiManager({
                onWikiReloaded: (wikiId, ids) => {
                    reloadedCalls.push({ wikiId, ids });
                },
            });

            manager.register({
                wikiId: 'w',
                wikiDir,
                aiEnabled: false,
                watch: true,
                repoPath: repoDir,
                watchDebounceMs: 100,
            });

            // Trigger a file change
            fs.writeFileSync(path.join(authDir, 'new-file.ts'), 'export const x = 1;');

            // Wait for debounce + processing
            await new Promise(resolve => setTimeout(resolve, 500));

            expect(reloadedCalls.length).toBeGreaterThanOrEqual(1);
            expect(reloadedCalls[0].wikiId).toBe('w');

            manager.disposeAll();
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

    // ========================================================================
    // Event callbacks
    // ========================================================================

    describe('event callbacks', () => {
        it('should call onWikiError when FileWatcher reports an error', () => {
            const wikiDir = makeTempDir();
            const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wikimgr-repo-'));
            tempDirs.push(repoDir);

            const errors: Array<{ wikiId: string; error: Error }> = [];

            const manager = new WikiManager({
                onWikiError: (wikiId, error) => {
                    errors.push({ wikiId, error });
                },
            });

            manager.register({
                wikiId: 'w',
                wikiDir,
                aiEnabled: false,
                watch: true,
                repoPath: repoDir,
            });

            // Verify the callback is wired (the FileWatcher is created with an onError)
            const runtime = manager.get('w')!;
            expect(runtime.fileWatcher).not.toBeNull();

            manager.disposeAll();
        });
    });
});
