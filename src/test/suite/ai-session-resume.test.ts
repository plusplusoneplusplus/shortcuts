/**
 * AI Session Resume Tests
 *
 * Tests for the AI session resume functionality that allows users to resume
 * completed Copilot SDK sessions in interactive mode.
 */

import * as assert from 'assert';
import {
    AIProcess,
    AIProcessManager,
    SerializedAIProcess,
    serializeProcess,
    deserializeProcess,
    buildCliCommand,
    AIProcessItem
} from '../../shortcuts/ai-service';

suite('AI Session Resume', () => {
    suite('SerializedAIProcess Session Fields', () => {
        test('should serialize session resume fields', () => {
            const process: AIProcess & { sdkSessionId?: string; backend?: 'copilot-sdk' | 'copilot-cli' | 'clipboard'; workingDirectory?: string } = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date('2026-01-24T10:00:00Z'),
                endTime: new Date('2026-01-24T10:01:00Z'),
                result: 'Test result',
                sdkSessionId: 'session-123',
                backend: 'copilot-sdk',
                workingDirectory: '/path/to/workspace'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.sdkSessionId, 'session-123');
            assert.strictEqual(serialized.backend, 'copilot-sdk');
            assert.strictEqual(serialized.workingDirectory, '/path/to/workspace');
        });

        test('should deserialize session resume fields', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-2',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: '2026-01-24T10:00:00Z',
                endTime: '2026-01-24T10:01:00Z',
                result: 'Test result',
                sdkSessionId: 'session-456',
                backend: 'copilot-sdk',
                workingDirectory: '/path/to/project'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.sdkSessionId, 'session-456');
            assert.strictEqual(process.backend, 'copilot-sdk');
            assert.strictEqual(process.workingDirectory, '/path/to/project');
        });

        test('should handle missing session resume fields gracefully', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-3',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: '2026-01-24T10:00:00Z'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.sdkSessionId, undefined);
            assert.strictEqual(process.backend, undefined);
            assert.strictEqual(process.workingDirectory, undefined);
        });
    });

    suite('AIProcessManager Session Metadata', () => {
        let processManager: AIProcessManager;

        setup(() => {
            processManager = new AIProcessManager();
        });

        teardown(() => {
            processManager.dispose();
        });

        test('should attach session metadata to a process', () => {
            const processId = processManager.registerProcess('Test prompt');

            processManager.attachSdkSessionId(processId, 'session-789');
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');

            const metadata = processManager.getSessionMetadata(processId);

            assert.strictEqual(metadata?.sdkSessionId, 'session-789');
            assert.strictEqual(metadata?.backend, 'copilot-sdk');
            assert.strictEqual(metadata?.workingDirectory, '/workspace');
        });

        test('should return undefined for non-existent process', () => {
            const metadata = processManager.getSessionMetadata('non-existent');
            assert.strictEqual(metadata, undefined);
        });

        test('should identify resumable processes correctly', () => {
            const processId = processManager.registerProcess('Test prompt');

            // Initially not resumable (running, no session ID)
            assert.strictEqual(processManager.isProcessResumable(processId), false);

            // Add session metadata
            processManager.attachSdkSessionId(processId, 'session-abc');
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');

            // Still not resumable (still running)
            assert.strictEqual(processManager.isProcessResumable(processId), false);

            // Complete the process
            processManager.completeProcess(processId, 'Result');

            // Now resumable
            assert.strictEqual(processManager.isProcessResumable(processId), true);
        });

        test('should not identify CLI processes as resumable', () => {
            const processId = processManager.registerProcess('Test prompt');

            processManager.attachSdkSessionId(processId, 'session-def');
            processManager.attachSessionMetadata(processId, 'copilot-cli', '/workspace');
            processManager.completeProcess(processId, 'Result');

            assert.strictEqual(processManager.isProcessResumable(processId), false);
        });

        test('should not identify failed processes as resumable', () => {
            const processId = processManager.registerProcess('Test prompt');

            processManager.attachSdkSessionId(processId, 'session-ghi');
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');
            processManager.failProcess(processId, 'Error occurred');

            assert.strictEqual(processManager.isProcessResumable(processId), false);
        });

        test('should not identify processes without session ID as resumable', () => {
            const processId = processManager.registerProcess('Test prompt');

            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');
            processManager.completeProcess(processId, 'Result');

            assert.strictEqual(processManager.isProcessResumable(processId), false);
        });
    });

    suite('CLI Command Building with Resume', () => {
        test('should build command with --resume flag', () => {
            const result = buildCliCommand('copilot', {
                resumeSessionId: 'session-xyz'
            });

            assert.ok(result.command.includes('--resume=session-xyz'));
            assert.strictEqual(result.deliveryMethod, 'resume');
        });

        test('should prioritize resume over prompt', () => {
            const result = buildCliCommand('copilot', {
                resumeSessionId: 'session-xyz',
                prompt: 'This should be ignored'
            });

            assert.ok(result.command.includes('--resume=session-xyz'));
            assert.ok(!result.command.includes('This should be ignored'));
            assert.strictEqual(result.deliveryMethod, 'resume');
        });

        test('should include model flag with resume', () => {
            const result = buildCliCommand('copilot', {
                resumeSessionId: 'session-xyz',
                model: 'gpt-4'
            });

            assert.ok(result.command.includes('--resume=session-xyz'));
            assert.ok(result.command.includes('--model gpt-4'));
        });

        test('should work without resume for normal commands', () => {
            const result = buildCliCommand('copilot', {
                prompt: 'Hello world'
            });

            assert.ok(!result.command.includes('--resume'));
            assert.ok(result.command.includes('Hello world') || result.deliveryMethod === 'file');
        });
    });

    suite('AIProcessItem Context Value', () => {
        test('should set resumable context value for resumable processes', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Test result',
                sdkSessionId: 'session-123',
                backend: 'copilot-sdk',
                workingDirectory: '/workspace'
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'clarificationProcess_completed_resumable');
        });

        test('should set regular context value for non-resumable processes', () => {
            const process: AIProcess = {
                id: 'test-2',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Test result'
                // No session metadata
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'clarificationProcess_completed');
        });

        test('should set regular context value for CLI backend processes', () => {
            const process: AIProcess = {
                id: 'test-3',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Test result',
                sdkSessionId: 'session-456',
                backend: 'copilot-cli'
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'clarificationProcess_completed');
        });

        test('should set regular context value for running processes', () => {
            const process: AIProcess = {
                id: 'test-4',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'session-789',
                backend: 'copilot-sdk'
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'clarificationProcess_running');
        });
    });

    suite('Tooltip Content', () => {
        test('should include resume hint for resumable processes', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Test result',
                sdkSessionId: 'session-123',
                backend: 'copilot-sdk',
                workingDirectory: '/workspace'
            };

            const item = new AIProcessItem(process);
            const tooltip = item.tooltip;

            assert.ok(tooltip instanceof Object);
            // The tooltip is a MarkdownString, check its value
            const tooltipValue = (tooltip as { value: string }).value;
            assert.ok(tooltipValue.includes('This session can be resumed'));
        });

        test('should not include resume hint for non-resumable processes', () => {
            const process: AIProcess = {
                id: 'test-2',
                type: 'clarification',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'Test result'
            };

            const item = new AIProcessItem(process);
            const tooltip = item.tooltip;

            assert.ok(tooltip instanceof Object);
            const tooltipValue = (tooltip as { value: string }).value;
            assert.ok(!tooltipValue.includes('This session can be resumed'));
        });
    });
});
