/**
 * Unit tests for AI Process 'queued' status support
 * Tests the new 'queued' status for queue-based task systems
 */

import * as assert from 'assert';
import { 
    AIProcessManager, 
    AIProcess, 
    AIProcessStatus, 
    ProcessCounts,
    serializeProcess, 
    deserializeProcess, 
    SerializedAIProcess,
    MockAIProcessManager 
} from '../../shortcuts/ai-service';

/**
 * Mock ExtensionContext for testing persistence
 */
class MockGlobalState {
    private storage: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.storage.set(key, value);
    }

    getStorage(): Map<string, unknown> {
        return this.storage;
    }
}

class MockExtensionContext {
    globalState = new MockGlobalState();
    workspaceState = new MockGlobalState();
}

suite('AI Process Queued Status Tests', () => {

    suite('TypedProcessOptions.initialStatus', () => {

        test('should register process with default running status', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification' }
            );

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'running');
        });

        test('should register process with explicit running status', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'running' }
            );

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'running');
        });

        test('should register process with queued status', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'queued');
        });

        test('should register typed process with queued status and metadata', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Queued task prompt',
                { 
                    type: 'code-review', 
                    initialStatus: 'queued',
                    idPrefix: 'queued-review',
                    metadata: {
                        type: 'code-review',
                        priority: 'high'
                    }
                }
            );

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'queued');
            assert.strictEqual(process.type, 'code-review');
            assert.ok(process.metadata);
            assert.strictEqual(process.metadata.priority, 'high');
        });
    });

    suite('ProcessCounts with queued', () => {

        test('should include queued in process counts', () => {
            const manager = new MockAIProcessManager();

            const counts = manager.getProcessCounts();
            assert.ok('queued' in counts);
            assert.strictEqual(counts.queued, 0);
        });

        test('should count queued processes correctly', () => {
            const manager = new MockAIProcessManager();

            // Register some queued processes
            manager.registerTypedProcess('Queued 1', { type: 'clarification', initialStatus: 'queued' });
            manager.registerTypedProcess('Queued 2', { type: 'clarification', initialStatus: 'queued' });
            manager.registerTypedProcess('Running', { type: 'clarification', initialStatus: 'running' });

            const counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 2);
            assert.strictEqual(counts.running, 1);
        });

        test('should update counts when queued process transitions to running', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            let counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 1);
            assert.strictEqual(counts.running, 0);

            // Transition to running
            manager.updateProcess(processId, 'running');

            counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 0);
            assert.strictEqual(counts.running, 1);
        });

        test('should update counts when queued process completes', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            let counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 1);
            assert.strictEqual(counts.completed, 0);

            // Complete the process
            manager.completeProcess(processId, 'Result');

            counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 0);
            assert.strictEqual(counts.completed, 1);
        });
    });

    suite('Cancel queued processes', () => {

        test('should cancel queued process', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const result = manager.cancelProcess(processId);
            assert.ok(result);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'cancelled');
        });

        test('should not cancel completed process', () => {
            const manager = new MockAIProcessManager();

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );
            manager.completeProcess(processId, 'Done');

            const result = manager.cancelProcess(processId);
            assert.ok(!result);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
        });

        test('should cancel queued child processes when parent is cancelled', () => {
            const manager = new MockAIProcessManager();

            // Create a group with queued children
            const groupId = manager.registerProcessGroup(
                'Test group',
                { type: 'code-review-group' }
            );

            const childId1 = manager.registerTypedProcess(
                'Child 1',
                { type: 'code-review', initialStatus: 'queued', parentProcessId: groupId }
            );

            const childId2 = manager.registerTypedProcess(
                'Child 2',
                { type: 'code-review', initialStatus: 'running', parentProcessId: groupId }
            );

            // Cancel the parent
            manager.cancelProcess(groupId);

            // Both children should be cancelled
            const child1 = manager.getProcess(childId1);
            const child2 = manager.getProcess(childId2);
            assert.ok(child1);
            assert.ok(child2);
            assert.strictEqual(child1.status, 'cancelled');
            assert.strictEqual(child2.status, 'cancelled');
        });
    });

    suite('Clear completed processes (keeps queued)', () => {

        test('should keep queued processes when clearing completed', () => {
            const manager = new MockAIProcessManager();

            // Create various processes
            const queuedId = manager.registerTypedProcess(
                'Queued',
                { type: 'clarification', initialStatus: 'queued' }
            );
            const runningId = manager.registerTypedProcess(
                'Running',
                { type: 'clarification', initialStatus: 'running' }
            );
            const completedId = manager.registerTypedProcess(
                'Completed',
                { type: 'clarification', initialStatus: 'running' }
            );
            manager.completeProcess(completedId, 'Done');

            // Clear completed
            manager.clearCompletedProcesses();

            // Queued and running should remain
            assert.ok(manager.getProcess(queuedId));
            assert.ok(manager.getProcess(runningId));
            assert.ok(!manager.getProcess(completedId));
        });

        test('should keep queued processes when clearing failed/cancelled', () => {
            const manager = new MockAIProcessManager();

            const queuedId = manager.registerTypedProcess(
                'Queued',
                { type: 'clarification', initialStatus: 'queued' }
            );
            const failedId = manager.registerTypedProcess(
                'Failed',
                { type: 'clarification', initialStatus: 'running' }
            );
            manager.failProcess(failedId, 'Error');

            const cancelledId = manager.registerTypedProcess(
                'Cancelled',
                { type: 'clarification', initialStatus: 'running' }
            );
            manager.cancelProcess(cancelledId);

            manager.clearCompletedProcesses();

            // Queued should remain
            assert.ok(manager.getProcess(queuedId));
            assert.ok(!manager.getProcess(failedId));
            assert.ok(!manager.getProcess(cancelledId));
        });
    });

    suite('Persistence excludes queued', () => {

        test('should not persist queued processes', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            // Register a queued process
            manager.registerTypedProcess(
                'Queued process',
                { type: 'clarification', initialStatus: 'queued' }
            );

            // Register and complete another process
            const completedId = manager.registerTypedProcess(
                'Completed process',
                { type: 'clarification', initialStatus: 'running' }
            );
            manager.completeProcess(completedId, 'Done');

            // Check storage
            const stored = context.workspaceState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 1);
            assert.strictEqual(stored[0].status, 'completed');
        });

        test('should not load queued processes from storage', async () => {
            const context = new MockExtensionContext();

            // Pre-populate storage with a queued process (stale)
            const serializedProcesses: SerializedAIProcess[] = [
                {
                    id: 'process-1-1234567890',
                    promptPreview: 'Stale queued',
                    fullPrompt: 'This should not be loaded',
                    status: 'queued',
                    startTime: '2024-01-15T10:30:00.000Z'
                },
                {
                    id: 'process-2-1234567891',
                    promptPreview: 'Completed',
                    fullPrompt: 'This should be loaded',
                    status: 'completed',
                    startTime: '2024-01-15T10:40:00.000Z',
                    endTime: '2024-01-15T10:45:00.000Z'
                }
            ];
            await context.workspaceState.update('aiProcesses.history', serializedProcesses);

            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            const processes = manager.getProcesses();
            assert.strictEqual(processes.length, 1);
            assert.strictEqual(processes[0].status, 'completed');
        });
    });

    suite('Serialization with queued status', () => {

        test('should handle queued status in serialization round-trip', () => {
            const statuses: AIProcessStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];

            for (const status of statuses) {
                const original: AIProcess = {
                    id: `test-${status}`,
                    type: 'clarification',
                    promptPreview: 'Test',
                    fullPrompt: 'Test prompt',
                    status,
                    startTime: new Date(),
                    endTime: status !== 'running' && status !== 'queued' ? new Date() : undefined
                };

                const serialized = serializeProcess(original);
                const restored = deserializeProcess(serialized);

                assert.strictEqual(restored.status, status);
            }
        });
    });

    suite('Queue workflow simulation', () => {

        test('should support full queue workflow: queued -> running -> completed', () => {
            const manager = new MockAIProcessManager();

            // 1. Enqueue - register as queued
            const processId = manager.registerTypedProcess(
                'Task to be queued',
                { type: 'clarification', initialStatus: 'queued' }
            );

            let process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'queued');

            // 2. Execute - transition to running
            manager.updateProcess(processId, 'running');

            process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'running');

            // 3. Complete
            manager.completeProcess(processId, 'Task result');

            process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, 'Task result');
        });

        test('should support queue workflow with cancellation', () => {
            const manager = new MockAIProcessManager();

            // Enqueue
            const processId = manager.registerTypedProcess(
                'Task to be cancelled',
                { type: 'clarification', initialStatus: 'queued' }
            );

            // Cancel before execution
            const cancelled = manager.cancelProcess(processId);
            assert.ok(cancelled);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'cancelled');
        });

        test('should track multiple queued processes', () => {
            const manager = new MockAIProcessManager();

            // Enqueue multiple tasks
            const ids = [];
            for (let i = 0; i < 5; i++) {
                const id = manager.registerTypedProcess(
                    `Task ${i}`,
                    { type: 'clarification', initialStatus: 'queued' }
                );
                ids.push(id);
            }

            // All should be queued
            let counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 5);
            assert.strictEqual(counts.running, 0);

            // Process first two
            manager.updateProcess(ids[0], 'running');
            manager.updateProcess(ids[1], 'running');

            counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 3);
            assert.strictEqual(counts.running, 2);

            // Complete first one
            manager.completeProcess(ids[0], 'Done');

            counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 3);
            assert.strictEqual(counts.running, 1);
            assert.strictEqual(counts.completed, 1);
        });
    });

    suite('Real AIProcessManager queued support', () => {

        test('should register process with queued status', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'queued');
        });

        test('should cancel queued process in real manager', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            const processId = manager.registerTypedProcess(
                'Test prompt',
                { type: 'clarification', initialStatus: 'queued' }
            );

            const result = manager.cancelProcess(processId);
            assert.ok(result);

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'cancelled');
        });

        test('should include queued in process counts from real manager', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as never);

            manager.registerTypedProcess('Queued 1', { type: 'clarification', initialStatus: 'queued' });
            manager.registerTypedProcess('Queued 2', { type: 'clarification', initialStatus: 'queued' });
            manager.registerTypedProcess('Running', { type: 'clarification', initialStatus: 'running' });

            const counts = manager.getProcessCounts();
            assert.strictEqual(counts.queued, 2);
            assert.strictEqual(counts.running, 1);
        });
    });
});
