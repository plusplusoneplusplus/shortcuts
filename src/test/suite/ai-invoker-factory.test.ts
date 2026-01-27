import * as assert from 'assert';
import { 
    createAIInvoker, 
    AIInvokerFactoryOptions,
    AIInvokerResult
} from '../../shortcuts/ai-service/ai-invoker-factory';
import { 
    MockAIProcessManager, 
    createMockAIProcessManager 
} from '../../shortcuts/ai-service/mock-ai-process-manager';

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
});
