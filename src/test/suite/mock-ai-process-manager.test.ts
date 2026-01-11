/**
 * Comprehensive tests for MockAIProcessManager
 * 
 * Tests the mock implementation to ensure it behaves correctly
 * and provides all the necessary features for testing other modules.
 */

import * as assert from 'assert';
import { MockAIProcessManager, createMockAIProcessManager } from '../../shortcuts/ai-service/mock-ai-process-manager';
import {
    assertProcessExists,
    assertMethodCalled,
    assertMethodNotCalled,
    assertProcessHasChildren,
    assertProcessCompleted,
    assertProcessFailed,
    assertProcessHasStructuredResult,
    waitForProcessCompletion,
    waitForAllProcesses,
    createManagerWithProcesses,
    assertProcessCounts,
    createCodeReviewScenario,
    simulateCodeReviewFlow
} from '../helpers/mock-ai-helpers';

suite('MockAIProcessManager Tests', () => {

    let manager: MockAIProcessManager;

    setup(() => {
        manager = new MockAIProcessManager();
    });

    teardown(() => {
        manager.dispose();
    });

    suite('Initialization', () => {
        test('should initialize without VSCode context', async () => {
            // Mock doesn't need real context
            await manager.initialize(null as any);
            assert.strictEqual(manager.isInitialized(), true);
        });

        test('should be initialized by default', () => {
            assert.strictEqual(manager.isInitialized(), true);
        });

        test('should not be initialized after disposal', () => {
            manager.dispose();
            assert.strictEqual(manager.isInitialized(), false);
        });
    });

    suite('Process Registration - Generic API', () => {
        test('should register typed process', () => {
            const id = manager.registerTypedProcess(
                'Test prompt',
                {
                    type: 'custom-type',
                    metadata: { type: 'custom-type', customField: 'value' }
                }
            );

            assert.ok(id);
            const process = assertProcessExists(manager, id, 'running');
            assert.strictEqual(process.type, 'custom-type');
            assert.ok(process.metadata);
            assert.strictEqual(process.metadata.customField, 'value');
        });

        test('should register process group', () => {
            const id = manager.registerProcessGroup(
                'Group prompt',
                {
                    type: 'test-group',
                    metadata: { groupField: 'group-value' }
                }
            );

            const process = assertProcessExists(manager, id, 'running');
            assert.strictEqual(process.type, 'test-group');
            assert.ok(process.groupMetadata);
            assert.strictEqual(process.groupMetadata.type, 'test-group');
            assert.deepStrictEqual(process.groupMetadata.childProcessIds, []);
        });

        test('should add child to parent group', () => {
            const groupId = manager.registerProcessGroup(
                'Parent',
                { type: 'group' }
            );

            const childId = manager.registerTypedProcess(
                'Child',
                {
                    type: 'child',
                    parentProcessId: groupId
                }
            );

            const childIds = assertProcessHasChildren(manager, groupId, 1);
            assert.strictEqual(childIds[0], childId);
        });

        test('should support custom ID prefix', () => {
            const id = manager.registerTypedProcess(
                'Test',
                {
                    type: 'custom',
                    idPrefix: 'my-prefix'
                }
            );

            assert.ok(id.startsWith('my-prefix-'));
        });
    });

    suite('Process Registration - Legacy API', () => {
        test('should register clarification process', () => {
            const id = manager.registerProcess('Clarify this code');

            const process = assertProcessExists(manager, id, 'running');
            assert.strictEqual(process.type, 'clarification');
            assert.strictEqual(process.fullPrompt, 'Clarify this code');
        });

        test('should register code review process', () => {
            const id = manager.registerCodeReviewProcess(
                'Review prompt',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    commitMessage: 'Test',
                    rulesUsed: ['rule.md']
                }
            );

            const process = assertProcessExists(manager, id, 'running');
            assert.strictEqual(process.type, 'code-review');
            assert.ok(process.codeReviewMetadata);
            assert.strictEqual(process.codeReviewMetadata.commitSha, 'abc123');
        });

        test('should register code review group', () => {
            const id = manager.registerCodeReviewGroup({
                reviewType: 'pending',
                rulesUsed: ['rule1.md', 'rule2.md']
            });

            const process = assertProcessExists(manager, id, 'running');
            assert.strictEqual(process.type, 'code-review-group');
            assert.ok(process.codeReviewGroupMetadata);
            assert.deepStrictEqual(
                process.codeReviewGroupMetadata.rulesUsed,
                ['rule1.md', 'rule2.md']
            );
        });

        test('should register discovery process', () => {
            const id = manager.registerDiscoveryProcess({
                featureDescription: 'Find authentication code',
                keywords: ['auth', 'login']
            });

            const process = assertProcessExists(manager, id, 'running');
            assert.strictEqual(process.type, 'discovery');
            assert.ok(process.discoveryMetadata);
            assert.strictEqual(
                process.discoveryMetadata.featureDescription,
                'Find authentication code'
            );
        });
    });

    suite('Process Lifecycle', () => {
        test('should complete process', () => {
            const id = manager.registerProcess('Test');
            manager.completeProcess(id, 'Test result');

            const process = assertProcessCompleted(manager, id, 'Test result');
            assert.ok(process.endTime);
        });

        test('should fail process', () => {
            const id = manager.registerProcess('Test');
            manager.failProcess(id, 'Test error');

            const process = assertProcessFailed(manager, id, 'Test error');
            assert.ok(process.endTime);
        });

        test('should cancel running process', () => {
            const id = manager.registerProcess('Test');
            const result = manager.cancelProcess(id);

            assert.strictEqual(result, true);
            const process = assertProcessExists(manager, id, 'cancelled');
            assert.ok(process.error?.includes('Cancelled by user'));
        });

        test('should not cancel non-running process', () => {
            const id = manager.registerProcess('Test');
            manager.completeProcess(id);

            const result = manager.cancelProcess(id);
            assert.strictEqual(result, false);
        });

        test('should update process status', () => {
            const id = manager.registerProcess('Test');
            manager.updateProcess(id, 'completed', 'Updated result', undefined);

            const process = assertProcessCompleted(manager, id, 'Updated result');
            assert.ok(process.endTime);
        });

        test('should update structured result', () => {
            const id = manager.registerProcess('Test');
            manager.completeProcess(id);

            const structuredData = { key: 'value', count: 42 };
            manager.updateProcessStructuredResult(id, JSON.stringify(structuredData));

            const parsed = assertProcessHasStructuredResult(manager, id);
            assert.deepStrictEqual(parsed, structuredData);
        });
    });

    suite('Process Retrieval', () => {
        test('should get all processes', () => {
            manager.registerProcess('Process 1');
            manager.registerProcess('Process 2');
            manager.registerProcess('Process 3');

            const processes = manager.getProcesses();
            assert.strictEqual(processes.length, 3);
        });

        test('should get running processes only', () => {
            const id1 = manager.registerProcess('Running');
            const id2 = manager.registerProcess('Completed');
            manager.completeProcess(id2);

            const running = manager.getRunningProcesses();
            assert.strictEqual(running.length, 1);
            assert.strictEqual(running[0].id, id1);
        });

        test('should check if has running processes', () => {
            assert.strictEqual(manager.hasRunningProcesses(), false);

            const id = manager.registerProcess('Test');
            assert.strictEqual(manager.hasRunningProcesses(), true);

            manager.completeProcess(id);
            assert.strictEqual(manager.hasRunningProcesses(), false);
        });

        test('should get process counts', () => {
            const mgr = createManagerWithProcesses({
                running: 2,
                completed: 3,
                failed: 1,
                cancelled: 1
            });

            assertProcessCounts(mgr, {
                running: 2,
                completed: 3,
                failed: 1,
                cancelled: 1
            });

            mgr.dispose();
        });

        test('should get top-level processes only', () => {
            const groupId = manager.registerProcessGroup('Group', { type: 'group' });
            const childId = manager.registerTypedProcess(
                'Child',
                { type: 'child', parentProcessId: groupId }
            );
            const independentId = manager.registerProcess('Independent');

            const topLevel = manager.getTopLevelProcesses();
            assert.strictEqual(topLevel.length, 2);
            assert.ok(topLevel.find(p => p.id === groupId));
            assert.ok(topLevel.find(p => p.id === independentId));
            assert.ok(!topLevel.find(p => p.id === childId));
        });
    });

    suite('Process Hierarchy', () => {
        test('should get child process IDs', () => {
            const { groupId, childIds } = createCodeReviewScenario(manager);
            
            const retrievedIds = manager.getChildProcessIds(groupId);
            assert.deepStrictEqual(retrievedIds, childIds);
        });

        test('should get child processes', () => {
            const { groupId, childIds } = createCodeReviewScenario(manager);
            
            const children = manager.getChildProcesses(groupId);
            assert.strictEqual(children.length, childIds.length);
            
            childIds.forEach(childId => {
                assert.ok(children.find(c => c.id === childId));
            });
        });

        test('should identify child processes', () => {
            const groupId = manager.registerProcessGroup('Group', { type: 'group' });
            const childId = manager.registerTypedProcess(
                'Child',
                { type: 'child', parentProcessId: groupId }
            );
            const independentId = manager.registerProcess('Independent');

            assert.strictEqual(manager.isChildProcess(childId), true);
            assert.strictEqual(manager.isChildProcess(independentId), false);
            assert.strictEqual(manager.isChildProcess(groupId), false);
        });
    });

    suite('Process Management', () => {
        test('should remove process', () => {
            const id = manager.registerProcess('Test');
            assert.ok(manager.getProcess(id));

            manager.removeProcess(id);
            assert.strictEqual(manager.getProcess(id), undefined);
        });

        test('should clear completed processes', () => {
            const id1 = manager.registerProcess('Running');
            const id2 = manager.registerProcess('Completed');
            manager.completeProcess(id2);

            manager.clearCompletedProcesses();

            assert.ok(manager.getProcess(id1));
            assert.strictEqual(manager.getProcess(id2), undefined);
        });

        test('should clear all processes', () => {
            manager.registerProcess('Process 1');
            manager.registerProcess('Process 2');

            assert.strictEqual(manager.getProcesses().length, 2);

            manager.clearAllProcesses();

            assert.strictEqual(manager.getProcesses().length, 0);
        });
    });

    suite('Mock-Specific Features', () => {
        test('should record method calls', () => {
            manager.registerProcess('Test');
            
            assertMethodCalled(manager, 'registerProcess', 1);
            
            const calls = manager.getCallsForMethod('registerProcess');
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(calls[0].args[0], 'Test');
        });

        test('should record calls for specific process', () => {
            const id = manager.registerProcess('Test');
            manager.completeProcess(id, 'Result');
            manager.updateProcessStructuredResult(id, '{}');

            const calls = manager.getCallsForProcess(id);
            assert.ok(calls.length >= 2);
        });

        test('should clear recorded calls', () => {
            manager.registerProcess('Test');
            assert.ok(manager.getCalls().length > 0);

            manager.clearCalls();
            assert.strictEqual(manager.getCalls().length, 0);
        });

        test('should reset to initial state', () => {
            manager.registerProcess('Test 1');
            manager.registerProcess('Test 2');

            manager.reset();

            assert.strictEqual(manager.getProcesses().length, 0);
            assert.strictEqual(manager.getCalls().length, 0);
        });

        test('should manually complete process for testing', () => {
            const id = manager.registerProcess('Test');
            
            manager.mockCompleteProcess(id, 'Mock result', '{"test": true}');

            const process = assertProcessCompleted(manager, id, 'Mock result');
            assert.strictEqual(process.structuredResult, '{"test": true}');
        });

        test('should manually fail process for testing', () => {
            const id = manager.registerProcess('Test');
            
            manager.mockFailProcess(id, 'Mock error');

            assertProcessFailed(manager, id, 'Mock error');
        });
    });

    suite('Auto-Complete Configuration', () => {
        test('should auto-complete processes when configured', async () => {
            const mgr = createMockAIProcessManager('auto-complete');
            
            const id = mgr.registerProcess('Test');

            // Wait for auto-complete
            await waitForProcessCompletion(mgr, id);

            assertProcessCompleted(mgr, id, 'Mock result');
            mgr.dispose();
        });

        test('should auto-fail processes when configured', async () => {
            const mgr = createMockAIProcessManager('auto-fail');
            
            const id = mgr.registerProcess('Test');

            await waitForProcessCompletion(mgr, id);

            assertProcessFailed(mgr, id, 'Mock error');
            mgr.dispose();
        });

        test('should reconfigure after construction', async () => {
            manager.configure({ autoComplete: true });
            
            const id = manager.registerProcess('Test');
            await waitForProcessCompletion(manager, id);

            assertProcessCompleted(manager, id);
        });
    });

    suite('Async Simulation', () => {
        test('should simulate async behavior with delays', async () => {
            const mgr = createMockAIProcessManager('async');
            mgr.configure({ autoComplete: true });
            
            const startTime = Date.now();
            const id = mgr.registerProcess('Test');
            
            await waitForProcessCompletion(mgr, id, 200);
            const elapsed = Date.now() - startTime;

            // Should have some delay (at least 30ms to account for scheduling)
            assert.ok(elapsed >= 30, `Expected delay >= 30ms, got ${elapsed}ms`);
            
            mgr.dispose();
        });

        test('should wait for all processes to complete', async () => {
            const mgr = createMockAIProcessManager('async');
            mgr.configure({ autoComplete: true });
            
            mgr.registerProcess('Process 1');
            mgr.registerProcess('Process 2');
            mgr.registerProcess('Process 3');

            await waitForAllProcesses(mgr, 500);

            assertProcessCounts(mgr, { running: 0, completed: 3 });
            mgr.dispose();
        });
    });

    suite('Event Emission', () => {
        test('should emit process-added event', (done) => {
            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'process-added') {
                    assert.ok(event.process);
                    assert.strictEqual(event.process.type, 'clarification');
                    disposable.dispose();
                    done();
                }
            });

            manager.registerProcess('Test');
        });

        test('should emit process-updated event', (done) => {
            const id = manager.registerProcess('Test');

            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'process-updated') {
                    assert.ok(event.process);
                    assert.strictEqual(event.process.id, id);
                    assert.strictEqual(event.process.status, 'completed');
                    disposable.dispose();
                    done();
                }
            });

            manager.completeProcess(id);
        });

        test('should emit process-removed event', (done) => {
            const id = manager.registerProcess('Test');

            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'process-removed') {
                    assert.ok(event.process);
                    assert.strictEqual(event.process.id, id);
                    disposable.dispose();
                    done();
                }
            });

            manager.removeProcess(id);
        });

        test('should emit processes-cleared event', (done) => {
            manager.registerProcess('Test 1');
            manager.registerProcess('Test 2');

            const disposable = manager.onDidChangeProcesses((event) => {
                if (event.type === 'processes-cleared') {
                    disposable.dispose();
                    done();
                }
            });

            manager.clearAllProcesses();
        });
    });

    suite('Helper Utilities Integration', () => {
        test('createManagerWithProcesses should create pre-populated manager', () => {
            const mgr = createManagerWithProcesses({
                running: 2,
                completed: 3,
                failed: 1,
                cancelled: 1
            });

            assertProcessCounts(mgr, {
                running: 2,
                completed: 3,
                failed: 1,
                cancelled: 1
            });

            mgr.dispose();
        });

        test('createCodeReviewScenario should create realistic scenario', () => {
            const { groupId, childIds } = createCodeReviewScenario(manager);

            assert.ok(groupId);
            assert.strictEqual(childIds.length, 3);
            assertProcessHasChildren(manager, groupId, 3);
        });

        test('simulateCodeReviewFlow should complete full workflow', () => {
            const { groupId, childIds } = simulateCodeReviewFlow(manager);

            // Check group is completed
            assertProcessCompleted(manager, groupId);

            // Check all children are completed
            childIds.forEach(childId => {
                assertProcessCompleted(manager, childId);
                assertProcessHasStructuredResult(manager, childId);
            });
        });

        test('simulateCodeReviewFlow with failure should handle errors', () => {
            const { groupId, childIds } = simulateCodeReviewFlow(manager, true);

            assertProcessCompleted(manager, groupId);

            // At least one child should have failed
            const failed = childIds.filter(id => {
                const p = manager.getProcess(id);
                return p?.status === 'failed';
            });
            assert.ok(failed.length > 0);
        });
    });

    suite('Edge Cases', () => {
        test('should handle operations on non-existent process', () => {
            assert.strictEqual(manager.getProcess('non-existent'), undefined);
            assert.strictEqual(manager.cancelProcess('non-existent'), false);
            
            // Should not throw
            manager.removeProcess('non-existent');
            manager.completeProcess('non-existent');
            manager.failProcess('non-existent', 'error');
        });

        test('should handle empty prompt', () => {
            const id = manager.registerProcess('');
            const process = assertProcessExists(manager, id);
            assert.strictEqual(process.fullPrompt, '');
        });

        test('should handle very long prompt', () => {
            const longPrompt = 'a'.repeat(10000);
            const id = manager.registerProcess(longPrompt);
            
            const process = assertProcessExists(manager, id);
            assert.strictEqual(process.fullPrompt, longPrompt);
            assert.ok(process.promptPreview.length <= 50);
        });

        test('should handle multiple disposals', () => {
            manager.dispose();
            manager.dispose();
            // Should not throw
        });

        test('should handle operations after disposal', () => {
            manager.dispose();
            
            assert.strictEqual(manager.isInitialized(), false);
            // Other operations should still work (mock doesn't enforce disposal)
        });
    });

    suite('Compatibility with Real AIProcessManager', () => {
        test('should have same public interface', () => {
            // Verify all expected methods exist
            assert.ok(typeof manager.initialize === 'function');
            assert.ok(typeof manager.isInitialized === 'function');
            assert.ok(typeof manager.registerProcess === 'function');
            assert.ok(typeof manager.registerTypedProcess === 'function');
            assert.ok(typeof manager.registerProcessGroup === 'function');
            assert.ok(typeof manager.registerCodeReviewProcess === 'function');
            assert.ok(typeof manager.registerCodeReviewGroup === 'function');
            assert.ok(typeof manager.registerDiscoveryProcess === 'function');
            assert.ok(typeof manager.completeProcess === 'function');
            assert.ok(typeof manager.failProcess === 'function');
            assert.ok(typeof manager.cancelProcess === 'function');
            assert.ok(typeof manager.updateProcess === 'function');
            assert.ok(typeof manager.getProcess === 'function');
            assert.ok(typeof manager.getProcesses === 'function');
            assert.ok(typeof manager.getRunningProcesses === 'function');
            assert.ok(typeof manager.hasRunningProcesses === 'function');
            assert.ok(typeof manager.getProcessCounts === 'function');
            assert.ok(typeof manager.getChildProcessIds === 'function');
            assert.ok(typeof manager.getChildProcesses === 'function');
            assert.ok(typeof manager.isChildProcess === 'function');
            assert.ok(typeof manager.getTopLevelProcesses === 'function');
            assert.ok(typeof manager.dispose === 'function');
        });

        test('should produce same process structure', () => {
            const id = manager.registerCodeReviewProcess(
                'Test',
                {
                    reviewType: 'commit',
                    commitSha: 'abc123',
                    rulesUsed: ['rule.md']
                }
            );

            const process = manager.getProcess(id);
            assert.ok(process);
            
            // Verify structure matches real AIProcess
            assert.ok(process.id);
            assert.ok(process.type);
            assert.ok(process.promptPreview);
            assert.ok(process.fullPrompt);
            assert.ok(process.status);
            assert.ok(process.startTime instanceof Date);
            assert.ok(process.codeReviewMetadata);
        });
    });
});
