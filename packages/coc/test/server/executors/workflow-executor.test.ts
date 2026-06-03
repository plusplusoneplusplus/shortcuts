/**
 * WorkflowExecutor Unit Tests
 *
 * Verifies WorkflowExecutor.execute():
 * - Reading pipeline YAML and delegating to executeWorkflow
 * - Emitting pipeline-phase and pipeline-progress SSE events
 * - Tracking child pipeline-item processes in the store
 * - Persisting execution stats and pipelineConfig into process metadata
 * - Returning a structured result with pipelineName, response, and stats
 * - Forwarding model and workingDirectory from payload
 */

import * as fs from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { WorkflowExecutor } from '../../../src/server/executors/workflow-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        readFileSync: vi.fn(actual.readFileSync),
    };
});

const mockExecuteWorkflow = vi.fn();
const mockCompileToWorkflow = vi.fn();
const mockFlattenWorkflowResult = vi.fn();

vi.mock('@plusplusoneplusplus/coc-workflow', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/coc-workflow')>();
    return {
        ...actual,
        executeWorkflow: (...args: any[]) => mockExecuteWorkflow(...args),
        compileToWorkflow: (...args: any[]) => mockCompileToWorkflow(...args),
        flattenWorkflowResult: (...args: any[]) => mockFlattenWorkflowResult(...args),
    };
});

const mockCreateCLIAIInvoker = vi.fn().mockReturnValue(vi.fn());
vi.mock('../../../src/ai-invoker', () => ({
    createCLIAIInvoker: (...args: any[]) => mockCreateCLIAIInvoker(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

const SIMPLE_YAML = `name: "Test Workflow"\njob:\n  prompt: "Say hello"\n`;
const MINIMAL_CONFIG = { name: 'Test Workflow', nodes: {} };

function makeWorkflowTask(overrides?: Partial<QueuedTask>): QueuedTask {
    return {
        id: 'wf-1',
        type: 'run-workflow',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'run-workflow' as const,
            workflowPath: '/ws/.vscode/workflows/my-pipeline',
            workingDirectory: '/ws',
        },
        config: {},
        ...overrides,
    };
}

function makeSuccessWorkflowResult() {
    return {
        success: true,
        results: new Map(),
        leaves: new Map(),
        tiers: [],
        totalDurationMs: 100,
    };
}

function makeFlatResult(overrides?: object) {
    return {
        success: true,
        stats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 100 },
        items: [],
        leafOutput: [],
        formattedOutput: 'Pipeline output',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('WorkflowExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    const readFileSyncMock = vi.mocked(fs.readFileSync);

    beforeEach(() => {
        store = createMockProcessStore();
        mockExecuteWorkflow.mockReset();
        mockCompileToWorkflow.mockReset();
        mockFlattenWorkflowResult.mockReset();
        mockCreateCLIAIInvoker.mockReset();
        mockCreateCLIAIInvoker.mockReturnValue(vi.fn());
        mockCompileToWorkflow.mockReturnValue(MINIMAL_CONFIG);
        readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
            if (String(p).includes('pipeline.yaml')) return SIMPLE_YAML;
            return '';
        });
    });

    // -------------------------------------------------------------------------
    // Happy path
    // -------------------------------------------------------------------------

    it('returns structured result on success', async () => {
        mockExecuteWorkflow.mockResolvedValue(makeSuccessWorkflowResult());
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({
            id: 'queue_wf-1',
            type: 'run-workflow',
            status: 'running',
            startTime: new Date(),
            promptPreview: '',
        });

        const result = await executor.execute(task) as any;

        expect(result).toMatchObject({
            pipelineName: 'Test Workflow',
            response: 'Pipeline output',
            stats: expect.objectContaining({ totalItems: 1 }),
        });
        expect(mockExecuteWorkflow).toHaveBeenCalledOnce();
    });

    it('reads pipeline.yaml from workflowPath', async () => {
        mockExecuteWorkflow.mockResolvedValue(makeSuccessWorkflowResult());
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        await executor.execute(task);

        expect(readFileSyncMock).toHaveBeenCalledWith(
            expect.stringContaining('pipeline.yaml'),
            'utf-8',
        );
    });

    it('passes model and workingDirectory to createCLIAIInvoker', async () => {
        mockExecuteWorkflow.mockResolvedValue(makeSuccessWorkflowResult());
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store, { approvePermissions: true, workingDirectory: '/default' });
        const task = makeWorkflowTask({
            id: 'wf-model',
            payload: {
                kind: 'run-workflow' as const,
                workflowPath: '/ws/.vscode/workflows/my-pipeline',
                workingDirectory: '/workspace',
                model: 'gpt-4',
            },
        });
        await store.addProcess({ id: 'queue_wf-model', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        await executor.execute(task);

        expect(mockCreateCLIAIInvoker).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gpt-4',
            workingDirectory: '/workspace',
        }));
    });

    // -------------------------------------------------------------------------
    // SSE events
    // -------------------------------------------------------------------------

    it('emits pipeline-phase SSE event for each workflow progress event', async () => {
        let capturedCallback: ((event: any) => void) | undefined;
        mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
            capturedCallback = opts.onProgress;
            capturedCallback?.({
                nodeId: 'node-1',
                phase: 'completed',
                timestamp: new Date(),
                durationMs: 50,
                inputItemCount: 3,
            });
            return makeSuccessWorkflowResult();
        });
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith(
            'queue_wf-1',
            expect.objectContaining({
                type: 'pipeline-phase',
                pipelinePhase: expect.objectContaining({ phase: 'node-1', status: 'completed' }),
            }),
        );
    });

    it('emits pipeline-progress SSE event when itemProgress is present', async () => {
        mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
            opts.onProgress?.({
                nodeId: 'node-map',
                phase: 'running',
                timestamp: new Date(),
                itemProgress: { total: 10, completed: 5, failed: 0 },
            });
            return makeSuccessWorkflowResult();
        });
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith(
            'queue_wf-1',
            expect.objectContaining({
                type: 'pipeline-progress',
                pipelineProgress: expect.objectContaining({
                    totalItems: 10,
                    completedItems: 5,
                    percentage: 50,
                }),
            }),
        );
    });

    // -------------------------------------------------------------------------
    // Child process tracking
    // -------------------------------------------------------------------------

    it('adds child pipeline-item processes to the store', async () => {
        mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
            opts.onItemProcess?.({
                processId: 'item-proc-1',
                itemIndex: 0,
                nodeId: 'map-node',
                itemLabel: 'Item 0',
                status: 'running',
            });
            return makeSuccessWorkflowResult();
        });
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        await executor.execute(task);

        const childProcess = store.processes.get('item-proc-1');
        expect(childProcess).toBeDefined();
        expect(childProcess?.type).toBe('pipeline-item');
        expect(childProcess?.parentProcessId).toBe('queue_wf-1');
    });

    it('updates parent process groupMetadata when child processes exist', async () => {
        mockExecuteWorkflow.mockImplementation(async (_config: any, opts: any) => {
            opts.onItemProcess?.({ processId: 'child-1', itemIndex: 0, nodeId: 'n', status: 'completed' });
            opts.onItemProcess?.({ processId: 'child-2', itemIndex: 1, nodeId: 'n', status: 'completed' });
            return makeSuccessWorkflowResult();
        });
        mockFlattenWorkflowResult.mockReturnValue(makeFlatResult());

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        await executor.execute(task);

        // Allow microtask queue to flush (updateProcess is fire-and-forget)
        await new Promise(r => setTimeout(r, 10));

        const parent = store.processes.get('queue_wf-1');
        expect(parent?.groupMetadata?.type).toBe('pipeline-execution');
        expect(parent?.groupMetadata?.childProcessIds).toEqual(expect.arrayContaining(['child-1', 'child-2']));
    });

    // -------------------------------------------------------------------------
    // Metadata persistence
    // -------------------------------------------------------------------------

    it('persists executionStats and pipelineConfig into process metadata', async () => {
        const flatResult = makeFlatResult({
            stats: { totalItems: 2, successfulItems: 2, failedItems: 0, durationMs: 200 },
        });
        mockExecuteWorkflow.mockResolvedValue(makeSuccessWorkflowResult());
        mockFlattenWorkflowResult.mockReturnValue(flatResult);

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '', metadata: { type: 'run-workflow' } });

        await executor.execute(task);
        // Allow the fire-and-forget metadata update promise chain to resolve
        await new Promise(r => setTimeout(r, 10));

        const proc = store.processes.get('queue_wf-1');
        expect(proc?.metadata?.executionStats).toEqual(flatResult.stats);
        expect(proc?.metadata?.pipelineConfig).toEqual(MINIMAL_CONFIG);
    });

    // -------------------------------------------------------------------------
    // formattedOutput fallback
    // -------------------------------------------------------------------------

    it('falls back to JSON.stringify(stats) when formattedOutput is undefined', async () => {
        const stats = { totalItems: 1, successfulItems: 0, failedItems: 1, durationMs: 0 };
        mockExecuteWorkflow.mockResolvedValue(makeSuccessWorkflowResult());
        mockFlattenWorkflowResult.mockReturnValue({ ...makeFlatResult(), formattedOutput: undefined, stats });

        const executor = new WorkflowExecutor(store);
        const task = makeWorkflowTask();
        await store.addProcess({ id: 'queue_wf-1', type: 'run-workflow', status: 'running', startTime: new Date(), promptPreview: '' });

        const result = await executor.execute(task) as any;

        expect(result.response).toBe(JSON.stringify(stats));
    });
});
