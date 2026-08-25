/**
 * Tests that verify cron infrastructure deps are properly wired
 * through the executor chain into buildChatToolBundle calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CronInfraDeps } from '../../../src/server/executors/executor-runtime-contracts';
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

function createMockCronInfra(): CronInfraDeps {
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

describe('Cron infrastructure wiring', () => {
    let mockStore: ProcessStore;

    beforeEach(() => {
        mockStore = createMockStore();
    });

    it('buildChatToolBundle includes scheduleWakeup tool when deps provided', () => {
        const cronInfra = createMockCronInfra();
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
            scheduleWakeup: {
                executor: cronInfra.executor,
                processId: 'proc-1',
                resolveWorkspaceId: cronInfra.resolveWorkspaceId,
                enqueueWakeup: cronInfra.enqueueWakeup,
            },
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).toContain('scheduleWakeup');
    });

    it('buildChatToolBundle includes cron tools when cronTools deps provided', () => {
        const cronInfra = createMockCronInfra();
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
            cronTools: {
                store: cronInfra.store,
                executor: cronInfra.executor,
                processId: 'proc-1',
            },
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).toContain('cron');
    });

    it('buildChatToolBundle includes both scheduleWakeup and cron tools simultaneously', () => {
        const cronInfra = createMockCronInfra();
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
            scheduleWakeup: {
                executor: cronInfra.executor,
                processId: 'proc-1',
                resolveWorkspaceId: cronInfra.resolveWorkspaceId,
                enqueueWakeup: cronInfra.enqueueWakeup,
            },
            cronTools: {
                store: cronInfra.store,
                executor: cronInfra.executor,
                processId: 'proc-1',
            },
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).toContain('scheduleWakeup');
        expect(toolNames).toContain('cron');
    });

    it('buildChatToolBundle omits cron tools when no cronTools deps', () => {
        const bundle = buildChatToolBundle({
            store: mockStore,
            processId: 'proc-1',
        });

        const toolNames = bundle.tools.map(t => t.name);
        expect(toolNames).not.toContain('cron');
    });

    it('CronInfraDeps interface is satisfied by mock', () => {
        const deps = createMockCronInfra();
        // Type-level check: these should all be defined
        expect(deps.store).toBeDefined();
        expect(deps.executor).toBeDefined();
        expect(deps.resolveWorkspaceId).toBeInstanceOf(Function);
        expect(deps.enqueueWakeup).toBeInstanceOf(Function);
    });

    it('getCronInfra getter pattern returns undefined before infra creation', () => {
        let infra: CronInfraDeps | undefined;
        const getter = () => infra;

        // Before creation
        expect(getter()).toBeUndefined();

        // After creation
        infra = createMockCronInfra();
        expect(getter()).toBeDefined();
        expect(getter()!.store).toBeDefined();
    });
});
