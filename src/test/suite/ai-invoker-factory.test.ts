import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    createAIInvoker,
    AIInvokerFactoryOptions,
    AIInvokerResult
} from '../../shortcuts/ai-service/ai-invoker-factory';
import {
    MockAIProcessManager,
    createMockAIProcessManager
} from '../../shortcuts/ai-service/mock-ai-process-manager';
import {
    getSDKRequestTimeoutSetting,
    getSDKSessionTimeoutSetting,
    getSDKMaxSessionsSetting,
    getSDKLoadMcpConfigSetting,
    getAIBackendSetting
} from '../../shortcuts/ai-service/ai-config-helpers';

/**
 * Tests for AI Invoker Factory
 * 
 * These tests verify the process manager integration in the AI invoker factory.
 * They use mocked backends to avoid actual AI calls.
 */
suite('AI Invoker Factory Tests', () => {
    let mockProcessManager: MockAIProcessManager;

    setup(() => {
        mockProcessManager = createMockAIProcessManager('default');
    });

    teardown(() => {
        mockProcessManager.dispose();
    });

    suite('Process Manager Integration', () => {
        test('should register process when processManager is provided', async () => {
            // Verify initial state
            const initialProcesses = mockProcessManager.getProcesses();
            const initialCount = initialProcesses.length;

            // Create invoker with process manager
            const invoker = createAIInvoker({
                workingDirectory: '/tmp',
                featureName: 'Test Feature',
                processManager: mockProcessManager
            });

            // The invoker doesn't register until called
            // Since we can't actually invoke (no real backend), we test the options type
            assert.ok(invoker, 'Should create invoker');
        });

        test('should accept processManager option in factory options', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Test Feature',
                processManager: mockProcessManager,
                usePool: false,
                clipboardFallback: false,
                approvePermissions: true
            };

            // Verify the type accepts processManager
            assert.ok(options.processManager, 'Should accept processManager option');
            assert.strictEqual(options.processManager, mockProcessManager);
        });

        test('should work without processManager (backward compatibility)', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Test Feature'
                // No processManager - should still work
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker without processManager');
        });

        test('should include feature name in process metadata', () => {
            // Register a process directly to verify metadata structure
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: {
                    type: 'generic',
                    feature: 'Task Creation',
                    backend: 'copilot-sdk',
                    model: 'gpt-4'
                }
            });

            const process = mockProcessManager.getProcess(processId);
            assert.ok(process, 'Process should be registered');
            assert.ok(process?.metadata, 'Process should have metadata');
            
            // Type assertion for metadata access
            const metadata = process?.metadata as { feature?: string; backend?: string; model?: string };
            assert.strictEqual(metadata?.feature, 'Task Creation', 'Should include feature name');
            assert.strictEqual(metadata?.backend, 'copilot-sdk', 'Should include backend');
            assert.strictEqual(metadata?.model, 'gpt-4', 'Should include model');
        });
    });

    suite('Process Lifecycle', () => {
        test('completeProcess should mark process as completed', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.completeProcess(processId, 'Test response');

            const process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'completed', 'Process should be completed');
            assert.strictEqual(process?.result, 'Test response', 'Should store response');
        });

        test('failProcess should mark process as failed', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.failProcess(processId, 'Test error');

            const process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'failed', 'Process should be failed');
            assert.strictEqual(process?.error, 'Test error', 'Should store error message');
        });

        test('process should transition from running to completed', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            // Initially running
            let process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'running', 'Initial status should be running');

            // Complete it
            mockProcessManager.completeProcess(processId, 'Done');

            // Now completed
            process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'completed', 'Final status should be completed');
        });
    });

    suite('Factory Options', () => {
        test('should accept all options together', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/workspace',
                usePool: true,
                model: 'gpt-4',
                timeoutMs: 60000,
                featureName: 'Pipeline Execution',
                clipboardFallback: true,
                approvePermissions: true,
                processManager: mockProcessManager
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker with all options');
        });

        test('should use default values when options not provided', () => {
            // Minimal options
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp'
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker with minimal options');
        });
    });

    suite('Multiple Process Tracking', () => {
        test('should track multiple processes independently', () => {
            // Register multiple processes
            const id1 = mockProcessManager.registerTypedProcess('prompt 1', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Feature A' }
            });
            const id2 = mockProcessManager.registerTypedProcess('prompt 2', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Feature B' }
            });
            const id3 = mockProcessManager.registerTypedProcess('prompt 3', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Feature C' }
            });

            // Complete/fail them in different order
            mockProcessManager.completeProcess(id2, 'Success B');
            mockProcessManager.failProcess(id1, 'Error A');
            mockProcessManager.completeProcess(id3, 'Success C');

            // Verify each process has correct status
            const p1 = mockProcessManager.getProcess(id1);
            const p2 = mockProcessManager.getProcess(id2);
            const p3 = mockProcessManager.getProcess(id3);

            assert.strictEqual(p1?.status, 'failed');
            assert.strictEqual(p2?.status, 'completed');
            assert.strictEqual(p3?.status, 'completed');
        });

        test('should count processes correctly', () => {
            // Register some processes
            const id1 = mockProcessManager.registerTypedProcess('prompt 1', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });
            const id2 = mockProcessManager.registerTypedProcess('prompt 2', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.completeProcess(id1, 'Done');

            const counts = mockProcessManager.getProcessCounts();
            assert.ok(counts.running >= 1, 'Should have at least 1 running');
            assert.ok(counts.completed >= 1, 'Should have at least 1 completed');
        });
    });

    suite('Cancellation Token Support', () => {
        test('should accept cancellationToken option in factory options', () => {
            const tokenSource = new vscode.CancellationTokenSource();
            
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Test Feature',
                processManager: mockProcessManager,
                cancellationToken: tokenSource.token
            };

            // Verify the type accepts cancellationToken
            assert.ok(options.cancellationToken, 'Should accept cancellationToken option');
            assert.strictEqual(options.cancellationToken, tokenSource.token);
            
            tokenSource.dispose();
        });

        test('should create invoker with cancellation token', () => {
            const tokenSource = new vscode.CancellationTokenSource();
            
            const invoker = createAIInvoker({
                workingDirectory: '/tmp',
                featureName: 'Test Feature',
                cancellationToken: tokenSource.token
            });

            assert.ok(invoker, 'Should create invoker with cancellation token');
            
            tokenSource.dispose();
        });

        test('should work without cancellationToken (backward compatibility)', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Test Feature'
                // No cancellationToken - should still work
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker without cancellationToken');
        });

        test('cancellation token should initially not be cancelled', () => {
            const tokenSource = new vscode.CancellationTokenSource();
            
            assert.strictEqual(
                tokenSource.token.isCancellationRequested, 
                false, 
                'Token should not be cancelled initially'
            );
            
            tokenSource.dispose();
        });

        test('cancellation token should report cancelled after cancel()', () => {
            const tokenSource = new vscode.CancellationTokenSource();
            
            tokenSource.cancel();
            
            assert.strictEqual(
                tokenSource.token.isCancellationRequested, 
                true, 
                'Token should be cancelled after cancel()'
            );
            
            tokenSource.dispose();
        });

        test('cancellation callback should be invoked when cancelled', (done) => {
            const tokenSource = new vscode.CancellationTokenSource();
            let callbackInvoked = false;
            
            tokenSource.token.onCancellationRequested(() => {
                callbackInvoked = true;
            });
            
            tokenSource.cancel();
            
            // Give the event loop a chance to process
            setTimeout(() => {
                assert.strictEqual(callbackInvoked, true, 'Cancellation callback should be invoked');
                tokenSource.dispose();
                done();
            }, 10);
        });

        test('cancelProcess should mark process as cancelled', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            const result = mockProcessManager.cancelProcess(processId);

            assert.strictEqual(result, true, 'cancelProcess should return true');
            
            const process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'cancelled', 'Process should be cancelled');
            assert.strictEqual(process?.error, 'Cancelled by user', 'Should have cancellation error message');
        });

        test('cancelProcess should return false for non-existent process', () => {
            const result = mockProcessManager.cancelProcess('non-existent-id');
            assert.strictEqual(result, false, 'Should return false for non-existent process');
        });

        test('cancelProcess should return false for already completed process', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            // Complete the process first
            mockProcessManager.completeProcess(processId, 'Done');

            // Try to cancel it
            const result = mockProcessManager.cancelProcess(processId);
            
            // Should return false since process is not running
            assert.strictEqual(result, false, 'Should return false for completed process');
            
            // Status should still be completed
            const process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'completed', 'Status should remain completed');
        });

        test('should accept all options including cancellationToken', () => {
            const tokenSource = new vscode.CancellationTokenSource();
            
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/workspace',
                usePool: true,
                model: 'gpt-4',
                timeoutMs: 60000,
                featureName: 'Pipeline Execution',
                clipboardFallback: true,
                approvePermissions: true,
                processManager: mockProcessManager,
                cancellationToken: tokenSource.token
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker with all options including cancellationToken');
            
            tokenSource.dispose();
        });

        test('process counts should track cancelled processes', () => {
            // Register and cancel a process
            const id1 = mockProcessManager.registerTypedProcess('prompt 1', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });
            const id2 = mockProcessManager.registerTypedProcess('prompt 2', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.cancelProcess(id1);
            mockProcessManager.completeProcess(id2, 'Done');

            const counts = mockProcessManager.getProcessCounts();
            assert.ok(counts.cancelled >= 1, 'Should have at least 1 cancelled');
            assert.ok(counts.completed >= 1, 'Should have at least 1 completed');
        });

        test('multiple cancellation listeners should all be invoked', (done) => {
            const tokenSource = new vscode.CancellationTokenSource();
            let count = 0;
            
            tokenSource.token.onCancellationRequested(() => { count++; });
            tokenSource.token.onCancellationRequested(() => { count++; });
            tokenSource.token.onCancellationRequested(() => { count++; });
            
            tokenSource.cancel();
            
            setTimeout(() => {
                assert.strictEqual(count, 3, 'All cancellation listeners should be invoked');
                tokenSource.dispose();
                done();
            }, 10);
        });

        test('cancellation listener disposal should prevent callback', (done) => {
            const tokenSource = new vscode.CancellationTokenSource();
            let callbackInvoked = false;

            const disposable = tokenSource.token.onCancellationRequested(() => {
                callbackInvoked = true;
            });

            // Dispose before cancelling
            disposable.dispose();
            tokenSource.cancel();

            setTimeout(() => {
                assert.strictEqual(callbackInvoked, false, 'Disposed callback should not be invoked');
                tokenSource.dispose();
                done();
            }, 10);
        });
    });

    suite('AI Config Helpers', () => {
        test('getSDKRequestTimeoutSetting should return default value', () => {
            const timeout = getSDKRequestTimeoutSetting();
            // Default is 1800000 (30 minutes)
            assert.strictEqual(timeout, 1800000, 'Default request timeout should be 1800000ms (30 minutes)');
        });

        test('getSDKSessionTimeoutSetting should return default value', () => {
            const timeout = getSDKSessionTimeoutSetting();
            // Default is 1800000 (30 minutes)
            assert.strictEqual(timeout, 1800000, 'Default session timeout should be 1800000ms (30 minutes)');
        });

        test('getSDKMaxSessionsSetting should return default value', () => {
            const maxSessions = getSDKMaxSessionsSetting();
            // Default is 5
            assert.strictEqual(maxSessions, 5, 'Default max sessions should be 5');
        });

        test('getSDKLoadMcpConfigSetting should return default value', () => {
            const loadMcpConfig = getSDKLoadMcpConfigSetting();
            // Default is true
            assert.strictEqual(loadMcpConfig, true, 'Default loadMcpConfig should be true');
        });

        test('getAIBackendSetting should return valid backend type', () => {
            const backend = getAIBackendSetting();
            // Should be one of the valid types
            assert.ok(
                backend === 'copilot-sdk' || backend === 'copilot-cli' || backend === 'clipboard',
                `Backend should be one of the valid types, got: ${backend}`
            );
        });

        test('request timeout should be at least 60 seconds', () => {
            const timeout = getSDKRequestTimeoutSetting();
            assert.ok(timeout >= 60000, 'Request timeout should be at least 60 seconds');
        });

        test('request timeout should be at most 1 hour', () => {
            const timeout = getSDKRequestTimeoutSetting();
            assert.ok(timeout <= 3600000, 'Request timeout should be at most 1 hour');
        });
    });

    suite('Request Timeout Integration', () => {
        test('should use default timeout when not specified', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Test Feature'
                // timeoutMs not specified - should use setting default
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker with default timeout');
        });

        test('should accept explicit timeoutMs', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Test Feature',
                timeoutMs: 300000 // 5 minutes
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker with explicit timeout');
        });

        test('should accept long timeoutMs for complex tasks', () => {
            const options: AIInvokerFactoryOptions = {
                workingDirectory: '/tmp',
                featureName: 'Complex Task',
                timeoutMs: 1800000 // 30 minutes
            };

            const invoker = createAIInvoker(options);
            assert.ok(invoker, 'Should create invoker with long timeout');
        });
    });

    suite('Session Resume Metadata Integration', () => {
        test('attachSdkSessionId should store session ID for resume', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.attachSdkSessionId(processId, 'session-123');

            const sessionId = mockProcessManager.getSdkSessionId(processId);
            assert.strictEqual(sessionId, 'session-123', 'Should store and retrieve session ID');
        });

        test('attachSessionMetadata should store backend and working directory', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');

            const metadata = mockProcessManager.getSessionMetadata(processId);
            assert.strictEqual(metadata?.backend, 'copilot-sdk', 'Should store backend');
            assert.strictEqual(metadata?.workingDirectory, '/workspace', 'Should store working directory');
        });

        test('isProcessResumable should return true for SDK process with session ID', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            // Attach session metadata
            mockProcessManager.attachSdkSessionId(processId, 'session-abc');
            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');
            
            // Complete the process
            mockProcessManager.completeProcess(processId, 'Response');

            // Check resumability
            const isResumable = mockProcessManager.isProcessResumable(processId);
            assert.strictEqual(isResumable, true, 'Should be resumable with SDK backend and session ID');
        });

        test('isProcessResumable should return false for CLI process', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            // Attach session metadata with CLI backend
            mockProcessManager.attachSdkSessionId(processId, 'session-def');
            mockProcessManager.attachSessionMetadata(processId, 'copilot-cli', '/workspace');
            
            // Complete the process
            mockProcessManager.completeProcess(processId, 'Response');

            // Check resumability
            const isResumable = mockProcessManager.isProcessResumable(processId);
            assert.strictEqual(isResumable, false, 'Should not be resumable with CLI backend');
        });

        test('isProcessResumable should return false for running process', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            // Attach session metadata but don't complete
            mockProcessManager.attachSdkSessionId(processId, 'session-ghi');
            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');
            // Note: process is still running

            // Check resumability
            const isResumable = mockProcessManager.isProcessResumable(processId);
            assert.strictEqual(isResumable, false, 'Should not be resumable while running');
        });

        test('isProcessResumable should return false without session ID', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            // Attach only backend metadata, not session ID
            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');
            
            // Complete the process
            mockProcessManager.completeProcess(processId, 'Response');

            // Check resumability
            const isResumable = mockProcessManager.isProcessResumable(processId);
            assert.strictEqual(isResumable, false, 'Should not be resumable without session ID');
        });

        test('getSessionMetadata should include sdkSessionId when attached', () => {
            const processId = mockProcessManager.registerTypedProcess('test prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Test' }
            });

            mockProcessManager.attachSdkSessionId(processId, 'session-jkl');
            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');

            const metadata = mockProcessManager.getSessionMetadata(processId);
            assert.strictEqual(metadata?.sdkSessionId, 'session-jkl', 'Should include sdkSessionId');
            assert.strictEqual(metadata?.backend, 'copilot-sdk', 'Should include backend');
            assert.strictEqual(metadata?.workingDirectory, '/test/workspace', 'Should include workingDirectory');
        });

        test('completed generic process should be resumable when session metadata is attached', () => {
            // This test verifies the fix: generic processes should be resumable
            // when they have SDK session ID, backend=copilot-sdk, and status=completed
            const processId = mockProcessManager.registerTypedProcess('test prompt for resume', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Task Creation' }
            });

            // Simulate what ai-invoker-factory.ts should do after successful SDK completion
            mockProcessManager.attachSdkSessionId(processId, 'session-mno');
            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/project/workspace');
            mockProcessManager.completeProcess(processId, 'AI response here');

            // Verify the process is resumable
            const isResumable = mockProcessManager.isProcessResumable(processId);
            assert.strictEqual(isResumable, true, 'Generic process should be resumable after SDK completion');

            // Verify all metadata is accessible
            const metadata = mockProcessManager.getSessionMetadata(processId);
            assert.strictEqual(metadata?.sdkSessionId, 'session-mno');
            assert.strictEqual(metadata?.backend, 'copilot-sdk');
            assert.strictEqual(metadata?.workingDirectory, '/project/workspace');

            // Verify process status
            const process = mockProcessManager.getProcess(processId);
            assert.strictEqual(process?.status, 'completed');
            assert.strictEqual(process?.type, 'generic');
        });

        test('session metadata should be preserved through process completion', () => {
            const processId = mockProcessManager.registerTypedProcess('prompt', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Pipeline' }
            });

            // Attach session metadata before completion
            mockProcessManager.attachSdkSessionId(processId, 'session-pqr');
            mockProcessManager.attachSessionMetadata(processId, 'copilot-sdk', '/workspace');

            // Complete the process
            mockProcessManager.completeProcess(processId, 'Done');

            // Verify metadata is still accessible after completion
            const metadata = mockProcessManager.getSessionMetadata(processId);
            assert.ok(metadata, 'Metadata should be accessible after completion');
            assert.strictEqual(metadata?.sdkSessionId, 'session-pqr');
            assert.strictEqual(metadata?.backend, 'copilot-sdk');
        });

        test('multiple processes should have independent session metadata', () => {
            const processId1 = mockProcessManager.registerTypedProcess('prompt 1', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Feature A' }
            });
            const processId2 = mockProcessManager.registerTypedProcess('prompt 2', {
                type: 'generic',
                metadata: { type: 'generic', feature: 'Feature B' }
            });

            // Attach different session metadata to each
            mockProcessManager.attachSdkSessionId(processId1, 'session-111');
            mockProcessManager.attachSessionMetadata(processId1, 'copilot-sdk', '/workspace/a');
            mockProcessManager.completeProcess(processId1, 'Result A');

            mockProcessManager.attachSdkSessionId(processId2, 'session-222');
            mockProcessManager.attachSessionMetadata(processId2, 'copilot-cli', '/workspace/b');
            mockProcessManager.completeProcess(processId2, 'Result B');

            // Verify each has its own metadata
            const metadata1 = mockProcessManager.getSessionMetadata(processId1);
            const metadata2 = mockProcessManager.getSessionMetadata(processId2);

            assert.strictEqual(metadata1?.sdkSessionId, 'session-111');
            assert.strictEqual(metadata1?.backend, 'copilot-sdk');
            assert.strictEqual(metadata1?.workingDirectory, '/workspace/a');

            assert.strictEqual(metadata2?.sdkSessionId, 'session-222');
            assert.strictEqual(metadata2?.backend, 'copilot-cli');
            assert.strictEqual(metadata2?.workingDirectory, '/workspace/b');

            // Only the first should be resumable (SDK backend)
            assert.strictEqual(mockProcessManager.isProcessResumable(processId1), true);
            assert.strictEqual(mockProcessManager.isProcessResumable(processId2), false);
        });
    });
});
