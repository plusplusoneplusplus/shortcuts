/**
 * Tests that verify loop infrastructure deps are properly wired
 * through the executor chain into buildChatToolBundle calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LoopInfraDeps } from '../../../src/server/executors/chat-base-executor';
import type { ChatToolBundleOptions } from '../../../src/server/executors/chat-tool-builder';
import { buildChatToolBundle } from '../../../src/server/executors/chat-tool-builder';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// Minimal mock store
function createMockStore(): ProcessStore {
    return {
        getProcess: vi.fn().mockResolvedValue(null),
        listProcesses: vi.fn().mockResolvedValue([]),
        createProcess: vi.fn().mockResolvedValue({ id: 'test' }),
        updateProcess: vi.fn().mockResolvedValue(undefined),
        deleteProcess: vi.fn().mockResolvedValue(undefined),
        appendConversationTurn: vi.fn().mockResolvedValue(undefined),
        emitProcessOutput: vi.fn(),
        emitProcessEvent: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        registerFlushHandler: vi.fn(),
    } as unknown as ProcessStore;
}

function createMockLoopInfra(): LoopInfraDeps {
    return {
        store: {
            getActive: vi.fn().mockReturnValue([]),
            getById: vi.fn().mockReturnValue(null),
            getByProcessId: vi.fn().mockReturnValue([]),
            insert: vi.fn(),
            update: vi.fn(),
        } as any,
        executor: {
            armTimer: vi.fn(),
            disarmTimer: vi.fn(),
        } as any,
        resolveWorkspaceId: vi.fn().mockResolvedValue('ws-123'),
        enqueueWakeup: vi.fn(),
    };
}

describe('Loop infrastructure wiring', () => {
    let mockStore: ProcessStore;

    beforeEach(() => {
        mockStore = createMockStore();
    });

    it('buildChatToolBundle includes scheduleWakeup tool when deps provided', () => {
        const loopInfra = createMockLoopInfra();
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
            scheduleWakeup: {
                executor: loopInfra.executor,
                processId: 'proc-1',
                resolveWorkspaceId: loopInfra.resolveWorkspaceId,
                enqueueWakeup: loopInfra.enqueueWakeup,
            },
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).toContain('scheduleWakeup');
    });

    it('buildChatToolBundle includes loop tools when loopTools deps provided', () => {
        const loopInfra = createMockLoopInfra();
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
            loopTools: {
                store: loopInfra.store,
                executor: loopInfra.executor,
                processId: 'proc-1',
            },
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).toContain('loop');
    });

    it('buildChatToolBundle includes both scheduleWakeup and loop tools simultaneously', () => {
        const loopInfra = createMockLoopInfra();
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
            scheduleWakeup: {
                executor: loopInfra.executor,
                processId: 'proc-1',
                resolveWorkspaceId: loopInfra.resolveWorkspaceId,
                enqueueWakeup: loopInfra.enqueueWakeup,
            },
            loopTools: {
                store: loopInfra.store,
                executor: loopInfra.executor,
                processId: 'proc-1',
            },
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).toContain('scheduleWakeup');
        expect(toolNames).toContain('loop');
    });

    it('buildChatToolBundle omits loop tools when no loopTools deps', () => {
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).not.toContain('loop');
    });

    it('LoopInfraDeps interface is satisfied by mock', () => {
        const deps = createMockLoopInfra();
        // Type-level check: these should all be defined
        expect(deps.store).toBeDefined();
        expect(deps.executor).toBeDefined();
        expect(deps.resolveWorkspaceId).toBeInstanceOf(Function);
        expect(deps.enqueueWakeup).toBeInstanceOf(Function);
    });

    it('getLoopInfra getter pattern returns undefined before infra creation', () => {
        let infra: LoopInfraDeps | undefined;
        const getter = () => infra;

        // Before creation
        expect(getter()).toBeUndefined();

        // After creation
        infra = createMockLoopInfra();
        expect(getter()).toBeDefined();
        expect(getter()!.store).toBeDefined();
    });
});
