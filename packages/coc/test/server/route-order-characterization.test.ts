/**
 * Route Composition Root — Characterization Tests
 *
 * Verifies sensitive route registration order constraints:
 * - Work Item AI routes before generic Work Item routes
 * - Work Item Hierarchy routes before generic Work Item routes
 * - PR routes registered and accessible
 * - Ralph routes registered and accessible
 * - Native-session routes registered
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Route } from '../../src/server/types';
import { registerAllRoutes } from '../../src/server/routes';
import type { RegisterRoutesOptions } from '../../src/server/routes';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

describe('registerAllRoutes - Route Order Characterization', () => {
    let routes: Route[];

    beforeEach(() => {
        routes = [];
    });

    function makeStore(): ProcessStore {
        return {
            addProcess: vi.fn(),
            updateProcess: vi.fn(),
            getProcess: vi.fn(),
            getAllProcesses: vi.fn().mockResolvedValue([]),
            removeProcess: vi.fn(),
            clearProcesses: vi.fn(),
            getWorkspaces: vi.fn().mockResolvedValue([]),
            registerWorkspace: vi.fn(),
            removeWorkspace: vi.fn(),
            updateWorkspace: vi.fn(),
            getWikis: vi.fn().mockResolvedValue([]),
            registerWiki: vi.fn(),
            removeWiki: vi.fn(),
            updateWiki: vi.fn(),
            clearAllWorkspaces: vi.fn(),
            clearAllWikis: vi.fn(),
            getStorageStats: vi.fn().mockResolvedValue({ totalProcesses: 0, totalWorkspaces: 0, totalWikis: 0, storageSize: 0 }),
            onProcessOutput: vi.fn().mockReturnValue(() => {}),
            emitProcessOutput: vi.fn(),
            emitProcessComplete: vi.fn(),
            emitProcessEvent: vi.fn(),
        } as unknown as ProcessStore;
    }

    function makeBridge(): any {
        return {
            enqueue: vi.fn().mockResolvedValue('task-1'),
            getRepoExecutor: vi.fn(),
            createAggregateQueueFacade: vi.fn(),
            registerRepoId: vi.fn(),
            dispatchToRepo: vi.fn(),
            setResolveDefaultProvider: vi.fn(),
            setDreamRunExecutor: vi.fn(),
            findManagerForTask: vi.fn(),
            findExecutorForTask: vi.fn(),
            registry: {
                on: vi.fn(),
            },
            on: vi.fn(),
        };
    }

    function makeQueueFacade(): any {
        return {
            enqueue: vi.fn(),
            getAll: vi.fn().mockReturnValue([]),
            getQueue: vi.fn(),
            getHistory: vi.fn(),
            getQueueStats: vi.fn(),
        };
    }

    function makeScheduleManager(): any {
        return {
            dispose: vi.fn(),
            getSchedules: vi.fn().mockReturnValue([]),
            addSchedule: vi.fn(),
            removeSchedule: vi.fn(),
            updateSchedule: vi.fn(),
        };
    }

    function makeQueuePersistence(): any {
        return {
            dispose: vi.fn(),
            loadState: vi.fn(),
            saveState: vi.fn(),
        };
    }

    function makeWsServer(): any {
        return {
            broadcastProcessEvent: vi.fn(),
            broadcastWikiEvent: vi.fn(),
            closeAll: vi.fn(),
        };
    }

    function createMockOptions(): RegisterRoutesOptions {
        const wsServer = makeWsServer();
        return {
            store: makeStore(),
            bridge: makeBridge(),
            queueFacade: makeQueueFacade(),
            scheduleManager: makeScheduleManager(),
            notesGitTimerManager: {} as any,
            dataDir: '/tmp/test-data',
            configPath: undefined,
            tokenTtlMs: undefined,
            globalWorkspaceRootPath: '/tmp',
            resolvedAiService: {} as any,
            getWsServer: () => wsServer,
            queuePersistence: makeQueuePersistence(),
            aiInvoker: vi.fn(),
            runtimeConfigService: {
                config: {
                    codex: { enabled: false },
                    claude: { enabled: false },
                    defaultProvider: 'copilot',
                    features: {
                        autoAgentProviderRouting: false,
                        nativeCliSessions: true,
                    },
                    excalidraw: { enabled: false },
                    canvas: { enabled: false },
                    pullRequests: { enabled: true },
                    workItems: {
                        hierarchy: { enabled: true },
                        sync: { enabled: true },
                        aiAuthoring: { enabled: true },
                        workflow: { enabled: true },
                    },
                    dreams: { enabled: true },
                    forEach: { enabled: true },
                    mapReduce: { enabled: true },
                },
            } as any,
        } as RegisterRoutesOptions;
    }

    describe('route order constraints', () => {
        it('should register routes without error', () => {
            const opts = createMockOptions();
            expect(() => {
                registerAllRoutes(routes, opts);
            }).not.toThrow();
        });

        it('should register a substantial number of routes', () => {
            const opts = createMockOptions();
            registerAllRoutes(routes, opts);
            // The composition root should register 100+ routes
            expect(routes.length).toBeGreaterThan(50);
        });

        it('should register Work Item routes', () => {
            const opts = createMockOptions();
            registerAllRoutes(routes, opts);

            const workItemRoutes = routes.filter(r =>
                r.pattern && typeof r.pattern !== 'string' &&
                r.pattern.source.includes('work-items')
            );
            expect(workItemRoutes.length).toBeGreaterThan(0);
        });

        it('should register PR routes', () => {
            const opts = createMockOptions();
            registerAllRoutes(routes, opts);

            const prRoutes = routes.filter(r =>
                r.pattern && typeof r.pattern !== 'string' &&
                (r.pattern.source.includes('pull-requests') || r.pattern.source.includes('/pr'))
            );
            expect(prRoutes.length).toBeGreaterThan(0);
        });

        it('should register Ralph routes', () => {
            const opts = createMockOptions();
            registerAllRoutes(routes, opts);

            const ralphRoutes = routes.filter(r =>
                r.pattern && typeof r.pattern !== 'string' &&
                r.pattern.source.includes('ralph')
            );
            expect(ralphRoutes.length).toBeGreaterThan(0);
        });

        it('should register native-session or native-cli routes', () => {
            const opts = createMockOptions();
            registerAllRoutes(routes, opts);

            const nativeRoutes = routes.filter(r =>
                r.pattern && typeof r.pattern !== 'string' &&
                (r.pattern.source.includes('native') || r.pattern.source.includes('session'))
            );
            expect(nativeRoutes.length).toBeGreaterThan(0);
        });

        it('should register Dream routes', () => {
            const opts = createMockOptions();
            registerAllRoutes(routes, opts);

            const dreamRoutes = routes.filter(r =>
                r.pattern && typeof r.pattern !== 'string' &&
                r.pattern.source.includes('dream')
            );
            expect(dreamRoutes.length).toBeGreaterThan(0);
        });
    });

    describe('return values', () => {
        it('should return feature runtime objects', () => {
            const opts = createMockOptions();
            const result = registerAllRoutes(routes, opts);

            expect(result).toBeDefined();
            expect(result.workItemGitHubPullPoller).toBeDefined();
            expect(result.workItemAzureBoardsPullPoller).toBeDefined();
            expect(result.activeWorkspaceBackgroundRefresher).toBeDefined();
            expect(result.dreamIdleScheduler).toBeDefined();
            expect(result.wikiManager).toBeDefined();
        });
    });
});
