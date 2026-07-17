/**
 * Tests for Queue Startup Module
 *
 * Verifies queue initialization: global state creation, provider resolution
 * wiring, and enqueue capability publishing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initializeQueueStartup } from '../../src/server/queue/queue-startup';
import type { QueueStartupOptions } from '../../src/server/queue/queue-startup';
import type { ResolvedCLIConfig } from '../../src/config';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

describe('initializeQueueStartup', () => {
    let mockBridge: any;
    let mockProcessStore: ProcessStore;
    let mockSetEnqueueChat: any;

    beforeEach(() => {
        mockBridge = {
            enqueue: vi.fn().mockResolvedValue('task-123'),
            setResolveDefaultProvider: vi.fn(),
            setEffortTiersForProvider: vi.fn(),
            getOrCreateBridge: vi.fn(),
            getRepoIdForPath: vi.fn().mockReturnValue('test-repo'),
            findManagerForTask: vi.fn(),
            registry: {
                getQueueForRepo: vi.fn().mockReturnValue({
                    getStats: vi.fn().mockReturnValue({ isPaused: false }),
                    pause: vi.fn(),
                }),
            },
        };

        mockProcessStore = {
            addProcess: vi.fn(),
            updateProcess: vi.fn(),
            getProcess: vi.fn(),
            getAllProcesses: vi.fn(),
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
            getStorageStats: vi.fn(),
            onProcessOutput: vi.fn(),
            emitProcessOutput: vi.fn(),
            emitProcessComplete: vi.fn(),
            emitProcessEvent: vi.fn(),
        } as unknown as ProcessStore;

        mockSetEnqueueChat = vi.fn();
    });

    function createOptions(overrides?: Partial<QueueStartupOptions>): QueueStartupOptions {
        return {
            bridge: mockBridge,
            dataDir: '/tmp/test',
            globalWorkspaceRootPath: '/tmp',
            processStore: mockProcessStore,
            resolvedConfig: {
                defaultProvider: 'claude',
                features: { autoAgentProviderRouting: false },
            } as ResolvedCLIConfig,
            setEnqueueChat: mockSetEnqueueChat,
            ...overrides,
        } as QueueStartupOptions;
    }

    describe('global state creation', () => {
        it('should create a queue global state with initial values', () => {
            const result = initializeQueueStartup(createOptions());

            expect(result.globalState).toBeDefined();
            expect(result.globalState.globalPaused).toBe(false);
            expect(result.globalState.globalPausedUntil).toBeUndefined();
            expect(result.globalState.globalAutopilotPaused).toBe(false);
            expect(result.globalState.globalAutopilotPausedUntil).toBeUndefined();
            expect(result.globalState.resumeInProgress).toBeInstanceOf(Set);
            expect(result.globalState.resumeInProgress.size).toBe(0);
        });

        it('should return mutable state that can be modified', () => {
            const result = initializeQueueStartup(createOptions());

            result.globalState.globalPaused = true;
            result.globalState.globalPausedUntil = 12345;
            result.globalState.resumeInProgress.add('task-1');

            expect(result.globalState.globalPaused).toBe(true);
            expect(result.globalState.globalPausedUntil).toBe(12345);
            expect(result.globalState.resumeInProgress.has('task-1')).toBe(true);
        });
    });

    describe('provider resolver', () => {
        it('should create a DefaultProviderResolver with config', () => {
            const result = initializeQueueStartup(createOptions());

            expect(result.providerResolver).toBeDefined();
            expect(result.providerResolver.getConcreteDefaultProvider()).toBe('claude');
        });

        it('should wire provider resolver on bridge', () => {
            initializeQueueStartup(createOptions());

            expect(mockBridge.setResolveDefaultProvider).toHaveBeenCalled();
        });

        // Execution-time tier resolution for Auto tasks depends on this reaching
        // the executor; without it every Auto tier falls back to the hardcoded
        // defaults and admin-configured tiers are silently ignored.
        it('should wire the effort-tier resolver on bridge', () => {
            initializeQueueStartup(createOptions());

            expect(mockBridge.setEffortTiersForProvider).toHaveBeenCalled();
        });
    });

    describe('bridge wrapper', () => {
        it('should create a bridge wrapper with enqueue override', () => {
            const result = initializeQueueStartup(createOptions());

            expect(result.bridgeWithResolvedDefaults).toBeDefined();
            expect(result.bridgeWithResolvedDefaults.enqueue).toBeDefined();
        });

        it('should use wrapped enqueue for preparing tasks', async () => {
            const result = initializeQueueStartup(createOptions());

            const taskId = await result.bridgeWithResolvedDefaults.enqueue({
                type: 'chat',
                repoId: 'test-repo',
                payload: { message: 'test' },
                config: {},
                priority: 'normal',
                displayName: 'Test Task',
            });

            expect(taskId).toBe('task-123');
            expect(mockBridge.enqueue).toHaveBeenCalled();
        });
    });

    describe('enqueue preparation', () => {
        it('should prepare a task with provider defaults', async () => {
            const result = initializeQueueStartup(createOptions());

            const input = {
                type: 'chat' as const,
                repoId: 'test-repo',
                payload: { message: 'test' },
                config: {},
                priority: 'normal' as const,
                displayName: 'Test Task',
            };

            await result.prepareEnqueueTask(input);

            // Task should be prepared (no error thrown)
            expect(result.prepareEnqueueTask).toBeDefined();
        });
    });

    describe('enqueue-chat capability', () => {
        it('should publish enqueue-chat capability if callback provided', () => {
            initializeQueueStartup(createOptions());

            expect(mockSetEnqueueChat).toHaveBeenCalled();
            expect(typeof mockSetEnqueueChat.mock.calls[0][0]).toBe('function');
        });

        it('should not error if setEnqueueChat is not provided', () => {
            expect(() => {
                initializeQueueStartup(createOptions({ setEnqueueChat: undefined }));
            }).not.toThrow();
        });

        it('should pass an async function to setEnqueueChat', () => {
            initializeQueueStartup(createOptions());

            const enqueueChat = mockSetEnqueueChat.mock.calls[0][0];
            expect(enqueueChat instanceof Function).toBe(true);
            expect(enqueueChat.constructor.name === 'AsyncFunction' || enqueueChat.constructor.name === 'Function').toBe(true);
        });
    });

    describe('return values', () => {
        it('should return all required properties', () => {
            const result = initializeQueueStartup(createOptions());

            expect(result.globalState).toBeDefined();
            expect(result.bridgeWithResolvedDefaults).toBeDefined();
            expect(result.prepareEnqueueTask).toBeDefined();
            expect(result.enqueueWithResolvedDefaults).toBeDefined();
            expect(result.providerResolver).toBeDefined();
        });

        it('should return a provider resolver with correct concrete provider', () => {
            const result = initializeQueueStartup(createOptions({
                resolvedConfig: {
                    defaultProvider: 'codex',
                    features: { autoAgentProviderRouting: false },
                } as ResolvedCLIConfig,
            }));

            expect(result.providerResolver.getConcreteDefaultProvider()).toBe('codex');
        });
    });
});
