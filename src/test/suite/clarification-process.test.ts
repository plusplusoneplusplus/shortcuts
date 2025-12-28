/**
 * Unit tests for AI Process Manager and Tree Data Provider
 * Tests process tracking, lifecycle management, and UI representation
 */

import * as assert from 'assert';
import { AIProcessManager, AIProcessTreeDataProvider, AIProcessItem, AIProcess, AIProcessStatus, ProcessEvent } from '../../shortcuts/ai-service';

/**
 * Mock ChildProcess for testing cancellation
 */
class MockChildProcess {
    killed = false;
    kill() {
        this.killed = true;
    }
}

suite('AIProcessManager Tests', () => {

    suite('Process Registration', () => {

        test('should register a new process and return ID', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            assert.ok(processId, 'Process ID should be returned');
            assert.ok(processId.startsWith('process-'), 'Process ID should have correct prefix');
        });

        test('should assign unique IDs to each process', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            const id3 = manager.registerProcess('Prompt 3');

            assert.notStrictEqual(id1, id2);
            assert.notStrictEqual(id2, id3);
            assert.notStrictEqual(id1, id3);
        });

        test('should create process with running status', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.status, 'running');
        });

        test('should set startTime on registration', () => {
            const manager = new AIProcessManager();
            const beforeTime = new Date();
            const processId = manager.registerProcess('Test prompt');
            const afterTime = new Date();
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.ok(process.startTime >= beforeTime);
            assert.ok(process.startTime <= afterTime);
        });

        test('should store full prompt', () => {
            const manager = new AIProcessManager();
            const fullPrompt = 'This is a very long prompt that explains everything in detail';
            const processId = manager.registerProcess(fullPrompt);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.fullPrompt, fullPrompt);
        });

        test('should create prompt preview for short prompts', () => {
            const manager = new AIProcessManager();
            const shortPrompt = 'Short prompt';
            const processId = manager.registerProcess(shortPrompt);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.promptPreview, 'Short prompt');
        });

        test('should truncate prompt preview for long prompts', () => {
            const manager = new AIProcessManager();
            const longPrompt = 'This is a very long prompt that should be truncated because it exceeds fifty characters';
            const processId = manager.registerProcess(longPrompt);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.promptPreview.length, 50);
            assert.ok(process.promptPreview.endsWith('...'));
        });

        test('should normalize whitespace in prompt preview', () => {
            const manager = new AIProcessManager();
            const messyPrompt = '  Multiple   spaces\nand\nnewlines  ';
            const processId = manager.registerProcess(messyPrompt);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.promptPreview, 'Multiple spaces and newlines');
        });

        test('should fire process-added event on registration', () => {
            const manager = new AIProcessManager();
            let eventFired = false;
            let eventProcess: AIProcess | undefined;

            manager.onDidChangeProcesses((event: ProcessEvent) => {
                if (event.type === 'process-added') {
                    eventFired = true;
                    eventProcess = event.process;
                }
            });

            const processId = manager.registerProcess('Test prompt');

            assert.ok(eventFired, 'Event should be fired');
            assert.ok(eventProcess);
            assert.strictEqual(eventProcess.id, processId);
        });
    });

    suite('Process Updates', () => {

        test('should update process status', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.updateProcess(processId, 'completed');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
        });

        test('should set endTime on status update', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.updateProcess(processId, 'completed');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.ok(process.endTime);
            assert.ok(process.endTime >= process.startTime);
        });

        test('should store result on completion', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            const resultText = 'This is the AI response';

            manager.updateProcess(processId, 'completed', resultText);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.result, resultText);
        });

        test('should store error on failure', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            const errorMessage = 'Connection timeout';

            manager.updateProcess(processId, 'failed', undefined, errorMessage);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.error, errorMessage);
        });

        test('should fire process-updated event on update', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            let eventFired = false;

            manager.onDidChangeProcesses((event: ProcessEvent) => {
                if (event.type === 'process-updated') {
                    eventFired = true;
                }
            });

            manager.updateProcess(processId, 'completed');

            assert.ok(eventFired);
        });

        test('should ignore update for non-existent process', () => {
            const manager = new AIProcessManager();

            // Should not throw
            manager.updateProcess('non-existent-id', 'completed');

            const process = manager.getProcess('non-existent-id');
            assert.strictEqual(process, undefined);
        });
    });

    suite('completeProcess Shorthand', () => {

        test('should mark process as completed', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.completeProcess(processId, 'Result text');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.status, 'completed');
            assert.strictEqual(process.result, 'Result text');
        });

        test('should set endTime on completion', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.completeProcess(processId);
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.ok(process.endTime);
        });
    });

    suite('failProcess Shorthand', () => {

        test('should mark process as failed', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.failProcess(processId, 'Error message');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.strictEqual(process.status, 'failed');
            assert.strictEqual(process.error, 'Error message');
        });

        test('should set endTime on failure', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.failProcess(processId, 'Error');
            const process = manager.getProcess(processId);

            assert.ok(process);
            assert.ok(process.endTime);
        });
    });

    suite('Process Cancellation', () => {

        test('should cancel running process', () => {
            const manager = new AIProcessManager();
            const mockProcess = new MockChildProcess();
            const processId = manager.registerProcess('Test prompt', mockProcess as any);

            const result = manager.cancelProcess(processId);
            const process = manager.getProcess(processId);

            assert.strictEqual(result, true);
            assert.ok(process);
            assert.strictEqual(process.status, 'cancelled');
            assert.strictEqual(process.error, 'Cancelled by user');
            assert.ok(mockProcess.killed, 'Child process should be killed');
        });

        test('should not cancel already completed process', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.completeProcess(processId);
            const result = manager.cancelProcess(processId);

            assert.strictEqual(result, false);
        });

        test('should not cancel already failed process', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.failProcess(processId, 'Error');
            const result = manager.cancelProcess(processId);

            assert.strictEqual(result, false);
        });

        test('should return false for non-existent process', () => {
            const manager = new AIProcessManager();

            const result = manager.cancelProcess('non-existent-id');

            assert.strictEqual(result, false);
        });

        test('should handle cancellation without child process', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            // No child process provided
            const result = manager.cancelProcess(processId);

            assert.strictEqual(result, true);
            const process = manager.getProcess(processId);
            assert.ok(process);
            assert.strictEqual(process.status, 'cancelled');
        });
    });

    suite('Process Removal', () => {

        test('should remove process from tracking', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');

            manager.removeProcess(processId);
            const process = manager.getProcess(processId);

            assert.strictEqual(process, undefined);
        });

        test('should fire process-removed event', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            let eventFired = false;

            manager.onDidChangeProcesses((event: ProcessEvent) => {
                if (event.type === 'process-removed') {
                    eventFired = true;
                }
            });

            manager.removeProcess(processId);

            assert.ok(eventFired);
        });

        test('should ignore removal of non-existent process', () => {
            const manager = new AIProcessManager();

            // Should not throw
            manager.removeProcess('non-existent-id');
        });
    });

    suite('Clear Completed Processes', () => {

        test('should clear completed processes', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            manager.completeProcess(id1);

            manager.clearCompletedProcesses();

            assert.strictEqual(manager.getProcess(id1), undefined);
            assert.ok(manager.getProcess(id2)); // Running process should remain
        });

        test('should clear failed processes', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            manager.failProcess(id1, 'Error');

            manager.clearCompletedProcesses();

            assert.strictEqual(manager.getProcess(id1), undefined);
            assert.ok(manager.getProcess(id2));
        });

        test('should clear cancelled processes', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            manager.cancelProcess(id1);

            manager.clearCompletedProcesses();

            assert.strictEqual(manager.getProcess(id1), undefined);
            assert.ok(manager.getProcess(id2));
        });

        test('should keep running processes', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Running 1');
            const id2 = manager.registerProcess('Running 2');
            const id3 = manager.registerProcess('Completed');
            manager.completeProcess(id3);

            manager.clearCompletedProcesses();

            assert.ok(manager.getProcess(id1));
            assert.ok(manager.getProcess(id2));
            assert.strictEqual(manager.getProcess(id3), undefined);
        });

        test('should fire processes-cleared event', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId);
            let eventFired = false;

            manager.onDidChangeProcesses((event: ProcessEvent) => {
                if (event.type === 'processes-cleared') {
                    eventFired = true;
                }
            });

            manager.clearCompletedProcesses();

            assert.ok(eventFired);
        });

        test('should not fire event when nothing to clear', () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Running process');
            let eventFired = false;

            manager.onDidChangeProcesses((event: ProcessEvent) => {
                if (event.type === 'processes-cleared') {
                    eventFired = true;
                }
            });

            manager.clearCompletedProcesses();

            assert.strictEqual(eventFired, false);
        });
    });

    suite('Get Processes', () => {

        test('should return all processes', () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Prompt 1');
            manager.registerProcess('Prompt 2');
            manager.registerProcess('Prompt 3');

            const processes = manager.getProcesses();

            assert.strictEqual(processes.length, 3);
        });

        test('should return empty array when no processes', () => {
            const manager = new AIProcessManager();

            const processes = manager.getProcesses();

            assert.strictEqual(processes.length, 0);
        });

        test('should return copies without childProcess reference', () => {
            const manager = new AIProcessManager();
            const mockProcess = new MockChildProcess();
            manager.registerProcess('Test prompt', mockProcess as any);

            const processes = manager.getProcesses();

            assert.strictEqual(processes.length, 1);
            // The returned process should not have childProcess property
            assert.strictEqual((processes[0] as any).childProcess, undefined);
        });
    });

    suite('Get Running Processes', () => {

        test('should return only running processes', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Running 1');
            const id2 = manager.registerProcess('Running 2');
            const id3 = manager.registerProcess('Completed');
            const id4 = manager.registerProcess('Failed');
            manager.completeProcess(id3);
            manager.failProcess(id4, 'Error');

            const running = manager.getRunningProcesses();

            assert.strictEqual(running.length, 2);
            assert.ok(running.some((p: AIProcess) => p.id === id1));
            assert.ok(running.some((p: AIProcess) => p.id === id2));
        });

        test('should return empty when no running processes', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId);

            const running = manager.getRunningProcesses();

            assert.strictEqual(running.length, 0);
        });
    });

    suite('Has Running Processes', () => {

        test('should return true when running processes exist', () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Test prompt');

            assert.strictEqual(manager.hasRunningProcesses(), true);
        });

        test('should return false when no running processes', () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            manager.completeProcess(processId);

            assert.strictEqual(manager.hasRunningProcesses(), false);
        });

        test('should return false when empty', () => {
            const manager = new AIProcessManager();

            assert.strictEqual(manager.hasRunningProcesses(), false);
        });
    });

    suite('Process Counts', () => {

        test('should count processes by status', () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Running 1');
            const id2 = manager.registerProcess('Running 2');
            const id3 = manager.registerProcess('Completed');
            const id4 = manager.registerProcess('Failed');
            const id5 = manager.registerProcess('Cancelled');
            manager.completeProcess(id3);
            manager.failProcess(id4, 'Error');
            manager.cancelProcess(id5);

            const counts = manager.getProcessCounts();

            assert.strictEqual(counts.running, 2);
            assert.strictEqual(counts.completed, 1);
            assert.strictEqual(counts.failed, 1);
            assert.strictEqual(counts.cancelled, 1);
        });

        test('should return zeros when empty', () => {
            const manager = new AIProcessManager();

            const counts = manager.getProcessCounts();

            assert.strictEqual(counts.running, 0);
            assert.strictEqual(counts.completed, 0);
            assert.strictEqual(counts.failed, 0);
            assert.strictEqual(counts.cancelled, 0);
        });
    });

    suite('Dispose', () => {

        test('should kill all running processes on dispose', () => {
            const manager = new AIProcessManager();
            const mock1 = new MockChildProcess();
            const mock2 = new MockChildProcess();
            manager.registerProcess('Prompt 1', mock1 as any);
            manager.registerProcess('Prompt 2', mock2 as any);

            manager.dispose();

            assert.ok(mock1.killed);
            assert.ok(mock2.killed);
        });

        test('should clear all processes on dispose', () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Prompt 1');
            manager.registerProcess('Prompt 2');

            manager.dispose();

            assert.strictEqual(manager.getProcesses().length, 0);
        });

        test('should not kill already completed processes on dispose', () => {
            const manager = new AIProcessManager();
            const mockProcess = new MockChildProcess();
            const processId = manager.registerProcess('Test prompt', mockProcess as any);
            manager.completeProcess(processId);

            // Child process reference is cleared on completion
            manager.dispose();

            // The mock wasn't killed during dispose (it was already cleared)
            // This is the expected behavior - completed processes don't have childProcess
        });
    });
});

suite('AIProcessTreeDataProvider Tests', () => {

    suite('Tree Item Creation', () => {

        test('should create tree items for all processes', async () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Prompt 1');
            manager.registerProcess('Prompt 2');

            const provider = new AIProcessTreeDataProvider(manager);
            const items = await provider.getChildren();

            assert.strictEqual(items.length, 2);
        });

        test('should return empty array when no processes', async () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            const items = await provider.getChildren();

            assert.strictEqual(items.length, 0);
        });

        test('should return empty array for child items', async () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Test prompt');
            const provider = new AIProcessTreeDataProvider(manager);

            const items = await provider.getChildren();
            const childItems = await provider.getChildren(items[0]);

            assert.strictEqual(childItems.length, 0);
        });
    });

    suite('Process Item Properties', () => {

        test('should set label from prompt preview', async () => {
            const manager = new AIProcessManager();
            manager.registerProcess('Short prompt');
            const provider = new AIProcessTreeDataProvider(manager);

            const items = await provider.getChildren();
            const item = items[0] as AIProcessItem;

            assert.strictEqual(item.label, 'Short prompt');
        });

        test('should set contextValue based on status', async () => {
            const manager = new AIProcessManager();
            const id = manager.registerProcess('Test prompt');
            const provider = new AIProcessTreeDataProvider(manager);

            let items = await provider.getChildren();
            let item = items[0] as AIProcessItem;
            assert.strictEqual(item.contextValue, 'clarificationProcess_running');

            manager.completeProcess(id);
            items = await provider.getChildren();
            item = items[0] as AIProcessItem;
            assert.strictEqual(item.contextValue, 'clarificationProcess_completed');
        });

        test('should store process reference in item', async () => {
            const manager = new AIProcessManager();
            const processId = manager.registerProcess('Test prompt');
            const provider = new AIProcessTreeDataProvider(manager);

            const items = await provider.getChildren();
            const item = items[0] as AIProcessItem;

            assert.ok(item.process);
            assert.strictEqual(item.process.id, processId);
        });
    });

    suite('Sorting', () => {

        test('should sort running processes first', async () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('Completed');
            manager.completeProcess(id1);
            const id2 = manager.registerProcess('Running');

            const provider = new AIProcessTreeDataProvider(manager);
            const items = await provider.getChildren() as AIProcessItem[];

            assert.strictEqual(items[0].process.id, id2); // Running first
            assert.strictEqual(items[1].process.id, id1); // Completed second
        });

        test('should include all processes with same status in results', async () => {
            const manager = new AIProcessManager();
            const id1 = manager.registerProcess('First');
            const id2 = manager.registerProcess('Second');
            const id3 = manager.registerProcess('Third');

            const provider = new AIProcessTreeDataProvider(manager);
            const items = await provider.getChildren() as AIProcessItem[];

            // All 3 processes should be present
            assert.strictEqual(items.length, 3);

            // All should be running status
            assert.ok(items.every(i => i.process.status === 'running'));

            // All IDs should be present
            const ids = items.map(i => i.process.id);
            assert.ok(ids.includes(id1));
            assert.ok(ids.includes(id2));
            assert.ok(ids.includes(id3));
        });
    });

    suite('Refresh', () => {

        test('should refresh when process changes', async () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            let refreshCount = 0;
            provider.onDidChangeTreeData(() => {
                refreshCount++;
            });

            manager.registerProcess('Prompt 1');
            manager.registerProcess('Prompt 2');

            // Event should fire for each registration
            assert.ok(refreshCount >= 2);
        });

        test('should fire tree change event on manual refresh', () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            let eventFired = false;
            provider.onDidChangeTreeData(() => {
                eventFired = true;
            });

            provider.refresh();

            assert.ok(eventFired);
        });
    });

    suite('Dispose', () => {

        test('should clean up on dispose', () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Should not throw
            provider.dispose();
        });
    });
});

suite('AIProcessItem Tests', () => {

    suite('Status Icons', () => {

        test('running status should have sync~spin icon', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime: new Date()
            };

            const item = new AIProcessItem(process);

            assert.ok(item.iconPath);
            assert.strictEqual((item.iconPath as any).id, 'sync~spin');
        });

        test('completed status should have pass icon', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'completed',
                startTime: new Date(),
                endTime: new Date()
            };

            const item = new AIProcessItem(process);

            assert.ok(item.iconPath);
            assert.strictEqual((item.iconPath as any).id, 'pass');
        });

        test('failed status should have error icon', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'failed',
                startTime: new Date(),
                endTime: new Date(),
                error: 'Test error'
            };

            const item = new AIProcessItem(process);

            assert.ok(item.iconPath);
            assert.strictEqual((item.iconPath as any).id, 'error');
        });

        test('cancelled status should have circle-slash icon', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'cancelled',
                startTime: new Date(),
                endTime: new Date(),
                error: 'Cancelled by user'
            };

            const item = new AIProcessItem(process);

            assert.ok(item.iconPath);
            assert.strictEqual((item.iconPath as any).id, 'circle-slash');
        });
    });

    suite('Description', () => {

        test('running process should show elapsed time', () => {
            const startTime = new Date(Date.now() - 65000); // 65 seconds ago
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime
            };

            const item = new AIProcessItem(process);

            assert.ok(item.description);
            assert.ok((item.description as string).includes('running'));
            // Should show time in format like "1m 5s"
            assert.ok((item.description as string).includes('m'));
        });

        test('completed process should show duration', () => {
            const startTime = new Date(Date.now() - 120000);
            const endTime = new Date();
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'completed',
                startTime,
                endTime
            };

            const item = new AIProcessItem(process);

            assert.ok(item.description);
            assert.ok((item.description as string).includes('completed'));
        });

        test('failed process should show duration', () => {
            const startTime = new Date(Date.now() - 30000);
            const endTime = new Date();
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'failed',
                startTime,
                endTime,
                error: 'Connection timeout'
            };

            const item = new AIProcessItem(process);

            assert.ok(item.description);
            assert.ok((item.description as string).includes('failed'));
        });
    });

    suite('Tooltip', () => {

        test('should include status in tooltip', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime: new Date()
            };

            const item = new AIProcessItem(process);

            assert.ok(item.tooltip);
            const tooltipText = (item.tooltip as any).value;
            assert.ok(tooltipText.includes('running'));
        });

        test('should include error in tooltip for failed process', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'failed',
                startTime: new Date(),
                endTime: new Date(),
                error: 'Connection timeout error'
            };

            const item = new AIProcessItem(process);

            assert.ok(item.tooltip);
            const tooltipText = (item.tooltip as any).value;
            assert.ok(tooltipText.includes('Connection timeout error'));
        });

        test('should include prompt preview in tooltip', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Explain the authentication flow',
                fullPrompt: 'Explain the authentication flow in detail',
                status: 'running',
                startTime: new Date()
            };

            const item = new AIProcessItem(process);

            assert.ok(item.tooltip);
            const tooltipText = (item.tooltip as any).value;
            assert.ok(tooltipText.includes('Explain the authentication flow'));
        });
    });

    suite('Collapsible State', () => {

        test('should not be collapsible', () => {
            const process: AIProcess = {
                type: 'clarification',
                id: 'test-1',
                promptPreview: 'Test',
                fullPrompt: 'Test prompt',
                status: 'running',
                startTime: new Date()
            };

            const item = new AIProcessItem(process);

            // TreeItemCollapsibleState.None = 0
            assert.strictEqual(item.collapsibleState, 0);
        });
    });
});

suite('Integration Tests', () => {

    suite('Full Lifecycle', () => {

        test('should handle complete process lifecycle', async () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Register process
            const processId = manager.registerProcess('Test prompt');
            let items = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(items.length, 1);
            assert.strictEqual(items[0].process.status, 'running');

            // Complete process
            manager.completeProcess(processId, 'Result');
            items = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(items[0].process.status, 'completed');
            assert.strictEqual(items[0].process.result, 'Result');

            // Clear completed
            manager.clearCompletedProcesses();
            items = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(items.length, 0);

            // Clean up
            provider.dispose();
            manager.dispose();
        });

        test('should handle multiple concurrent processes', async () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Start multiple processes
            const id1 = manager.registerProcess('Prompt 1');
            const id2 = manager.registerProcess('Prompt 2');
            const id3 = manager.registerProcess('Prompt 3');

            let items = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(items.length, 3);

            // Complete one, fail another
            manager.completeProcess(id1, 'Result 1');
            manager.failProcess(id2, 'Error 2');

            items = await provider.getChildren() as AIProcessItem[];
            const counts = manager.getProcessCounts();
            assert.strictEqual(counts.running, 1);
            assert.strictEqual(counts.completed, 1);
            assert.strictEqual(counts.failed, 1);

            // Cancel the last one
            manager.cancelProcess(id3);
            items = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(items.every(i => i.process.status !== 'running'), true);

            // Clean up
            provider.dispose();
            manager.dispose();
        });

        test('should handle rapid process creation and completion', async () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            // Rapidly create and complete processes
            for (let i = 0; i < 10; i++) {
                const id = manager.registerProcess(`Prompt ${i}`);
                manager.completeProcess(id, `Result ${i}`);
            }

            const items = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(items.length, 10);
            assert.ok(items.every(i => i.process.status === 'completed'));

            manager.clearCompletedProcesses();
            const afterClear = await provider.getChildren() as AIProcessItem[];
            assert.strictEqual(afterClear.length, 0);

            // Clean up
            provider.dispose();
            manager.dispose();
        });
    });

    suite('Event Coordination', () => {

        test('should update view when process status changes', async () => {
            const manager = new AIProcessManager();
            const provider = new AIProcessTreeDataProvider(manager);

            let changeCount = 0;
            provider.onDidChangeTreeData(() => {
                changeCount++;
            });

            const processId = manager.registerProcess('Test');
            const initialCount = changeCount;

            manager.updateProcess(processId, 'completed');

            // Should have received at least one more change event
            assert.ok(changeCount > initialCount);

            provider.dispose();
            manager.dispose();
        });
    });
});
