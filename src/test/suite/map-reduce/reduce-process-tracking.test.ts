/**
 * Tests for AI Reduce Process Tracking
 *
 * Verifies that AI reduce operations are properly tracked in the process manager.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as assert from 'assert';
import {
    createPromptMapJob,
    createPromptMapInput,
    PromptItem,
    ProcessTracker,
    AIInvoker
} from '../../../shortcuts/map-reduce';
import { MapReduceExecutor } from '../../../shortcuts/map-reduce/executor';

// Mock process tracker that records all calls
interface ProcessTrackerCall {
    method: string;
    args: unknown[];
}

function createMockProcessTracker(): { tracker: ProcessTracker; calls: ProcessTrackerCall[] } {
    const calls: ProcessTrackerCall[] = [];
    let processId = 0;

    const tracker: ProcessTracker = {
        registerProcess(description: string, parentGroupId?: string): string {
            const id = `process-${processId++}`;
            calls.push({ method: 'registerProcess', args: [description, parentGroupId] });
            return id;
        },
        updateProcess(
            processId: string,
            status: 'running' | 'completed' | 'failed',
            response?: string,
            error?: string,
            structuredResult?: string
        ): void {
            calls.push({ method: 'updateProcess', args: [processId, status, response, error, structuredResult] });
        },
        registerGroup(description: string): string {
            const id = `group-${processId++}`;
            calls.push({ method: 'registerGroup', args: [description] });
            return id;
        },
        completeGroup(
            groupId: string,
            summary: string,
            stats: { totalItems: number; successfulMaps: number; failedMaps: number }
        ): void {
            calls.push({ method: 'completeGroup', args: [groupId, summary, stats] });
        }
    };

    return { tracker, calls };
}

suite('AI Reduce Process Tracking', () => {
    test('registers process for AI reduce', async () => {
        const { tracker, calls } = createMockProcessTracker();

        // Create a mock AI invoker that returns JSON for structured mode
        const mockAIInvoker: AIInvoker = async (prompt) => ({
            success: true,
            response: JSON.stringify({ summary: 'Test summary', priority: 'high' })
        });

        const job = createPromptMapJob({
            aiInvoker: mockAIInvoker,
            outputFormat: 'ai',
            aiReducePrompt: 'Summarize: {{results}}',
            aiReduceOutput: ['summary', 'priority'],
            maxConcurrency: 1
        });

        const executor = new MapReduceExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1,
            reduceMode: 'ai',
            showProgress: false,
            retryOnFailure: false,
            processTracker: tracker
        });

        const items: PromptItem[] = [
            { name: 'Item 1', description: 'First item' },
            { name: 'Item 2', description: 'Second item' }
        ];

        const input = createPromptMapInput(
            items,
            'Process: {{name}}',
            ['result']
        );

        await executor.execute(job, input);

        // Verify that registerProcess was called for the AI reduce step
        const reduceRegisterCalls = calls.filter(
            c => c.method === 'registerProcess' &&
                 (c.args[0] as string).includes('AI Reduce')
        );
        assert.strictEqual(reduceRegisterCalls.length, 1, 'Should register one AI reduce process');

        // Verify that updateProcess was called for the AI reduce step
        const reduceUpdateCalls = calls.filter(
            c => c.method === 'updateProcess' &&
                 c.args[1] === 'completed'
        );
        assert.ok(reduceUpdateCalls.length >= 1, 'Should update at least one process as completed');
    });

    test('updates process as failed when AI reduce fails', async () => {
        const { tracker, calls } = createMockProcessTracker();

        // Create a mock AI invoker that fails on reduce (successful on map)
        let callCount = 0;
        const mockAIInvoker: AIInvoker = async (prompt) => {
            callCount++;
            // First calls are for map phase, last call is for reduce
            if (prompt.includes('Summarize:')) {
                return { success: false, error: 'AI service unavailable' };
            }
            return { success: true, response: JSON.stringify({ result: 'ok' }) };
        };

        const job = createPromptMapJob({
            aiInvoker: mockAIInvoker,
            outputFormat: 'ai',
            aiReducePrompt: 'Summarize: {{results}}',
            aiReduceOutput: ['summary'],
            maxConcurrency: 1
        });

        const executor = new MapReduceExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1,
            reduceMode: 'ai',
            showProgress: false,
            retryOnFailure: false,
            processTracker: tracker
        });

        const items: PromptItem[] = [
            { name: 'Item 1' }
        ];

        const input = createPromptMapInput(
            items,
            'Process: {{name}}',
            ['result']
        );

        try {
            await executor.execute(job, input);
        } catch {
            // Expected to fail
        }

        // Verify that updateProcess was called with 'failed' status for AI reduce
        const reduceFailedCalls = calls.filter(
            c => c.method === 'updateProcess' && c.args[1] === 'failed'
        );
        assert.ok(reduceFailedCalls.length >= 1, 'Should update AI reduce process as failed');
    });

    test('tracks AI reduce in text mode (no output fields)', async () => {
        const { tracker, calls } = createMockProcessTracker();

        // Create a mock AI invoker for text mode
        const mockAIInvoker: AIInvoker = async (prompt) => ({
            success: true,
            response: 'This is a text summary without structured output'
        });

        const job = createPromptMapJob({
            aiInvoker: mockAIInvoker,
            outputFormat: 'ai',
            aiReducePrompt: 'Summarize: {{results}}',
            aiReduceOutput: [], // Empty output fields = text mode
            maxConcurrency: 1
        });

        const executor = new MapReduceExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1,
            reduceMode: 'ai',
            showProgress: false,
            retryOnFailure: false,
            processTracker: tracker
        });

        const items: PromptItem[] = [
            { name: 'Item 1' }
        ];

        const input = createPromptMapInput(
            items,
            'Process: {{name}}',
            [] // Text mode for map as well
        );

        await executor.execute(job, input);

        // Verify that registerProcess was called for AI reduce
        const reduceRegisterCalls = calls.filter(
            c => c.method === 'registerProcess' &&
                 (c.args[0] as string).includes('AI Reduce')
        );
        assert.strictEqual(reduceRegisterCalls.length, 1, 'Should register one AI reduce process');

        // Verify completed update call
        const reduceCompletedCalls = calls.filter(
            c => c.method === 'updateProcess' && c.args[1] === 'completed'
        );
        assert.ok(reduceCompletedCalls.length >= 1, 'Should update AI reduce process as completed');
    });

    test('does not track AI reduce when no processTracker provided', async () => {
        // Create a mock AI invoker
        const mockAIInvoker: AIInvoker = async () => ({
            success: true,
            response: JSON.stringify({ summary: 'Test' })
        });

        const job = createPromptMapJob({
            aiInvoker: mockAIInvoker,
            outputFormat: 'ai',
            aiReducePrompt: 'Summarize: {{results}}',
            aiReduceOutput: ['summary'],
            maxConcurrency: 1
        });

        const executor = new MapReduceExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1,
            reduceMode: 'ai',
            showProgress: false,
            retryOnFailure: false
            // No processTracker
        });

        const items: PromptItem[] = [{ name: 'Item 1' }];
        const input = createPromptMapInput(items, 'Process: {{name}}', ['result']);

        // Should complete without errors even without processTracker
        const result = await executor.execute(job, input);
        assert.ok(result.reduceStats?.usedAIReduce, 'Should have used AI reduce');
    });

    test('tracks reduce process with correct parent group ID', async () => {
        const { tracker, calls } = createMockProcessTracker();

        const mockAIInvoker: AIInvoker = async () => ({
            success: true,
            response: JSON.stringify({ summary: 'Test' })
        });

        const job = createPromptMapJob({
            aiInvoker: mockAIInvoker,
            outputFormat: 'ai',
            aiReducePrompt: 'Summarize: {{results}}',
            aiReduceOutput: ['summary'],
            maxConcurrency: 1
        });

        const executor = new MapReduceExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1,
            reduceMode: 'ai',
            showProgress: false,
            retryOnFailure: false,
            processTracker: tracker
        });

        const items: PromptItem[] = [
            { name: 'Item 1' },
            { name: 'Item 2' }
        ];

        const input = createPromptMapInput(items, 'Process: {{name}}', ['result']);

        await executor.execute(job, input);

        // Find the group registration
        const groupRegisterCalls = calls.filter(c => c.method === 'registerGroup');
        assert.ok(groupRegisterCalls.length >= 1, 'Should register a group');

        // Find the AI reduce process registration
        const reduceRegisterCalls = calls.filter(
            c => c.method === 'registerProcess' &&
                 (c.args[0] as string).includes('AI Reduce')
        );
        assert.strictEqual(reduceRegisterCalls.length, 1, 'Should register one AI reduce process');

        // The reduce process should have a parent group ID
        const reduceCall = reduceRegisterCalls[0];
        assert.ok(reduceCall.args[1], 'AI reduce process should have a parent group ID');
    });

    test('stores structured result on successful AI reduce', async () => {
        const { tracker, calls } = createMockProcessTracker();

        const mockAIInvoker: AIInvoker = async () => ({
            success: true,
            response: JSON.stringify({ summary: 'Test summary', priority: 'high' })
        });

        const job = createPromptMapJob({
            aiInvoker: mockAIInvoker,
            outputFormat: 'ai',
            aiReducePrompt: 'Summarize: {{results}}',
            aiReduceOutput: ['summary', 'priority'],
            maxConcurrency: 1
        });

        const executor = new MapReduceExecutor({
            aiInvoker: mockAIInvoker,
            maxConcurrency: 1,
            reduceMode: 'ai',
            showProgress: false,
            retryOnFailure: false,
            processTracker: tracker
        });

        const items: PromptItem[] = [{ name: 'Item 1' }];
        const input = createPromptMapInput(items, 'Process: {{name}}', ['result']);

        await executor.execute(job, input);

        // Find the completed update call for AI reduce
        const completedCalls = calls.filter(
            c => c.method === 'updateProcess' && c.args[1] === 'completed'
        );

        // At least one should have a structured result (the AI reduce)
        const callWithStructuredResult = completedCalls.find(c => c.args[4]);
        assert.ok(callWithStructuredResult, 'Should have a call with structured result');

        // Verify the structured result is valid JSON
        const structuredResult = callWithStructuredResult.args[4] as string;
        const parsed = JSON.parse(structuredResult);
        assert.ok(parsed, 'Structured result should be valid JSON');
    });
});
