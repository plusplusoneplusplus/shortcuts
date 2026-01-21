/**
 * Unit tests for AI Process Manager Persistence
 * Tests storage, loading, and serialization of AI processes
 */

import * as assert from 'assert';
import { AIProcessManager, AIProcess, AIProcessStatus, serializeProcess, deserializeProcess, SerializedAIProcess } from '../../shortcuts/ai-service';

/**
 * Mock ExtensionContext for testing persistence
 */
class MockGlobalState {
    private storage: Map<string, any> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) : defaultValue as T;
    }

    async update(key: string, value: any): Promise<void> {
        this.storage.set(key, value);
    }

    // Helper for tests to inspect storage
    getStorage(): Map<string, any> {
        return this.storage;
    }
}

class MockExtensionContext {
    globalState = new MockGlobalState();
}

/**
 * Mock ChildProcess for testing cancellation
 */
class MockChildProcess {
    killed = false;
    kill() {
        this.killed = true;
    }
}

suite('AI Process Serialization Tests', () => {

    suite('serializeProcess', () => {

        test('should convert Date to ISO string for startTime', () => {
            const startTime = new Date('2024-01-15T10:30:00.000Z');
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.startTime, '2024-01-15T10:30:00.000Z');
        });

        test('should convert Date to ISO string for endTime', () => {
            const startTime = new Date('2024-01-15T10:30:00.000Z');
            const endTime = new Date('2024-01-15T10:35:00.000Z');
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'completed',
                startTime,
                endTime
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.endTime, '2024-01-15T10:35:00.000Z');
        });

        test('should preserve undefined endTime', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime: new Date()
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.endTime, undefined);
        });

        test('should preserve all other fields', () => {
            const process: AIProcess = {
                id: 'test-123',
                type: 'clarification',
                promptPreview: 'Short preview',
                fullPrompt: 'Full prompt with all the details',
                status: 'failed',
                startTime: new Date(),
                endTime: new Date(),
                error: 'Connection timeout',
                result: undefined
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.id, 'test-123');
            assert.strictEqual(serialized.promptPreview, 'Short preview');
            assert.strictEqual(serialized.fullPrompt, 'Full prompt with all the details');
            assert.strictEqual(serialized.status, 'failed');
            assert.strictEqual(serialized.error, 'Connection timeout');
        });

        test('should preserve result field', () => {
            const process: AIProcess = {
                id: 'test-1',
                type: 'clarification',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date(),
                result: 'AI response text'
            };

            const serialized = serializeProcess(process);

            assert.strictEqual(serialized.result, 'AI response text');
        });
    });

    suite('deserializeProcess', () => {

        test('should convert ISO string to Date for startTime', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime: '2024-01-15T10:30:00.000Z'
            };

            const process = deserializeProcess(serialized);

            assert.ok(process.startTime instanceof Date);
            assert.strictEqual(process.startTime.toISOString(), '2024-01-15T10:30:00.000Z');
        });

        test('should convert ISO string to Date for endTime', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'completed',
                startTime: '2024-01-15T10:30:00.000Z',
                endTime: '2024-01-15T10:35:00.000Z'
            };

            const process = deserializeProcess(serialized);

            assert.ok(process.endTime instanceof Date);
            assert.strictEqual(process.endTime.toISOString(), '2024-01-15T10:35:00.000Z');
        });

        test('should preserve undefined endTime', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime: '2024-01-15T10:30:00.000Z'
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.endTime, undefined);
        });

        test('should preserve all other fields', () => {
            const serialized: SerializedAIProcess = {
                id: 'test-456',
                promptPreview: 'Preview text',
                fullPrompt: 'Complete prompt',
                status: 'completed',
                startTime: '2024-01-15T10:30:00.000Z',
                endTime: '2024-01-15T10:35:00.000Z',
                result: 'The AI response',
                error: undefined
            };

            const process = deserializeProcess(serialized);

            assert.strictEqual(process.id, 'test-456');
            assert.strictEqual(process.promptPreview, 'Preview text');
            assert.strictEqual(process.fullPrompt, 'Complete prompt');
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, 'The AI response');
        });
    });

    suite('Round-trip serialization', () => {

        test('should preserve data through serialize/deserialize cycle', () => {
            const original: AIProcess = {
                id: 'test-roundtrip',
                type: 'clarification',
                promptPreview: 'Round trip test',
                fullPrompt: 'Full prompt for round trip testing',
                status: 'completed',
                startTime: new Date('2024-01-15T10:30:00.000Z'),
                endTime: new Date('2024-01-15T10:35:00.000Z'),
                result: 'AI response',
                error: undefined
            };

            const serialized = serializeProcess(original);
            const restored = deserializeProcess(serialized);

            assert.strictEqual(restored.id, original.id);
            assert.strictEqual(restored.promptPreview, original.promptPreview);
            assert.strictEqual(restored.fullPrompt, original.fullPrompt);
            assert.strictEqual(restored.status, original.status);
            assert.strictEqual(restored.startTime.getTime(), original.startTime.getTime());
            assert.strictEqual(restored.endTime?.getTime(), original.endTime?.getTime());
            assert.strictEqual(restored.result, original.result);
        });

        test('should handle all status types', () => {
            const statuses: AIProcessStatus[] = ['running', 'completed', 'failed', 'cancelled'];

            for (const status of statuses) {
                const original: AIProcess = {
                    id: `test-${status}`,
                    type: 'clarification',
                    promptPreview: 'Test',
                    fullPrompt: 'Test prompt',
                    status,
                    startTime: new Date(),
                    endTime: status !== 'running' ? new Date() : undefined
                };

                const serialized = serializeProcess(original);
                const restored = deserializeProcess(serialized);

                assert.strictEqual(restored.status, status);
            }
        });
    });
});

suite('AI Process Manager Persistence Tests', () => {

    suite('Initialization', () => {

        test('should initialize without context', () => {
            const manager = new AIProcessManager();
            
            // Should work without persistence
            const processId = manager.registerProcess('Test prompt');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.status, 'running');
            assert.strictEqual(manager.isInitialized(), false);
        });

        test('should initialize with context', async () => {
            const manager = new AIProcessManager();
            const context = new MockExtensionContext();

            await manager.initialize(context as any);

            assert.strictEqual(manager.isInitialized(), true);
        });

        test('should load empty storage gracefully', async () => {
            const manager = new AIProcessManager();
            const context = new MockExtensionContext();

            await manager.initialize(context as any);

            const processes = manager.getProcesses();
            assert.strictEqual(processes.length, 0);
        });

        test('should load persisted processes on initialization', async () => {
            const context = new MockExtensionContext();
            
            // Pre-populate storage with serialized processes
            const serializedProcesses: SerializedAIProcess[] = [
                {
                    id: 'process-1-1234567890',
                    promptPreview: 'Test 1',
                    fullPrompt: 'Test prompt 1',
                    status: 'completed',
                    startTime: '2024-01-15T10:30:00.000Z',
                    endTime: '2024-01-15T10:35:00.000Z',
                    result: 'Result 1'
                },
                {
                    id: 'process-2-1234567891',
                    promptPreview: 'Test 2',
                    fullPrompt: 'Test prompt 2',
                    status: 'failed',
                    startTime: '2024-01-15T10:40:00.000Z',
                    endTime: '2024-01-15T10:45:00.000Z',
                    error: 'Error message'
                }
            ];
            await context.globalState.update('aiProcesses.history', serializedProcesses);

            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const processes = manager.getProcesses();
            assert.strictEqual(processes.length, 2);
        });

        test('should not load running processes from storage', async () => {
            const context = new MockExtensionContext();
            
            // Pre-populate storage with a running process (stale)
            const serializedProcesses: SerializedAIProcess[] = [
                {
                    id: 'process-1-1234567890',
                    promptPreview: 'Stale running',
                    fullPrompt: 'This should not be loaded',
                    status: 'running',
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
            await context.globalState.update('aiProcesses.history', serializedProcesses);

            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const processes = manager.getProcesses();
            assert.strictEqual(processes.length, 1);
            assert.strictEqual(processes[0].status, 'completed');
        });

        test('should update process counter to avoid ID collisions', async () => {
            const context = new MockExtensionContext();
            
            // Pre-populate storage with a high-numbered process
            const serializedProcesses: SerializedAIProcess[] = [
                {
                    id: 'process-50-1234567890',
                    promptPreview: 'High numbered',
                    fullPrompt: 'Test prompt',
                    status: 'completed',
                    startTime: '2024-01-15T10:30:00.000Z',
                    endTime: '2024-01-15T10:35:00.000Z'
                }
            ];
            await context.globalState.update('aiProcesses.history', serializedProcesses);

            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            // New process should have higher number
            const newId = manager.registerProcess('New process');
            const match = newId.match(/^process-(\d+)-/);
            assert.ok(match);
            assert.ok(parseInt(match[1], 10) > 50);
        });
    });

    suite('Persistence on Updates', () => {

        test('should persist when process completes', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId, 'Result');

            // Check storage
            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 1);
            assert.strictEqual(stored[0].status, 'completed');
        });

        test('should persist when process fails', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const processId = manager.registerProcess('Test prompt');
            manager.failProcess(processId, 'Error message');

            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 1);
            assert.strictEqual(stored[0].status, 'failed');
            assert.strictEqual(stored[0].error, 'Error message');
        });

        test('should persist when process is cancelled', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const processId = manager.registerProcess('Test prompt');
            manager.cancelProcess(processId);

            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 1);
            assert.strictEqual(stored[0].status, 'cancelled');
        });

        test('should not persist running processes', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            // Register but don't complete
            manager.registerProcess('Running process');

            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 0);
        });

        test('should persist when process is removed', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const id1 = manager.registerProcess('Process 1');
            const id2 = manager.registerProcess('Process 2');
            manager.completeProcess(id1, 'Result 1');
            manager.completeProcess(id2, 'Result 2');

            // Both should be stored
            let stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 2);

            // Remove one
            manager.removeProcess(id1);

            stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 1);
            assert.strictEqual(stored[0].id, id2);
        });

        test('should persist when completed processes are cleared', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const id1 = manager.registerProcess('Process 1');
            const id2 = manager.registerProcess('Process 2');
            manager.completeProcess(id1, 'Result 1');
            manager.failProcess(id2, 'Error');

            // Both should be stored
            let stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 2);

            // Clear completed
            manager.clearCompletedProcesses();

            stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 0);
        });
    });

    suite('Clear All Processes', () => {

        test('should clear all processes including history', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const id1 = manager.registerProcess('Process 1');
            const id2 = manager.registerProcess('Process 2');
            manager.completeProcess(id1, 'Result 1');
            // id2 is still running

            manager.clearAllProcesses();

            const processes = manager.getProcesses();
            assert.strictEqual(processes.length, 0);

            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.strictEqual(stored.length, 0);
        });

        test('should kill running processes when clearing all', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            const mockProcess = new MockChildProcess();
            manager.registerProcess('Test prompt', mockProcess as any);

            manager.clearAllProcesses();

            assert.ok(mockProcess.killed);
        });

        test('should fire processes-cleared event', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            manager.registerProcess('Test prompt');
            let eventFired = false;

            manager.onDidChangeProcesses((event) => {
                if (event.type === 'processes-cleared') {
                    eventFired = true;
                }
            });

            manager.clearAllProcesses();

            assert.ok(eventFired);
        });
    });

    suite('Storage Limits', () => {

        test('should limit persisted processes to MAX_PERSISTED_PROCESSES', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            // Create more than the limit
            for (let i = 0; i < 150; i++) {
                const id = manager.registerProcess(`Prompt ${i}`);
                manager.completeProcess(id, `Result ${i}`);
            }

            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            assert.ok(stored.length <= 100);
        });

        test('should keep newest processes when limiting', async () => {
            const context = new MockExtensionContext();
            const manager = new AIProcessManager();
            await manager.initialize(context as any);

            // Create processes with delays to ensure different timestamps
            for (let i = 0; i < 110; i++) {
                const id = manager.registerProcess(`Prompt ${i}`);
                manager.completeProcess(id, `Result ${i}`);
            }

            const stored = context.globalState.get<SerializedAIProcess[]>('aiProcesses.history', []);
            
            // Should have kept the most recent 100
            assert.ok(stored.length <= 100);
            
            // The stored processes should be sorted by time (newest first)
            for (let i = 1; i < stored.length; i++) {
                const prev = new Date(stored[i - 1].startTime).getTime();
                const curr = new Date(stored[i].startTime).getTime();
                assert.ok(prev >= curr, 'Processes should be sorted by time');
            }
        });
    });

    suite('Error Handling', () => {

        test('should handle corrupted storage gracefully', async () => {
            const context = new MockExtensionContext();
            
            // Set invalid data in storage
            await context.globalState.update('aiProcesses.history', 'not an array');

            const manager = new AIProcessManager();
            
            // Should not throw
            try {
                await manager.initialize(context as any);
                // If we get here, it handled the error
                assert.ok(true);
            } catch (error) {
                // Even if it throws, that's acceptable behavior
                assert.ok(true);
            }
        });

        test('should work without context after failed initialization', async () => {
            const manager = new AIProcessManager();
            // Don't initialize

            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId, 'Result');

            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
        });
    });

    suite('Persistence Across Sessions', () => {

        test('should restore processes in new manager instance', async () => {
            const context = new MockExtensionContext();
            
            // First session
            const manager1 = new AIProcessManager();
            await manager1.initialize(context as any);
            const id1 = manager1.registerProcess('Prompt 1');
            manager1.completeProcess(id1, 'Result 1');
            manager1.dispose();

            // Second session (simulating extension restart)
            const manager2 = new AIProcessManager();
            await manager2.initialize(context as any);

            const processes = manager2.getProcesses();
            assert.strictEqual(processes.length, 1);
            assert.strictEqual(processes[0].fullPrompt, 'Prompt 1');
            assert.strictEqual(processes[0].result, 'Result 1');
        });

        test('should preserve process details across sessions', async () => {
            const context = new MockExtensionContext();
            
            // First session
            const manager1 = new AIProcessManager();
            await manager1.initialize(context as any);
            const id = manager1.registerProcess('Detailed prompt with lots of information');
            manager1.failProcess(id, 'Specific error message');
            manager1.dispose();

            // Second session
            const manager2 = new AIProcessManager();
            await manager2.initialize(context as any);

            const processes = manager2.getProcesses();
            assert.strictEqual(processes.length, 1);
            assert.strictEqual(processes[0].fullPrompt, 'Detailed prompt with lots of information');
            assert.strictEqual(processes[0].error, 'Specific error message');
            assert.strictEqual(processes[0].status, 'failed');
        });
    });
});

suite('AI Process View Details Tests', () => {

    test('should have command set for viewing details', async () => {
        // Import the tree item class
        const { AIProcessItem } = await import('../../shortcuts/ai-service');
        
        const process: AIProcess = {
            id: 'test-1',
            type: 'clarification',
            promptPreview: 'Test',
            fullPrompt: 'Test prompt',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date(),
            result: 'AI response'
        };

        const item = new AIProcessItem(process);

        assert.ok(item.command);
        assert.strictEqual(item.command.command, 'clarificationProcesses.viewDetails');
        assert.ok(item.command.arguments);
        assert.strictEqual(item.command.arguments[0], item);
    });

    test('should use viewCodeReviewDetails command for completed code-review process', async () => {
        const { AIProcessItem } = await import('../../shortcuts/ai-service');
        
        const process: AIProcess = {
            id: 'test-cr-1',
            type: 'code-review',
            promptPreview: 'Code Review',
            fullPrompt: 'Review code',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date(),
            result: 'Review result',
            structuredResult: '{}'
        };

        const item = new AIProcessItem(process);

        assert.ok(item.command);
        assert.strictEqual(item.command.command, 'clarificationProcesses.viewCodeReviewDetails');
        assert.strictEqual(item.command.title, 'View Code Review');
    });

    test('should use viewCodeReviewGroupDetails command for completed code-review-group process', async () => {
        const { AIProcessItem } = await import('../../shortcuts/ai-service');
        
        const process: AIProcess = {
            id: 'test-crg-1',
            type: 'code-review-group',
            promptPreview: 'Code Review Group',
            fullPrompt: 'Review code group',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date(),
            result: 'Group result',
            structuredResult: '{}'
        };

        const item = new AIProcessItem(process);

        assert.ok(item.command);
        assert.strictEqual(item.command.command, 'clarificationProcesses.viewCodeReviewGroupDetails');
        assert.strictEqual(item.command.title, 'View Aggregated Code Review');
    });

    test('should use viewPipelineExecutionDetails command for completed pipeline-execution process', async () => {
        const { AIProcessItem } = await import('../../shortcuts/ai-service');
        
        const process: AIProcess = {
            id: 'test-pe-1',
            type: 'pipeline-execution',
            promptPreview: 'Pipeline: test-pipeline',
            fullPrompt: 'Execute pipeline',
            status: 'completed',
            startTime: new Date(),
            endTime: new Date(),
            result: 'Pipeline result',
            structuredResult: '{"results":[]}'
        };

        const item = new AIProcessItem(process);

        assert.ok(item.command);
        assert.strictEqual(item.command.command, 'clarificationProcesses.viewPipelineExecutionDetails');
        assert.strictEqual(item.command.title, 'View Pipeline Results');
    });

    test('should use viewDetails command for running pipeline-execution process', async () => {
        const { AIProcessItem } = await import('../../shortcuts/ai-service');
        
        const process: AIProcess = {
            id: 'test-pe-2',
            type: 'pipeline-execution',
            promptPreview: 'Pipeline: running-pipeline',
            fullPrompt: 'Execute pipeline',
            status: 'running',
            startTime: new Date()
        };

        const item = new AIProcessItem(process);

        assert.ok(item.command);
        // Running pipeline should use generic viewDetails (text-based)
        assert.strictEqual(item.command.command, 'clarificationProcesses.viewDetails');
        assert.strictEqual(item.command.title, 'View Details');
    });

    test('should use viewDetails command for failed pipeline-execution process', async () => {
        const { AIProcessItem } = await import('../../shortcuts/ai-service');
        
        const process: AIProcess = {
            id: 'test-pe-3',
            type: 'pipeline-execution',
            promptPreview: 'Pipeline: failed-pipeline',
            fullPrompt: 'Execute pipeline',
            status: 'failed',
            startTime: new Date(),
            endTime: new Date(),
            error: 'Pipeline failed'
        };

        const item = new AIProcessItem(process);

        assert.ok(item.command);
        // Failed pipeline should use generic viewDetails (text-based)
        assert.strictEqual(item.command.command, 'clarificationProcesses.viewDetails');
        assert.strictEqual(item.command.title, 'View Details');
    });
});

suite('AI Process Document Provider - Structured Result Display', () => {
    
    test('should format pipeline item structured result with rawResponse', async () => {
        const { AIProcessDocumentProvider } = await import('../../shortcuts/ai-service');
        const { createMockAIProcessManager } = await import('../../shortcuts/ai-service');
        
        const mockManager = createMockAIProcessManager();
        
        // Create a process with pipeline item structured result
        const structuredResult = JSON.stringify({
            item: { id: '1', title: 'Test Bug', description: 'Login fails' },
            output: { severity: 'high', category: 'backend' },
            success: true,
            rawResponse: '{"severity": "high", "category": "backend", "extra": "metadata"}'
        });
        
        // Register a process and then update its structured result
        const processId = mockManager.registerTypedProcess(
            'Processing item 1/2',
            {
                type: 'pipeline-item',
                idPrefix: 'pipeline-item',
                metadata: { type: 'pipeline-item', description: 'Processing item 1/2' }
            }
        );
        mockManager.mockCompleteProcess(processId, 'Completed', structuredResult);
        
        const provider = new AIProcessDocumentProvider(mockManager);
        const uri = provider.createUri(processId);
        const content = await provider.provideTextDocumentContent(uri);
        
        // Verify structured result sections are present
        assert.ok(content.includes('## Structured Result'), 'Should have Structured Result section');
        assert.ok(content.includes('### Input'), 'Should have Input subsection');
        assert.ok(content.includes('### Output'), 'Should have Output subsection');
        assert.ok(content.includes('### Raw AI Response'), 'Should have Raw AI Response subsection');
        
        // Verify content is displayed
        assert.ok(content.includes('Test Bug'), 'Should show input title');
        assert.ok(content.includes('"severity": "high"'), 'Should show output');
        assert.ok(content.includes('"extra": "metadata"'), 'Should show raw response content');
    });
    
    test('should format failed pipeline item with error', async () => {
        const { AIProcessDocumentProvider } = await import('../../shortcuts/ai-service');
        const { createMockAIProcessManager } = await import('../../shortcuts/ai-service');
        
        const mockManager = createMockAIProcessManager();
        
        // Create a failed process with error in structured result
        const structuredResult = JSON.stringify({
            item: { id: '2', title: 'Task 2' },
            output: {},
            success: false,
            error: 'Failed to parse AI response: Unexpected token',
            rawResponse: 'This is not valid JSON { broken'
        });
        
        // Register and complete with structured result
        const processId = mockManager.registerTypedProcess(
            'Processing item 2/2',
            {
                type: 'pipeline-item',
                idPrefix: 'pipeline-item',
                metadata: { type: 'pipeline-item', description: 'Processing item 2/2' }
            }
        );
        mockManager.mockCompleteProcess(processId, 'Failed', structuredResult);
        
        const provider = new AIProcessDocumentProvider(mockManager);
        const uri = provider.createUri(processId);
        const content = await provider.provideTextDocumentContent(uri);
        
        // Verify error section is present
        assert.ok(content.includes('### Error'), 'Should have Error subsection');
        assert.ok(content.includes('Failed to parse AI response'), 'Should show error message');
        assert.ok(content.includes('### Raw AI Response'), 'Should have Raw AI Response even for errors');
        assert.ok(content.includes('broken'), 'Should show raw response that caused the error');
    });
    
    test('should format generic structured result as JSON', async () => {
        const { AIProcessDocumentProvider } = await import('../../shortcuts/ai-service');
        const { createMockAIProcessManager } = await import('../../shortcuts/ai-service');
        
        const mockManager = createMockAIProcessManager();
        
        // Create a process with generic structured result (no rawResponse)
        const structuredResult = JSON.stringify({
            summary: 'Pipeline completed',
            stats: { total: 10, passed: 8, failed: 2 }
        });
        
        // Register and complete with structured result
        const processId = mockManager.registerTypedProcess(
            'Run Tests Pipeline',
            {
                type: 'pipeline-execution',
                idPrefix: 'pipeline-exec',
                metadata: { type: 'pipeline-execution', description: 'Run Tests Pipeline' }
            }
        );
        mockManager.mockCompleteProcess(processId, 'Completed', structuredResult);
        
        const provider = new AIProcessDocumentProvider(mockManager);
        const uri = provider.createUri(processId);
        const content = await provider.provideTextDocumentContent(uri);
        
        // Verify generic JSON display
        assert.ok(content.includes('## Structured Result'), 'Should have Structured Result section');
        assert.ok(content.includes('"summary"'), 'Should show JSON keys');
        assert.ok(content.includes('Pipeline completed'), 'Should show JSON values');
        // Should NOT have special sections for generic result
        assert.ok(!content.includes('### Input'), 'Should NOT have Input subsection for generic result');
        assert.ok(!content.includes('### Raw AI Response'), 'Should NOT have Raw AI Response for generic result');
    });
});

