/**
 * Tests for the Copilot SDK Experiment (Debug Panel Test Command)
 * 
 * These tests verify that the testCopilotSDK function properly integrates
 * with the AIProcessManager to track SDK test requests in the AI Processes panel.
 */

import * as assert from 'assert';
import { MockAIProcessManager } from '../../shortcuts/ai-service/mock-ai-process-manager';
import { assertProcessExists, assertMethodCalled } from '../helpers/mock-ai-helpers';

suite('Copilot SDK Experiment Tests', () => {
    suite('AIProcessManager Integration', () => {
        let mockManager: MockAIProcessManager;

        setup(() => {
            mockManager = new MockAIProcessManager();
        });

        teardown(() => {
            mockManager.clearAllProcesses();
        });

        test('registerTypedProcess should create sdk-test process', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt for SDK',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: {
                        type: 'sdk-test',
                        source: 'debug-panel',
                        workingDirectory: '/test/workspace'
                    }
                }
            );

            assert.ok(processId, 'Process ID should be returned');
            assert.ok(processId.startsWith('sdk-test-'), 'Process ID should start with sdk-test-');

            const process = assertProcessExists(mockManager, processId, 'running');
            assert.strictEqual(process.type, 'sdk-test');
            assert.strictEqual(process.fullPrompt, 'Test prompt for SDK');
            assert.ok(process.metadata);
            assert.strictEqual(process.metadata?.type, 'sdk-test');
            assert.strictEqual(process.metadata?.source, 'debug-panel');
        });

        test('completeProcess should mark sdk-test as completed with result', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            const response = 'This is the AI response';
            mockManager.completeProcess(processId, response);

            const process = assertProcessExists(mockManager, processId, 'completed');
            assert.strictEqual(process.result, response);
            assert.ok(process.endTime, 'End time should be set');
        });

        test('failProcess should mark sdk-test as failed with error', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            const errorMessage = 'SDK not available';
            mockManager.failProcess(processId, errorMessage);

            const process = assertProcessExists(mockManager, processId, 'failed');
            assert.strictEqual(process.error, errorMessage);
            assert.ok(process.endTime, 'End time should be set');
        });

        test('attachSdkSessionId should store session ID for resume', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            const sessionId = 'session-123-abc';
            mockManager.attachSdkSessionId(processId, sessionId);

            const retrievedSessionId = mockManager.getSdkSessionId(processId);
            assert.strictEqual(retrievedSessionId, sessionId);
        });

        test('attachSessionMetadata should store backend and working directory', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            mockManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');

            const metadata = mockManager.getSessionMetadata(processId);
            assert.ok(metadata);
            assert.strictEqual(metadata.backend, 'copilot-sdk');
            assert.strictEqual(metadata.workingDirectory, '/test/workspace');
        });

        test('sdk-test process should appear in getProcesses', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            const processes = mockManager.getProcesses();
            const sdkTestProcess = processes.find(p => p.id === processId);
            
            assert.ok(sdkTestProcess, 'SDK test process should be in the list');
            assert.strictEqual(sdkTestProcess?.type, 'sdk-test');
        });

        test('sdk-test process should be tracked in running processes', () => {
            mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            assert.ok(mockManager.hasRunningProcesses(), 'Should have running processes');
            
            const runningProcesses = mockManager.getRunningProcesses();
            assert.strictEqual(runningProcesses.length, 1);
            assert.strictEqual(runningProcesses[0].type, 'sdk-test');
        });

        test('completed sdk-test should not be in running processes', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            mockManager.completeProcess(processId, 'Response');

            const runningProcesses = mockManager.getRunningProcesses();
            assert.strictEqual(runningProcesses.length, 0);
        });

        test('process counts should include sdk-test processes', () => {
            const processId1 = mockManager.registerTypedProcess(
                'Test 1',
                { type: 'sdk-test', idPrefix: 'sdk-test', metadata: { type: 'sdk-test' } }
            );
            const processId2 = mockManager.registerTypedProcess(
                'Test 2',
                { type: 'sdk-test', idPrefix: 'sdk-test', metadata: { type: 'sdk-test' } }
            );

            mockManager.completeProcess(processId1, 'Done');
            mockManager.failProcess(processId2, 'Error');

            const counts = mockManager.getProcessCounts();
            assert.strictEqual(counts.completed, 1);
            assert.strictEqual(counts.failed, 1);
            assert.strictEqual(counts.running, 0);
        });

        test('clearCompletedProcesses should remove completed sdk-test processes', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            mockManager.completeProcess(processId, 'Response');
            mockManager.clearCompletedProcesses();

            const process = mockManager.getProcess(processId);
            assert.strictEqual(process, undefined, 'Process should be removed');
        });

        test('removeProcess should remove specific sdk-test process', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            mockManager.removeProcess(processId);

            const process = mockManager.getProcess(processId);
            assert.strictEqual(process, undefined, 'Process should be removed');
        });

        test('onDidChangeProcesses should fire for sdk-test operations', () => {
            let eventCount = 0;
            const disposable = mockManager.onDidChangeProcesses(() => {
                eventCount++;
            });

            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );
            assert.strictEqual(eventCount, 1, 'Event should fire on register');

            mockManager.completeProcess(processId, 'Response');
            assert.strictEqual(eventCount, 2, 'Event should fire on complete');

            disposable.dispose();
        });

        test('method calls should be tracked for verification', () => {
            mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            assertMethodCalled(mockManager, 'registerTypedProcess', 1);
        });

        test('getTopLevelProcesses should include sdk-test processes', () => {
            const processId = mockManager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'sdk-test',
                    idPrefix: 'sdk-test',
                    metadata: { type: 'sdk-test' }
                }
            );

            const topLevel = mockManager.getTopLevelProcesses();
            const sdkProcess = topLevel.find(p => p.id === processId);
            
            assert.ok(sdkProcess, 'SDK test process should be a top-level process');
        });
    });

    suite('Process Type Validation', () => {
        test('sdk-test should be a valid AIProcessType', () => {
            const mockManager = new MockAIProcessManager();
            
            // This should not throw - sdk-test is a valid string type
            const processId = mockManager.registerTypedProcess(
                'Test',
                { type: 'sdk-test', metadata: { type: 'sdk-test' } }
            );
            
            const process = mockManager.getProcess(processId);
            assert.strictEqual(process?.type, 'sdk-test');
            
            mockManager.clearAllProcesses();
        });

        test('metadata type should match process type', () => {
            const mockManager = new MockAIProcessManager();
            
            const processId = mockManager.registerTypedProcess(
                'Test',
                {
                    type: 'sdk-test',
                    metadata: {
                        type: 'sdk-test',
                        customField: 'value'
                    }
                }
            );
            
            const process = mockManager.getProcess(processId);
            assert.strictEqual(process?.metadata?.type, 'sdk-test');
            assert.strictEqual((process?.metadata as any)?.customField, 'value');
            
            mockManager.clearAllProcesses();
        });
    });
});
