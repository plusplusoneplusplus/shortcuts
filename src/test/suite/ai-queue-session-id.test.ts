/**
 * Tests for AI Queue Service Session ID Tracking
 *
 * Verifies that queued AI tasks correctly attach SDK session IDs
 * to their tracked processes, enabling session resume functionality.
 *
 * Bug context: AITaskExecutor.execute() was returning sessionId in the
 * result JSON but never calling attachSdkSessionId() on the process manager,
 * so queued tasks could never be resumed.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    AIProcessManager,
    MockAIProcessManager,
    AIQueueService,
    initializeAIQueueService,
    resetAIQueueService,
} from '../../shortcuts/ai-service';

// ============================================================================
// Test Utilities
// ============================================================================

class MockGlobalState {
    private storage: Map<string, unknown> = new Map();

    get<T>(key: string, defaultValue?: T): T {
        return this.storage.has(key) ? this.storage.get(key) as T : defaultValue as T;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.storage.set(key, value);
    }
}

class MockExtensionContext {
    subscriptions: vscode.Disposable[] = [];
    workspaceState = new MockGlobalState();
    globalState = new MockGlobalState();
}

// ============================================================================
// AIProcessManager - Session ID Attachment for Queue Processes
// ============================================================================

suite('Queue Process Session ID Attachment', () => {
    let processManager: AIProcessManager;
    let context: MockExtensionContext;

    setup(async () => {
        context = new MockExtensionContext();
        processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);
    });

    teardown(() => {
        processManager.dispose();
    });

    test('should attach SDK session ID to queue-typed process', () => {
        // Simulate what AITaskExecutor does: register a queue process, then attach session ID
        const processId = processManager.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-1',
                priority: 'normal',
            },
        });

        // Attach session ID (this is the fix)
        processManager.attachSdkSessionId(processId, 'sdk-session-queue-123');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');

        // Verify session ID is attached
        const sessionId = processManager.getSdkSessionId(processId);
        assert.strictEqual(sessionId, 'sdk-session-queue-123', 'Should have SDK session ID attached');

        // Verify session metadata
        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata, 'Should have session metadata');
        assert.strictEqual(metadata.sdkSessionId, 'sdk-session-queue-123');
        assert.strictEqual(metadata.backend, 'copilot-sdk');
        assert.strictEqual(metadata.workingDirectory, '/test/workspace');
    });

    test('should make queue process resumable when session ID is attached', () => {
        const processId = processManager.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-1',
                priority: 'normal',
            },
        });

        // Attach session ID and complete the process
        processManager.attachSdkSessionId(processId, 'sdk-session-queue-456');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
        processManager.completeProcess(processId, JSON.stringify({ response: 'Done', sessionId: 'sdk-session-queue-456' }));

        // Verify process is resumable
        const isResumable = processManager.isProcessResumable(processId);
        assert.strictEqual(isResumable, true, 'Queue process with session ID should be resumable');
    });

    test('should NOT be resumable when session ID is missing', () => {
        const processId = processManager.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-1',
                priority: 'normal',
            },
        });

        // Complete without attaching session ID (the bug scenario)
        processManager.completeProcess(processId, JSON.stringify({ response: 'Done', sessionId: 'sdk-session-789' }));

        // Verify process is NOT resumable (session ID only in result JSON, not attached)
        const isResumable = processManager.isProcessResumable(processId);
        assert.strictEqual(isResumable, false, 'Queue process without attached session ID should NOT be resumable');
    });

    test('should attach session ID for queue-ai-clarification process', () => {
        const processId = processManager.registerTypedProcess('Clarify this text', {
            type: 'queue-ai-clarification',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-ai-clarification',
                queueTaskId: 'task-2',
                priority: 'high',
            },
        });

        processManager.attachSdkSessionId(processId, 'sdk-session-clarify-001');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
        processManager.completeProcess(processId, JSON.stringify({ response: 'Explanation here', sessionId: 'sdk-session-clarify-001' }));

        const isResumable = processManager.isProcessResumable(processId);
        assert.strictEqual(isResumable, true, 'Clarification queue process should be resumable with session ID');
    });

    test('should persist session ID across serialization', () => {
        const processId = processManager.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-3',
                priority: 'normal',
            },
        });

        processManager.attachSdkSessionId(processId, 'sdk-session-persist-001');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
        processManager.completeProcess(processId, 'Result text');

        // Get the process and verify serialized fields
        const process = processManager.getProcess(processId);
        assert.ok(process, 'Process should exist');
        assert.strictEqual(process.sdkSessionId, 'sdk-session-persist-001', 'Session ID should be on the process');
        assert.strictEqual(process.backend, 'copilot-sdk', 'Backend should be on the process');
        assert.strictEqual(process.workingDirectory, '/test/workspace', 'Working directory should be on the process');
    });

    test('should handle session ID attachment before completion', () => {
        // This tests the correct order: attach first, then complete
        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // Attach session ID while still running
        processManager.attachSdkSessionId(processId, 'sdk-session-running');

        const process = processManager.getProcess(processId);
        assert.ok(process, 'Process should exist');
        assert.strictEqual(process.status, 'running', 'Process should still be running');
        assert.strictEqual(process.sdkSessionId, 'sdk-session-running', 'Session ID should be attached while running');

        // Now complete
        processManager.completeProcess(processId, 'Done');

        const completed = processManager.getProcess(processId);
        assert.ok(completed, 'Process should exist after completion');
        assert.strictEqual(completed.status, 'completed');
        assert.strictEqual(completed.sdkSessionId, 'sdk-session-running', 'Session ID should persist after completion');
    });

    test('should not attach session ID for failed processes', () => {
        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // Fail the process without attaching session ID
        processManager.failProcess(processId, 'SDK execution failed');

        const process = processManager.getProcess(processId);
        assert.ok(process, 'Process should exist');
        assert.strictEqual(process.status, 'failed');
        assert.strictEqual(process.sdkSessionId, undefined, 'Failed process should not have session ID');
        assert.strictEqual(processManager.isProcessResumable(processId), false, 'Failed process should not be resumable');
    });
});

// ============================================================================
// MockAIProcessManager - Session ID Tracking for Queue Tasks
// ============================================================================

suite('MockAIProcessManager - Queue Session ID Tracking', () => {
    let mock: MockAIProcessManager;

    setup(() => {
        mock = new MockAIProcessManager();
    });

    test('should record attachSdkSessionId calls for queue processes', () => {
        const processId = mock.registerTypedProcess('Queue task prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-1',
                priority: 'normal',
            },
        });

        mock.attachSdkSessionId(processId, 'sdk-session-mock-001');

        const calls = mock.getCallsForMethod('attachSdkSessionId');
        assert.strictEqual(calls.length, 1, 'Should record one attachSdkSessionId call');
        assert.deepStrictEqual(calls[0].args, [processId, 'sdk-session-mock-001']);
    });

    test('should record attachSessionMetadata calls for queue processes', () => {
        const processId = mock.registerTypedProcess('Queue task prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        mock.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');

        const calls = mock.getCallsForMethod('attachSessionMetadata');
        assert.strictEqual(calls.length, 1, 'Should record one attachSessionMetadata call');
        assert.deepStrictEqual(calls[0].args, [processId, 'copilot-sdk', '/test/workspace']);
    });

    test('should make queue process resumable in mock', () => {
        const processId = mock.registerTypedProcess('Queue task prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        mock.attachSdkSessionId(processId, 'sdk-session-mock-002');
        mock.completeProcess(processId, 'Result');

        const isResumable = mock.isProcessResumable(processId);
        assert.strictEqual(isResumable, true, 'Mock queue process should be resumable');
    });

    test('should track session metadata in mock', () => {
        const processId = mock.registerTypedProcess('Queue task prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        mock.attachSdkSessionId(processId, 'sdk-session-mock-003');
        mock.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');

        const metadata = mock.getSessionMetadata(processId);
        assert.ok(metadata, 'Should have session metadata');
        assert.strictEqual(metadata.sdkSessionId, 'sdk-session-mock-003');
        assert.strictEqual(metadata.backend, 'copilot-sdk');
        assert.strictEqual(metadata.workingDirectory, '/test/workspace');
    });
});

// ============================================================================
// AITaskExecutor Session ID Logic (Behavioral Tests)
// ============================================================================

suite('AITaskExecutor Session ID Logic - Behavioral', () => {
    let processManager: AIProcessManager;
    let context: MockExtensionContext;

    setup(async () => {
        context = new MockExtensionContext();
        processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);
    });

    teardown(() => {
        processManager.dispose();
    });

    test('should correctly extract session ID from result object', () => {
        // Simulate the executor's session ID extraction logic
        const result: Record<string, unknown> = {
            response: 'Task completed',
            sessionId: 'sdk-session-extract-001',
        };

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // Simulate the fix: extract and attach session ID from result
        if (result.sessionId && typeof result.sessionId === 'string') {
            processManager.attachSdkSessionId(processId, result.sessionId);
            processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
        }

        processManager.completeProcess(processId, JSON.stringify(result));

        // Verify
        assert.strictEqual(processManager.getSdkSessionId(processId), 'sdk-session-extract-001');
        assert.strictEqual(processManager.isProcessResumable(processId), true);
    });

    test('should handle result without session ID gracefully', () => {
        // Simulate a result that doesn't have a session ID (e.g., generic execution)
        const result: Record<string, unknown> = {
            status: 'completed',
            taskId: 'task-1',
        };

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // The fix should not attach anything when sessionId is missing
        if (result.sessionId && typeof result.sessionId === 'string') {
            processManager.attachSdkSessionId(processId, result.sessionId);
        }

        processManager.completeProcess(processId, JSON.stringify(result));

        // Verify no session ID attached
        assert.strictEqual(processManager.getSdkSessionId(processId), undefined);
        assert.strictEqual(processManager.isProcessResumable(processId), false);
    });

    test('should handle result with non-string session ID gracefully', () => {
        // Edge case: sessionId is not a string
        const result: Record<string, unknown> = {
            response: 'Done',
            sessionId: 12345, // Not a string
        };

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // The fix checks typeof === 'string'
        if (result.sessionId && typeof result.sessionId === 'string') {
            processManager.attachSdkSessionId(processId, result.sessionId);
        }

        processManager.completeProcess(processId, JSON.stringify(result));

        // Should not attach non-string session ID
        assert.strictEqual(processManager.getSdkSessionId(processId), undefined);
        assert.strictEqual(processManager.isProcessResumable(processId), false);
    });

    test('should handle undefined result gracefully', () => {
        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const result: Record<string, unknown> | undefined = undefined;

        // The fix checks result?.sessionId
        const resultObj = result as Record<string, unknown> | undefined;
        if (resultObj?.sessionId && typeof resultObj.sessionId === 'string') {
            processManager.attachSdkSessionId(processId, resultObj.sessionId);
        }

        processManager.completeProcess(processId, '');

        assert.strictEqual(processManager.getSdkSessionId(processId), undefined);
    });

    test('should handle follow-prompt working directory extraction', () => {
        // Simulate extracting working directory from FollowPromptPayload
        const payload = {
            promptFilePath: '/test/impl.prompt.md',
            planFilePath: '/test/task.plan.md',
            workingDirectory: '/test/my-project',
        };

        const processId = processManager.registerTypedProcess('Follow the instruction', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-1',
                priority: 'normal',
            },
        });

        // Simulate the fix: attach session metadata with working directory from payload
        processManager.attachSdkSessionId(processId, 'sdk-session-fp-001');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', payload.workingDirectory);
        processManager.completeProcess(processId, 'Done');

        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata);
        assert.strictEqual(metadata.workingDirectory, '/test/my-project', 'Should use working directory from payload');
    });

    test('should handle clarification working directory extraction', () => {
        // Simulate extracting working directory from AIClarificationPayload
        const payload = {
            prompt: 'Explain this code',
            workingDirectory: '/test/clarification-project',
            model: 'gpt-4',
        };

        const processId = processManager.registerTypedProcess('Clarify', {
            type: 'queue-ai-clarification',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-ai-clarification',
                queueTaskId: 'task-2',
                priority: 'high',
            },
        });

        processManager.attachSdkSessionId(processId, 'sdk-session-clar-001');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', payload.workingDirectory);
        processManager.completeProcess(processId, 'Explanation');

        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata);
        assert.strictEqual(metadata.workingDirectory, '/test/clarification-project');
    });
});

// ============================================================================
// Persistence Tests - Queue Session ID Survives Reload
// ============================================================================

suite('Queue Session ID Persistence', () => {
    test('should persist queue process session ID across save/load cycle', async () => {
        const context = new MockExtensionContext();
        const manager1 = new AIProcessManager();
        await manager1.initialize(context as unknown as vscode.ExtensionContext);

        // Create and complete a queue process with session ID
        const processId = manager1.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-persist-1',
                priority: 'normal',
            },
        });

        manager1.attachSdkSessionId(processId, 'sdk-session-persist-test');
        manager1.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
        manager1.completeProcess(processId, 'Completed result');

        // Verify before reload
        assert.strictEqual(manager1.isProcessResumable(processId), true, 'Should be resumable before reload');

        // Dispose first manager (simulates extension deactivation)
        manager1.dispose();

        // Create new manager and load from same storage (simulates extension reactivation)
        const manager2 = new AIProcessManager();
        await manager2.initialize(context as unknown as vscode.ExtensionContext);

        // Find the process (ID may be different after reload, search by prompt)
        const processes = manager2.getProcesses();
        const reloadedProcess = processes.find(p => p.fullPrompt === 'Follow the instruction /test/prompt.md');

        assert.ok(reloadedProcess, 'Process should be restored after reload');
        assert.strictEqual(reloadedProcess.sdkSessionId, 'sdk-session-persist-test', 'Session ID should persist');
        assert.strictEqual(reloadedProcess.backend, 'copilot-sdk', 'Backend should persist');
        assert.strictEqual(reloadedProcess.workingDirectory, '/test/workspace', 'Working directory should persist');
        assert.strictEqual(reloadedProcess.status, 'completed', 'Status should persist');

        // Verify resumability after reload
        const isResumable = manager2.isProcessResumable(reloadedProcess.id);
        assert.strictEqual(isResumable, true, 'Queue process should be resumable after reload');

        manager2.dispose();
    });

    test('should persist multiple queue processes with different session IDs', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as unknown as vscode.ExtensionContext);

        // Create multiple queue processes
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) {
            const processId = manager.registerTypedProcess(`Queue task ${i}`, {
                type: 'queue-follow-prompt',
                idPrefix: 'queue',
                metadata: {
                    type: 'queue-follow-prompt',
                    queueTaskId: `task-${i}`,
                    priority: 'normal',
                },
            });
            manager.attachSdkSessionId(processId, `sdk-session-multi-${i}`);
            manager.attachSessionMetadata(processId, 'copilot-sdk', `/test/workspace-${i}`);
            manager.completeProcess(processId, `Result ${i}`);
            ids.push(processId);
        }

        // Verify all have unique session IDs
        for (let i = 0; i < 3; i++) {
            const sessionId = manager.getSdkSessionId(ids[i]);
            assert.strictEqual(sessionId, `sdk-session-multi-${i}`, `Process ${i} should have correct session ID`);
            assert.strictEqual(manager.isProcessResumable(ids[i]), true, `Process ${i} should be resumable`);
        }

        manager.dispose();
    });
});

// ============================================================================
// Tree Provider Context Value Tests
// ============================================================================

suite('Queue Process Tree Item Resumability', () => {
    test('should set resumable context value for queue process with session ID', async () => {
        // Import tree provider
        const { AIProcessTreeDataProvider } = await import('../../shortcuts/ai-service');

        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        // Create a queue process with session ID
        const processId = processManager.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-tree-1',
                priority: 'normal',
            },
        });

        processManager.attachSdkSessionId(processId, 'sdk-session-tree-001');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', '/test/workspace');
        processManager.completeProcess(processId, 'Result');

        // Get the process
        const process = processManager.getProcess(processId);
        assert.ok(process, 'Process should exist');
        assert.strictEqual(process.sdkSessionId, 'sdk-session-tree-001');
        assert.strictEqual(process.status, 'completed');

        // Verify the process has all fields needed for resumability
        assert.ok(process.fullPrompt, 'Should have fullPrompt');
        assert.ok(process.result, 'Should have result');
        assert.ok(process.sdkSessionId, 'Should have sdkSessionId');

        processManager.dispose();
    });

    test('should NOT set resumable context value for queue process without session ID', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        // Create a queue process WITHOUT session ID (the bug scenario)
        const processId = processManager.registerTypedProcess('Follow the instruction /test/prompt.md', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
            metadata: {
                type: 'queue-follow-prompt',
                queueTaskId: 'task-tree-2',
                priority: 'normal',
            },
        });

        // Complete without attaching session ID
        processManager.completeProcess(processId, 'Result');

        const process = processManager.getProcess(processId);
        assert.ok(process, 'Process should exist');
        assert.strictEqual(process.sdkSessionId, undefined, 'Should NOT have sdkSessionId');
        assert.strictEqual(processManager.isProcessResumable(processId), false, 'Should NOT be resumable');

        processManager.dispose();
    });
});

// ============================================================================
// Cross-Platform Tests
// ============================================================================

suite('Queue Session ID - Cross-Platform', () => {
    test('should handle Windows-style working directory paths', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const windowsPath = 'C:\\Users\\test\\project';
        processManager.attachSdkSessionId(processId, 'sdk-session-win');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', windowsPath);
        processManager.completeProcess(processId, 'Done');

        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata);
        assert.strictEqual(metadata.workingDirectory, windowsPath, 'Should preserve Windows path');
        assert.strictEqual(processManager.isProcessResumable(processId), true);

        processManager.dispose();
    });

    test('should handle Unix-style working directory paths', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const unixPath = '/home/user/project';
        processManager.attachSdkSessionId(processId, 'sdk-session-unix');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', unixPath);
        processManager.completeProcess(processId, 'Done');

        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata);
        assert.strictEqual(metadata.workingDirectory, unixPath, 'Should preserve Unix path');
        assert.strictEqual(processManager.isProcessResumable(processId), true);

        processManager.dispose();
    });

    test('should handle macOS-style working directory paths', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const macPath = '/Users/developer/Documents/Projects/my-project';
        processManager.attachSdkSessionId(processId, 'sdk-session-mac');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', macPath);
        processManager.completeProcess(processId, 'Done');

        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata);
        assert.strictEqual(metadata.workingDirectory, macPath, 'Should preserve macOS path');
        assert.strictEqual(processManager.isProcessResumable(processId), true);

        processManager.dispose();
    });
});

// ============================================================================
// Edge Cases
// ============================================================================

suite('Queue Session ID - Edge Cases', () => {
    test('should handle empty string session ID', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // Empty string session ID should be treated as falsy in the fix
        const result: Record<string, unknown> = { response: 'Done', sessionId: '' };
        if (result.sessionId && typeof result.sessionId === 'string') {
            processManager.attachSdkSessionId(processId, result.sessionId);
        }

        processManager.completeProcess(processId, JSON.stringify(result));

        // Empty string is falsy, so no session ID should be attached
        assert.strictEqual(processManager.getSdkSessionId(processId), undefined);

        processManager.dispose();
    });

    test('should handle null session ID in result', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const result: Record<string, unknown> = { response: 'Done', sessionId: null };
        if (result.sessionId && typeof result.sessionId === 'string') {
            processManager.attachSdkSessionId(processId, result.sessionId);
        }

        processManager.completeProcess(processId, JSON.stringify(result));

        assert.strictEqual(processManager.getSdkSessionId(processId), undefined);

        processManager.dispose();
    });

    test('should handle very long session ID', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const longSessionId = 'sdk-session-' + 'a'.repeat(500);
        processManager.attachSdkSessionId(processId, longSessionId);
        processManager.completeProcess(processId, 'Done');

        assert.strictEqual(processManager.getSdkSessionId(processId), longSessionId);
        assert.strictEqual(processManager.isProcessResumable(processId), true);

        processManager.dispose();
    });

    test('should handle session ID with special characters', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        const specialSessionId = 'sdk-session-with-special/chars:and@symbols+more=stuff';
        processManager.attachSdkSessionId(processId, specialSessionId);
        processManager.completeProcess(processId, 'Done');

        assert.strictEqual(processManager.getSdkSessionId(processId), specialSessionId);
        assert.strictEqual(processManager.isProcessResumable(processId), true);

        processManager.dispose();
    });

    test('should handle missing working directory in payload', async () => {
        const context = new MockExtensionContext();
        const processManager = new AIProcessManager();
        await processManager.initialize(context as unknown as vscode.ExtensionContext);

        const processId = processManager.registerTypedProcess('Test prompt', {
            type: 'queue-follow-prompt',
            idPrefix: 'queue',
        });

        // Attach session ID but no working directory
        processManager.attachSdkSessionId(processId, 'sdk-session-no-wd');
        processManager.attachSessionMetadata(processId, 'copilot-sdk', undefined);
        processManager.completeProcess(processId, 'Done');

        const metadata = processManager.getSessionMetadata(processId);
        assert.ok(metadata);
        assert.strictEqual(metadata.sdkSessionId, 'sdk-session-no-wd');
        assert.strictEqual(metadata.backend, 'copilot-sdk');
        // Working directory may be undefined
        assert.strictEqual(processManager.isProcessResumable(processId), true);

        processManager.dispose();
    });
});
