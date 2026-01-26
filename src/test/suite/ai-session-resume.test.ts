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
    AIProcessItem
} from '../../shortcuts/ai-service';
import { buildCliCommand } from '@plusplusoneplusplus/pipeline-core';

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

        // ========================================================================
        // Regression tests for bug: getProcesses/getProcess not including session fields
        // ========================================================================

        test('getProcesses should include session resume fields (regression)', () => {
            // This test prevents regression of the bug where getProcesses() 
            // was not including sdkSessionId, backend, and workingDirectory fields
            const processId = processManager.registerProcess('Test prompt');

            // Attach session metadata
            processManager.attachSdkSessionId(processId, 'session-regression-test');
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
            processManager.completeProcess(processId, 'Result');

            // Get all processes and find our process
            const processes = processManager.getProcesses();
            const process = processes.find(p => p.id === processId);

            assert.ok(process, 'Process should be found in getProcesses()');
            assert.strictEqual(process.sdkSessionId, 'session-regression-test', 
                'getProcesses() must include sdkSessionId field');
            assert.strictEqual(process.backend, 'copilot-sdk', 
                'getProcesses() must include backend field');
            assert.strictEqual(process.workingDirectory, '/test/workspace', 
                'getProcesses() must include workingDirectory field');
        });

        test('getProcess should include session resume fields (regression)', () => {
            // This test prevents regression of the bug where getProcess() 
            // was not including sdkSessionId, backend, and workingDirectory fields
            const processId = processManager.registerProcess('Test prompt');

            // Attach session metadata
            processManager.attachSdkSessionId(processId, 'session-get-single');
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/single/workspace');
            processManager.completeProcess(processId, 'Result');

            // Get single process by ID
            const process = processManager.getProcess(processId);

            assert.ok(process, 'Process should be found by getProcess()');
            assert.strictEqual(process.sdkSessionId, 'session-get-single', 
                'getProcess() must include sdkSessionId field');
            assert.strictEqual(process.backend, 'copilot-sdk', 
                'getProcess() must include backend field');
            assert.strictEqual(process.workingDirectory, '/single/workspace', 
                'getProcess() must include workingDirectory field');
        });

        test('AIProcessItem should receive session fields from getProcesses (integration)', () => {
            // Integration test: ensures the full flow works - 
            // getProcesses() returns session fields, which AIProcessItem uses for context value
            const processId = processManager.registerProcess('Test prompt');

            processManager.attachSdkSessionId(processId, 'session-integration');
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/integration/workspace');
            processManager.completeProcess(processId, 'Result');

            // Simulate what the tree provider does: get processes and create tree items
            const processes = processManager.getProcesses();
            const process = processes.find(p => p.id === processId);

            assert.ok(process, 'Process should be found');

            // Create AIProcessItem with the process from getProcesses()
            const item = new AIProcessItem(process);

            // The context value should be resumable because session fields are present
            assert.strictEqual(item.contextValue, 'clarificationProcess_completed_resumable',
                'AIProcessItem should detect resumable status from getProcesses() data');
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

        // ========================================================================
        // Regression test: ensure resume-only command doesn't include prompt
        // This prevents the bug where both a normal session AND resume session were launched
        // ========================================================================

        test('resume command should not include any prompt-related content (regression)', () => {
            // When resuming, we should ONLY have the --resume flag, not any prompt
            // This ensures only one terminal is needed (the resume one)
            const result = buildCliCommand('copilot', {
                resumeSessionId: 'session-abc-123'
            });

            // Should have resume flag
            assert.ok(result.command.includes('--resume=session-abc-123'), 
                'Resume command must include --resume flag');
            
            // Should NOT have prompt-related flags or content
            assert.ok(!result.command.includes('-p '), 
                'Resume command should not include -p flag');
            assert.ok(!result.command.includes('--prompt'), 
                'Resume command should not include --prompt flag');
            
            // Delivery method should be 'resume', not 'direct' or 'file'
            assert.strictEqual(result.deliveryMethod, 'resume',
                'Resume should use "resume" delivery method, not "direct" or "file"');
        });

        test('resume command should be a single complete command (regression)', () => {
            // Ensure the resume command is self-contained and doesn't require
            // additional commands or sessions to be started
            const result = buildCliCommand('copilot', {
                resumeSessionId: 'session-single-command'
            });

            // The command should start with 'copilot' (the tool)
            assert.ok(result.command.startsWith('copilot'), 
                'Resume command should start with the tool name');
            
            // Should be a single command (no && or ; separators for additional commands)
            assert.ok(!result.command.includes(' && '), 
                'Resume command should not chain additional commands');
            
            // No temp file should be created for resume
            assert.strictEqual(result.tempFilePath, undefined,
                'Resume should not create temp files');
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

    suite('Pipeline Item Session Resume', () => {
        test('should set resumable context value for resumable pipeline items', () => {
            const process: AIProcess = {
                id: 'pipeline-item-1',
                type: 'pipeline-item',
                promptPreview: 'Process item 1/5',
                fullPrompt: 'Process the bug report',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: '{"severity": "high"}',
                sdkSessionId: 'session-pipeline-123',
                backend: 'copilot-sdk',
                workingDirectory: '/workspace'
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'pipelineItemProcess_completed_resumable');
        });

        test('should set resumable context value for resumable pipeline item children', () => {
            const process: AIProcess = {
                id: 'pipeline-item-2',
                type: 'pipeline-item',
                promptPreview: 'Process item 2/5',
                fullPrompt: 'Process the bug report',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: '{"severity": "low"}',
                sdkSessionId: 'session-pipeline-456',
                backend: 'copilot-sdk',
                workingDirectory: '/workspace',
                parentProcessId: 'pipeline-group-1'
            };

            // Create as child (isChild = true)
            const item = new AIProcessItem(process, true);

            assert.strictEqual(item.contextValue, 'pipelineItemProcess_completed_child_resumable');
        });

        test('should set regular context value for non-resumable pipeline items', () => {
            const process: AIProcess = {
                id: 'pipeline-item-3',
                type: 'pipeline-item',
                promptPreview: 'Process item 3/5',
                fullPrompt: 'Process the bug report',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: '{"severity": "medium"}'
                // No session metadata
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'pipelineItemProcess_completed');
        });

        test('should set regular context value for pipeline items with CLI backend', () => {
            const process: AIProcess = {
                id: 'pipeline-item-4',
                type: 'pipeline-item',
                promptPreview: 'Process item 4/5',
                fullPrompt: 'Process the bug report',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: '{"severity": "critical"}',
                sdkSessionId: 'session-pipeline-789',
                backend: 'copilot-cli' // CLI backend, not resumable
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'pipelineItemProcess_completed');
        });

        test('should set regular context value for running pipeline items', () => {
            const process: AIProcess = {
                id: 'pipeline-item-5',
                type: 'pipeline-item',
                promptPreview: 'Process item 5/5',
                fullPrompt: 'Process the bug report',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'session-pipeline-running',
                backend: 'copilot-sdk'
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'pipelineItemProcess_running');
        });

        test('should set regular context value for failed pipeline items', () => {
            const process: AIProcess = {
                id: 'pipeline-item-6',
                type: 'pipeline-item',
                promptPreview: 'Process item',
                fullPrompt: 'Process the bug report',
                status: 'failed',
                startTime: new Date(),
                endTime: new Date(),
                error: 'AI service timeout',
                sdkSessionId: 'session-pipeline-failed',
                backend: 'copilot-sdk'
            };

            const item = new AIProcessItem(process);

            assert.strictEqual(item.contextValue, 'pipelineItemProcess_failed');
        });

        test('should include resume hint in tooltip for resumable pipeline items', () => {
            const process: AIProcess = {
                id: 'pipeline-item-tooltip',
                type: 'pipeline-item',
                promptPreview: 'Process item',
                fullPrompt: 'Process the bug report',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: '{"severity": "high"}',
                sdkSessionId: 'session-pipeline-tooltip',
                backend: 'copilot-sdk',
                workingDirectory: '/workspace'
            };

            const item = new AIProcessItem(process);
            const tooltip = item.tooltip;

            assert.ok(tooltip instanceof Object);
            const tooltipValue = (tooltip as { value: string }).value;
            assert.ok(tooltipValue.includes('This session can be resumed'),
                'Pipeline item tooltip should include resume hint');
        });

        test('should not include resume hint in tooltip for non-resumable pipeline items', () => {
            const process: AIProcess = {
                id: 'pipeline-item-no-resume',
                type: 'pipeline-item',
                promptPreview: 'Process item',
                fullPrompt: 'Process the bug report',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: '{"severity": "low"}'
                // No session metadata
            };

            const item = new AIProcessItem(process);
            const tooltip = item.tooltip;

            assert.ok(tooltip instanceof Object);
            const tooltipValue = (tooltip as { value: string }).value;
            assert.ok(!tooltipValue.includes('This session can be resumed'),
                'Pipeline item tooltip should not include resume hint when not resumable');
        });
    });
});
