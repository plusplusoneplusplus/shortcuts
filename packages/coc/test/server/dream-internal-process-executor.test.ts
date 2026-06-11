import { describe, expect, it, vi } from 'vitest';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import {
    DreamInternalProcessExecutionError,
    DreamInternalProcessExecutor,
} from '../../src/server/executors/dream-internal-process-executor';
import { createMockProcessStore } from './helpers/mock-process-store';

function mockAiService(response: string): ISDKService {
    return {
        sendMessage: vi.fn().mockResolvedValue({
            success: true,
            response,
            effectiveModel: 'claude-sonnet-4.6',
        }),
        isAvailable: vi.fn(),
        clearAvailabilityCache: vi.fn(),
        listModels: vi.fn(),
        transform: vi.fn(),
        forkSession: vi.fn(),
        abortSession: vi.fn(),
        softAbortSession: vi.fn(),
        loadSessionHistory: vi.fn(),
        checkSessionHealth: vi.fn(),
    } as unknown as ISDKService;
}

describe('DreamInternalProcessExecutor', () => {
    it('persists analyzer prompt and response as a read-only internal process', async () => {
        const store = createMockProcessStore();
        const aiService = mockAiService(JSON.stringify({ candidates: [] }));
        const executor = new DreamInternalProcessExecutor({
            store,
            aiService,
            provider: 'claude',
        });

        const result = await executor.runStep({
            purpose: 'analyzer',
            workspaceId: 'ws-dream-process',
            runId: 'dream-run-1',
            parentProcessId: 'queue_outer-dream-run',
            prompt: 'Analyze these conversations.',
            systemPrompt: 'You are the CoC Dream analyzer.',
            provider: 'claude',
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            timeoutMs: 45_000,
        });

        const process = await store.getProcess(result.processId);
        expect(process).toMatchObject({
            id: result.processId,
            type: 'dream-analyzer',
            status: 'completed',
            parentProcessId: 'queue_outer-dream-run',
            result: expect.stringContaining('"response"'),
            title: 'Dream analyzer',
            metadata: {
                type: 'dream-analyzer',
                workspaceId: 'ws-dream-process',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
                mode: 'ask',
                dreamStep: {
                    kind: 'analyzer',
                    purpose: 'Dream analyzer',
                    workspaceId: 'ws-dream-process',
                    runId: 'dream-run-1',
                    readOnly: true,
                    toolsEnabled: false,
                    mcpEnabled: false,
                    permissionPolicy: 'deny-all',
                    timeoutMs: 45_000,
                    parentProcessId: 'queue_outer-dream-run',
                },
            },
        });
        expect(process?.conversationTurns).toHaveLength(2);
        expect(process?.conversationTurns?.[0]).toMatchObject({
            role: 'user',
            content: 'Analyze these conversations.',
            model: 'claude-sonnet-4.6',
            mode: 'ask',
        });
        expect(process?.conversationTurns?.[1]).toMatchObject({
            role: 'assistant',
            content: JSON.stringify({ candidates: [] }),
            model: 'claude-sonnet-4.6',
        });

        expect(aiService.sendMessage).toHaveBeenCalledOnce();
        const [sendOptions] = vi.mocked(aiService.sendMessage).mock.calls[0];
        expect(sendOptions).toMatchObject({
            prompt: 'Analyze these conversations.',
            model: 'claude-sonnet-4.6',
            reasoningEffort: 'high',
            timeoutMs: 45_000,
            mode: 'interactive',
            streaming: false,
            loadDefaultMcpConfig: false,
            mcpServers: {},
            availableTools: [],
            tools: [],
            systemMessage: {
                mode: 'replace',
                content: 'You are the CoC Dream analyzer.',
            },
        });
        expect(sendOptions.onPermissionRequest).toBeTypeOf('function');
    });

    it('links critic processes to the parent run and analyzer process', async () => {
        const store = createMockProcessStore();
        const aiService = mockAiService(JSON.stringify({ decisions: [] }));
        const executor = new DreamInternalProcessExecutor({
            store,
            aiService,
        });

        const result = await executor.runStep({
            purpose: 'critic',
            workspaceId: 'ws-dream-process',
            runId: 'dream-run-1',
            parentProcessId: 'queue_outer-dream-run',
            analyzerProcessId: 'queue_dream-analyzer-1',
            prompt: 'Critic candidates.',
            systemPrompt: 'You are the CoC Dream critic.',
            timeoutMs: 30_000,
        });

        const process = await store.getProcess(result.processId);
        expect(process).toMatchObject({
            type: 'dream-critic',
            parentProcessId: 'queue_outer-dream-run',
            metadata: {
                provider: 'copilot',
                dreamStep: {
                    kind: 'critic',
                    runId: 'dream-run-1',
                    parentProcessId: 'queue_outer-dream-run',
                    analyzerProcessId: 'queue_dream-analyzer-1',
                    readOnly: true,
                    toolsEnabled: false,
                    mcpEnabled: false,
                },
            },
        });
    });

    it('keeps internal Dream process history scoped by workspace', async () => {
        const store = createMockProcessStore();
        const aiService = mockAiService(JSON.stringify({ candidates: [] }));
        const executor = new DreamInternalProcessExecutor({
            store,
            aiService,
            provider: 'claude',
        });

        const workspaceOne = await executor.runStep({
            purpose: 'analyzer',
            workspaceId: 'ws-dream-one',
            runId: 'dream-run-one',
            parentProcessId: 'queue_outer-dream-one',
            prompt: 'Analyze workspace one.',
            systemPrompt: 'You are the CoC Dream analyzer.',
            model: 'claude-sonnet-4.6',
            timeoutMs: 45_000,
        });
        const workspaceTwo = await executor.runStep({
            purpose: 'critic',
            workspaceId: 'ws-dream-two',
            runId: 'dream-run-two',
            parentProcessId: 'queue_outer-dream-two',
            analyzerProcessId: 'queue_dream-analyzer-two',
            prompt: 'Criticize workspace two candidates.',
            systemPrompt: 'You are the CoC Dream critic.',
            model: 'claude-sonnet-4.6',
            timeoutMs: 45_000,
        });

        await expect(store.getProcessCount({ workspaceId: 'ws-dream-one' })).resolves.toBe(1);
        await expect(store.getProcessCount({ workspaceId: 'ws-dream-two' })).resolves.toBe(1);
        const workspaceOneSummaries = await store.getProcessSummaries({ workspaceId: 'ws-dream-one' });
        const workspaceTwoSummaries = await store.getProcessSummaries({ workspaceId: 'ws-dream-two' });
        expect(workspaceOneSummaries.entries.map(entry => entry.id)).toEqual([workspaceOne.processId]);
        expect(workspaceTwoSummaries.entries.map(entry => entry.id)).toEqual([workspaceTwo.processId]);

        await expect(store.getProcess(workspaceOne.processId)).resolves.toMatchObject({
            type: 'dream-analyzer',
            metadata: {
                workspaceId: 'ws-dream-one',
                dreamStep: {
                    kind: 'analyzer',
                    workspaceId: 'ws-dream-one',
                    parentProcessId: 'queue_outer-dream-one',
                },
            },
        });
        await expect(store.getProcess(workspaceTwo.processId)).resolves.toMatchObject({
            type: 'dream-critic',
            metadata: {
                workspaceId: 'ws-dream-two',
                dreamStep: {
                    kind: 'critic',
                    workspaceId: 'ws-dream-two',
                    parentProcessId: 'queue_outer-dream-two',
                    analyzerProcessId: 'queue_dream-analyzer-two',
                },
            },
        });
    });

    it('marks an in-flight internal process cancelled when the outer dream run aborts', async () => {
        const store = createMockProcessStore();
        const controller = new AbortController();
        const aiService = mockAiService(JSON.stringify({ candidates: [] }));
        vi.mocked(aiService.sendMessage).mockImplementationOnce(async () => {
            controller.abort();
            return {
                success: true,
                response: JSON.stringify({ candidates: [] }),
                effectiveModel: 'claude-sonnet-4.6',
            };
        });
        const executor = new DreamInternalProcessExecutor({
            store,
            aiService,
            provider: 'claude',
        });

        let error: unknown;
        try {
            await executor.runStep({
                purpose: 'analyzer',
                workspaceId: 'ws-dream-process',
                runId: 'dream-run-1',
                parentProcessId: 'queue_outer-dream-run',
                prompt: 'Analyze these conversations.',
                systemPrompt: 'You are the CoC Dream analyzer.',
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                timeoutMs: 45_000,
                signal: controller.signal,
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(DreamInternalProcessExecutionError);
        expect(error).toMatchObject({
            purpose: 'analyzer',
            message: 'Dream analyzer was cancelled',
        });
        const processId = (error as DreamInternalProcessExecutionError).processId;
        const process = await store.getProcess(processId);
        expect(process).toMatchObject({
            id: processId,
            type: 'dream-analyzer',
            status: 'cancelled',
            parentProcessId: 'queue_outer-dream-run',
            metadata: {
                dreamStep: {
                    kind: 'analyzer',
                    runId: 'dream-run-1',
                    readOnly: true,
                    toolsEnabled: false,
                    mcpEnabled: false,
                    permissionPolicy: 'deny-all',
                },
            },
        });
        expect(process?.error).toBeUndefined();
        expect(process?.conversationTurns?.[1]).toMatchObject({
            role: 'assistant',
            content: JSON.stringify({ candidates: [] }),
        });
        const [sendOptions] = vi.mocked(aiService.sendMessage).mock.calls[0];
        expect(sendOptions.signal).toBe(controller.signal);
        expect(sendOptions.loadDefaultMcpConfig).toBe(false);
        expect(sendOptions.availableTools).toEqual([]);
        expect(sendOptions.tools).toEqual([]);
    });
});
