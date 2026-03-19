/**
 * Tests for AI Process Manager SDK Session Integration
 *
 * Tests for the SDK session tracking and cancellation features
 * added in Phase 5 of the Copilot SDK migration.
 */

import * as assert from 'assert';
import {
    AIProcessManager,
    MockAIProcessManager,
    createMockAIProcessManager,
    AIProcess
} from '../../shortcuts/ai-service';

/**
 * Mock ExtensionContext for testing
 */
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
    globalState = new MockGlobalState();
    workspaceState = new MockGlobalState();
}

// ============================================================================
// AIProcessManager - SDK Session Attachment Tests
// ============================================================================

suite('AIProcessManager - SDK Session Attachment', () => {

    test('should attach SDK session ID to process', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');
        manager.attachSdkSessionId(processId, 'sdk-session-123');

        const sessionId = manager.getSdkSessionId(processId);
        assert.strictEqual(sessionId, 'sdk-session-123', 'Should return attached session ID');
    });

    test('should return undefined for process without SDK session', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');

        const sessionId = manager.getSdkSessionId(processId);
        assert.strictEqual(sessionId, undefined, 'Should return undefined when no session attached');
    });

    test('should return undefined for non-existent process', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const sessionId = manager.getSdkSessionId('non-existent-id');
        assert.strictEqual(sessionId, undefined, 'Should return undefined for non-existent process');
    });

    test('attachSdkSessionId should silently ignore non-existent process', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        // Should not throw
        manager.attachSdkSessionId('non-existent-id', 'sdk-session-123');

        // Verify nothing was affected
        const processes = manager.getProcesses();
        assert.strictEqual(processes.length, 0, 'Should have no processes');
    });

    test('should allow updating SDK session ID', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');
        manager.attachSdkSessionId(processId, 'sdk-session-1');
        manager.attachSdkSessionId(processId, 'sdk-session-2');

        const sessionId = manager.getSdkSessionId(processId);
        assert.strictEqual(sessionId, 'sdk-session-2', 'Should return updated session ID');
    });
});

// ============================================================================
// AIProcessManager - Cancel Process with SDK Session Tests
// ============================================================================

suite('AIProcessManager - Cancel Process with SDK Session', () => {

    test('should cancel process with SDK session', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');
        manager.attachSdkSessionId(processId, 'sdk-session-123');

        const result = manager.cancelProcess(processId);

        assert.strictEqual(result, true, 'Should return true on successful cancellation');
        const process = manager.getProcess(processId);
        assert.ok(process, 'Process should still exist');
        assert.strictEqual(process.status, 'cancelled', 'Process should be cancelled');
    });

    test('should cancel group with SDK sessions in children', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        // Create a group with children that have SDK sessions
        const groupId = manager.registerCodeReviewGroup({
            reviewType: 'commit',
            commitSha: 'abc123',
            rulesUsed: ['rule1.md', 'rule2.md']
        });

        const childId1 = manager.registerCodeReviewProcess(
            'Review prompt 1',
            { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule1.md'] },
            undefined,
            groupId
        );
        manager.attachSdkSessionId(childId1, 'sdk-session-child-1');

        const childId2 = manager.registerCodeReviewProcess(
            'Review prompt 2',
            { reviewType: 'commit', commitSha: 'abc123', rulesUsed: ['rule2.md'] },
            undefined,
            groupId
        );
        manager.attachSdkSessionId(childId2, 'sdk-session-child-2');

        // Cancel the group
        const result = manager.cancelProcess(groupId);

        assert.strictEqual(result, true, 'Should return true on successful cancellation');

        // Verify group and children are cancelled
        const group = manager.getProcess(groupId);
        assert.ok(group, 'Group should exist');
        assert.strictEqual(group.status, 'cancelled', 'Group should be cancelled');

        const child1 = manager.getProcess(childId1);
        assert.ok(child1, 'Child 1 should exist');
        assert.strictEqual(child1.status, 'cancelled', 'Child 1 should be cancelled');

        const child2 = manager.getProcess(childId2);
        assert.ok(child2, 'Child 2 should exist');
        assert.strictEqual(child2.status, 'cancelled', 'Child 2 should be cancelled');
    });

    test('should handle mixed processes (CLI and SDK) in group', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        // Create a group
        const groupId = manager.registerProcessGroup('Pipeline execution', {
            type: 'pipeline-execution',
            idPrefix: 'pipeline'
        });

        // Add child with SDK session
        const sdkChildId = manager.registerTypedProcess(
            'SDK child prompt',
            { type: 'pipeline-item', parentProcessId: groupId }
        );
        manager.attachSdkSessionId(sdkChildId, 'sdk-session-abc');

        // Add child without SDK session (simulating CLI)
        const cliChildId = manager.registerTypedProcess(
            'CLI child prompt',
            { type: 'pipeline-item', parentProcessId: groupId }
        );

        // Cancel the group
        const result = manager.cancelProcess(groupId);

        assert.strictEqual(result, true, 'Should cancel successfully');

        // Both children should be cancelled
        const sdkChild = manager.getProcess(sdkChildId);
        const cliChild = manager.getProcess(cliChildId);

        assert.strictEqual(sdkChild?.status, 'cancelled', 'SDK child should be cancelled');
        assert.strictEqual(cliChild?.status, 'cancelled', 'CLI child should be cancelled');
    });
});

// ============================================================================
// MockAIProcessManager - SDK Session Tests
// ============================================================================

suite('MockAIProcessManager - SDK Session Support', () => {

    test('should implement attachSdkSessionId', () => {
        const mock = new MockAIProcessManager();

        assert.ok(typeof mock.attachSdkSessionId === 'function', 'Should have attachSdkSessionId method');
    });

    test('should implement getSdkSessionId', () => {
        const mock = new MockAIProcessManager();

        assert.ok(typeof mock.getSdkSessionId === 'function', 'Should have getSdkSessionId method');
    });

    test('should track SDK session ID', () => {
        const mock = new MockAIProcessManager();

        const processId = mock.registerProcess('Test prompt');
        mock.attachSdkSessionId(processId, 'mock-sdk-session');

        const sessionId = mock.getSdkSessionId(processId);
        assert.strictEqual(sessionId, 'mock-sdk-session', 'Should return attached session ID');
    });

    test('should record attachSdkSessionId calls', () => {
        const mock = new MockAIProcessManager();

        const processId = mock.registerProcess('Test prompt');
        mock.attachSdkSessionId(processId, 'test-session');

        const calls = mock.getCallsForMethod('attachSdkSessionId');
        assert.strictEqual(calls.length, 1, 'Should record one call');
        assert.strictEqual(calls[0].processId, processId, 'Should record process ID');
        assert.deepStrictEqual(calls[0].args, [processId, 'test-session'], 'Should record arguments');
    });

    test('should record getSdkSessionId calls', () => {
        const mock = new MockAIProcessManager();

        const processId = mock.registerProcess('Test prompt');
        mock.getSdkSessionId(processId);

        const calls = mock.getCallsForMethod('getSdkSessionId');
        assert.strictEqual(calls.length, 1, 'Should record one call');
    });

    test('createMockAIProcessManager factory should return mock with SDK session support', () => {
        const mock = createMockAIProcessManager();

        assert.ok(typeof mock.attachSdkSessionId === 'function');
        assert.ok(typeof mock.getSdkSessionId === 'function');
    });

    test('should return undefined for process without SDK session', () => {
        const mock = new MockAIProcessManager();

        const processId = mock.registerProcess('Test prompt');
        const sessionId = mock.getSdkSessionId(processId);

        assert.strictEqual(sessionId, undefined, 'Should return undefined');
    });
});

// ============================================================================
// IAIProcessManager Interface Compliance Tests
// ============================================================================

suite('IAIProcessManager - SDK Session Interface', () => {

    test('AIProcessManager should implement SDK session methods', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        // Verify methods exist
        assert.ok(typeof manager.attachSdkSessionId === 'function', 'Should have attachSdkSessionId');
        assert.ok(typeof manager.getSdkSessionId === 'function', 'Should have getSdkSessionId');
    });

    test('MockAIProcessManager should implement SDK session methods', () => {
        const mock = new MockAIProcessManager();

        // Verify methods exist
        assert.ok(typeof mock.attachSdkSessionId === 'function', 'Should have attachSdkSessionId');
        assert.ok(typeof mock.getSdkSessionId === 'function', 'Should have getSdkSessionId');
    });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

suite('SDK Session Integration - Edge Cases', () => {

    test('should handle empty session ID', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');
        manager.attachSdkSessionId(processId, '');

        const sessionId = manager.getSdkSessionId(processId);
        assert.strictEqual(sessionId, '', 'Should return empty string');
    });

    test('should handle process with both CLI process and SDK session', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        // Mock child process
        const mockChildProcess = {
            killed: false,
            kill: function() { this.killed = true; }
        };

        const processId = manager.registerProcess('Test prompt', mockChildProcess as never);
        manager.attachSdkSessionId(processId, 'sdk-session-123');

        // Both should be set
        const sessionId = manager.getSdkSessionId(processId);
        assert.strictEqual(sessionId, 'sdk-session-123', 'Should have SDK session');

        // Cancel should handle both
        const cancelled = manager.cancelProcess(processId);
        assert.strictEqual(cancelled, true, 'Should cancel successfully');
        assert.strictEqual(mockChildProcess.killed, true, 'CLI process should be killed');
    });

    test('should handle cancellation of completed process', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');
        manager.attachSdkSessionId(processId, 'sdk-session-123');
        manager.completeProcess(processId, 'Done');

        // Try to cancel completed process
        const result = manager.cancelProcess(processId);
        assert.strictEqual(result, false, 'Should return false for completed process');

        const process = manager.getProcess(processId);
        assert.strictEqual(process?.status, 'completed', 'Status should remain completed');
    });

    test('should handle cleanup after cancel', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        const processId = manager.registerProcess('Test prompt');
        manager.attachSdkSessionId(processId, 'sdk-session-123');
        manager.cancelProcess(processId);

        // Process should be persisted with cancelled status
        const process = manager.getProcess(processId);
        assert.ok(process, 'Process should exist');
        assert.strictEqual(process.status, 'cancelled', 'Should be cancelled');
    });
});

// ============================================================================
// Cross-Platform Tests
// ============================================================================

suite('SDK Session Integration - Cross-Platform', () => {

    test('session IDs should support various formats', async () => {
        const context = new MockExtensionContext();
        const manager = new AIProcessManager();
        await manager.initialize(context as never);

        // Test various session ID formats
        const sessionIds = [
            'simple-id',
            'session-123-456-789',
            'UUID-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
            'mixed_case_Session_ID',
            '1234567890',
            'very-long-session-id-that-might-be-used-by-some-implementations'
        ];

        for (const sessionId of sessionIds) {
            const processId = manager.registerProcess(`Test ${sessionId}`);
            manager.attachSdkSessionId(processId, sessionId);

            const retrieved = manager.getSdkSessionId(processId);
            assert.strictEqual(retrieved, sessionId, `Should handle session ID: ${sessionId}`);
        }
    });
});
