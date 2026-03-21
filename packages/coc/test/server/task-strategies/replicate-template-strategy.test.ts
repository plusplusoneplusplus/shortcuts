/**
 * ReplicateTemplateStrategy Unit Tests
 *
 * Tests the extracted ReplicateTemplateStrategy independently of CLITaskExecutor.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { ExecutionContext } from '../../../src/server/task-strategies/index';
import { ReplicateTemplateStrategy } from '../../../src/server/task-strategies/replicate-template-strategy';
import { createMockProcessStore } from '../../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

const mockReplicateCommit = vi.fn();
vi.mock('@plusplusoneplusplus/forge/templates', () => ({
    replicateCommit: (...args: any[]) => mockReplicateCommit(...args),
}));

const mockCreateCLIAIInvoker = vi.fn().mockReturnValue(vi.fn());
vi.mock('../../../src/ai-invoker', () => ({
    createCLIAIInvoker: (...args: any[]) => mockCreateCLIAIInvoker(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeReplicateTask(overrides?: Partial<QueuedTask>): QueuedTask {
    return {
        id: 'rt-1',
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat' as const,
            mode: 'autopilot',
            prompt: 'Add an endpoint like the original',
            context: {
                replication: {
                    commitHash: 'abc123def456',
                    templateName: 'add-endpoint',
                    hints: ['keep it RESTful'],
                },
            },
        },
        config: {},
        ...overrides,
    };
}

function makeContext(store: ReturnType<typeof createMockProcessStore>, overrides?: Partial<ExecutionContext>): ExecutionContext {
    return {
        processId: 'queue_rt-1',
        store,
        approvePermissions: true,
        workingDirectory: '/my/repo',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('ReplicateTemplateStrategy', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockReplicateCommit.mockReset();
        mockCreateCLIAIInvoker.mockReset();
        mockCreateCLIAIInvoker.mockReturnValue(vi.fn());
    });

    it('happy path — returns response and replicateResult', async () => {
        mockReplicateCommit.mockResolvedValue({
            summary: 'Added /health endpoint',
            files: [{ path: 'src/routes/health.ts', content: 'export default ...' }],
        });

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store);

        const result = await strategy.execute(task, ctx) as any;

        expect(result.response).toBe('Added /health endpoint');
        expect(result.replicateResult.summary).toBe('Added /health endpoint');
        expect(result.replicateResult.commitHash).toBe('abc123def456');
        expect(result.replicateResult.templateName).toBe('add-endpoint');
        expect(result.replicateResult.files).toHaveLength(1);
    });

    it('throws when workingDirectory is missing', async () => {
        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store, { workingDirectory: undefined });

        await expect(strategy.execute(task, ctx)).rejects.toThrow(
            'Cannot resolve repository root for replicate-template task'
        );
    });

    it('emits pipeline-phase started event', async () => {
        mockReplicateCommit.mockResolvedValue({ summary: 'done', files: [] });

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store);

        await strategy.execute(task, ctx);

        const events = (store.emitProcessEvent as any).mock.calls.map((c: any[]) => c[1]);
        const phaseEvents = events.filter((e: any) => e.type === 'pipeline-phase');
        expect(phaseEvents.some((e: any) => e.pipelinePhase?.status === 'started')).toBe(true);
    });

    it('emits pipeline-phase completed event on success', async () => {
        mockReplicateCommit.mockResolvedValue({ summary: 'done', files: [] });

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store);

        await strategy.execute(task, ctx);

        const events = (store.emitProcessEvent as any).mock.calls.map((c: any[]) => c[1]);
        const phaseEvents = events.filter((e: any) => e.type === 'pipeline-phase');
        expect(phaseEvents.some((e: any) => e.pipelinePhase?.status === 'completed')).toBe(true);
    });

    it('emits pipeline-phase failed event and rethrows on error', async () => {
        mockReplicateCommit.mockRejectedValue(new Error('git failure'));

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store);

        await expect(strategy.execute(task, ctx)).rejects.toThrow('git failure');

        const events = (store.emitProcessEvent as any).mock.calls.map((c: any[]) => c[1]);
        const phaseEvents = events.filter((e: any) => e.type === 'pipeline-phase');
        expect(phaseEvents.some((e: any) => e.pipelinePhase?.status === 'failed')).toBe(true);
    });

    it('passes commitHash, templateName, and hints to replicateCommit', async () => {
        mockReplicateCommit.mockResolvedValue({ summary: 'ok', files: [] });

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store);

        await strategy.execute(task, ctx);

        const callArgs = mockReplicateCommit.mock.calls[0][0];
        expect(callArgs.template.commitHash).toBe('abc123def456');
        expect(callArgs.template.name).toBe('add-endpoint');
        expect(callArgs.template.hints).toEqual(['keep it RESTful']);
        expect(callArgs.repoRoot).toBe('/my/repo');
        expect(callArgs.instruction).toBe('Add an endpoint like the original');
    });

    it('creates AI invoker with approvePermissions and workingDirectory from context', async () => {
        mockReplicateCommit.mockResolvedValue({ summary: 'ok', files: [] });

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store, { approvePermissions: false, workingDirectory: '/override' });

        await strategy.execute(task, ctx);

        expect(mockCreateCLIAIInvoker).toHaveBeenCalledWith(expect.objectContaining({
            approvePermissions: false,
            workingDirectory: '/override',
        }));
    });

    it('updates process preview in store before execution', async () => {
        mockReplicateCommit.mockResolvedValue({ summary: 'ok', files: [] });

        const strategy = new ReplicateTemplateStrategy();
        const task = makeReplicateTask();
        const ctx = makeContext(store);

        await strategy.execute(task, ctx);

        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_rt-1',
            expect.objectContaining({
                promptPreview: expect.stringContaining('abc123de'),
            }),
        );
    });
});
