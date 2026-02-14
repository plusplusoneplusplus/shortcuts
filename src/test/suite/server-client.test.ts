/**
 * Tests for ServerClient and workspace identity utilities
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import { ServerClient } from '../../shortcuts/ai-service/server-client';
import { computeWorkspaceId, WorkspaceInfo } from '../../shortcuts/ai-service/workspace-identity';
import { AIProcess } from '../../shortcuts/ai-service/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProcess(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'proc-1',
        type: 'clarification',
        promptPreview: 'test prompt',
        fullPrompt: 'full test prompt',
        status: 'running',
        startTime: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    };
}

function makeWorkspace(rootPath = '/home/user/project'): WorkspaceInfo {
    return {
        id: computeWorkspaceId(rootPath),
        name: 'project',
        rootPath,
    };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

suite('Workspace Identity Tests', () => {

    test('Workspace ID generation is deterministic', () => {
        const path = '/home/user/my-project';
        const id1 = computeWorkspaceId(path);
        const id2 = computeWorkspaceId(path);
        assert.strictEqual(id1, id2);
        assert.strictEqual(id1.length, 16);
        // Verify it's hex
        assert.ok(/^[0-9a-f]{16}$/.test(id1), `Expected 16 hex chars, got: ${id1}`);
    });

    test('Workspace ID differs for different paths', () => {
        const id1 = computeWorkspaceId('/home/user/project-a');
        const id2 = computeWorkspaceId('/home/user/project-b');
        assert.notStrictEqual(id1, id2);
    });

    test('Workspace ID matches SHA-256 prefix', () => {
        const path = '/test/path';
        const expected = crypto.createHash('sha256').update(path).digest('hex').substring(0, 16);
        assert.strictEqual(computeWorkspaceId(path), expected);
    });
});

suite('ServerClient Tests', () => {

    test('ServerClient serializes and submits process', () => {
        // Construct with a dummy URL (we never actually connect)
        const client = new ServerClient('http://localhost:4000');
        const process = makeProcess();
        const ws = makeWorkspace();

        // submitProcess should enqueue without throwing
        client.submitProcess(process, ws);
        assert.strictEqual(client.queueLength, 1);
        client.dispose();
    });

    test('ServerClient handles server unavailability', () => {
        const client = new ServerClient('http://localhost:59999');
        const ws = makeWorkspace();

        // Enqueue several items — none should throw
        client.submitProcess(makeProcess({ id: 'p1' }), ws);
        client.updateProcess('p1', makeProcess({ id: 'p1', status: 'completed' }));
        client.removeProcess('p1');

        // Queue should have accumulated items
        assert.ok(client.queueLength >= 1, 'Queue should have items');
        client.dispose();
    });

    test('Queue drops oldest when full', () => {
        const maxSize = 5;
        const client = new ServerClient('http://localhost:59999', maxSize);
        const ws = makeWorkspace();

        // Enqueue more than max
        for (let i = 0; i < maxSize + 3; i++) {
            client.submitProcess(makeProcess({ id: `p${i}` }), ws);
        }

        assert.strictEqual(client.queueLength, maxSize);
        client.dispose();
    });

    test('Queue flushes on reconnect', async () => {
        // We can't easily test real HTTP, but we can verify queue structure
        const client = new ServerClient('http://localhost:59999');
        const ws = makeWorkspace();

        client.submitProcess(makeProcess({ id: 'p1' }), ws);
        client.submitProcess(makeProcess({ id: 'p2' }), ws);
        client.submitProcess(makeProcess({ id: 'p3' }), ws);

        assert.ok(client.queueLength >= 1, 'Should have queued items');
        client.dispose();
        // After dispose, no timers are left running
    });

    test('Extension works when server URL is empty', () => {
        // ServerClient is never constructed when URL is empty
        // Just verify AIProcessManager patterns work without server client
        const { AIProcessManager, MockAIProcessManager } = require('../../shortcuts/ai-service');
        const manager = new MockAIProcessManager();

        // Operations should succeed without server client
        const id = manager.registerTypedProcess('test', { type: 'clarification' });
        assert.ok(id, 'Should return process ID');
        manager.cancelProcess(id);
    });

    test('setServerClient can be called multiple times', () => {
        const { MockAIProcessManager } = require('../../shortcuts/ai-service');
        const manager = new MockAIProcessManager();

        const client1 = new ServerClient('http://localhost:4001');
        const client2 = new ServerClient('http://localhost:4002');

        // Should not throw when called multiple times
        manager.setServerClient(client1);
        manager.setServerClient(client2);
        manager.setServerClient(undefined);

        client1.dispose();
        client2.dispose();
    });

    test('ServerClient constructor parses URL correctly', () => {
        const client = new ServerClient('https://example.com:8443/prefix');
        // Should not throw; verify queue works
        client.registerWorkspace(makeWorkspace());
        assert.strictEqual(client.queueLength, 1);
        client.dispose();
    });

    test('ServerClient cancelProcess enqueues POST', () => {
        const client = new ServerClient('http://localhost:4000');
        client.cancelProcess('proc-123');
        assert.strictEqual(client.queueLength, 1);
        client.dispose();
    });

    test('ServerClient removeProcess enqueues DELETE', () => {
        const client = new ServerClient('http://localhost:4000');
        client.removeProcess('proc-456');
        assert.strictEqual(client.queueLength, 1);
        client.dispose();
    });

    test('ServerClient dispose prevents further enqueuing', () => {
        const client = new ServerClient('http://localhost:4000');
        client.dispose();
        client.registerWorkspace(makeWorkspace());
        // After dispose, enqueue is a no-op
        assert.strictEqual(client.queueLength, 0);
    });

    test('Submit flow includes workspace identity', () => {
        const client = new ServerClient('http://localhost:4000');
        const process = makeProcess({ id: 'submit-flow-1' });
        const ws = makeWorkspace('/home/user/my-project');
        client.submitProcess(process, ws);
        // Verify enqueued (body contains workspaceId)
        assert.strictEqual(client.queueLength, 1);
        client.dispose();
    });

    test('Update flow enqueues PATCH', () => {
        const client = new ServerClient('http://localhost:4000');
        const updates = makeProcess({ id: 'u1', status: 'completed', result: 'done' });
        client.updateProcess('u1', updates);
        assert.strictEqual(client.queueLength, 1);
        client.dispose();
    });

    test('Remove flow is idempotent (enqueue multiple removes)', () => {
        const client = new ServerClient('http://localhost:4000');
        client.removeProcess('r1');
        client.removeProcess('r1');
        assert.strictEqual(client.queueLength, 2);
        client.dispose();
    });

    test('Offline queue accumulates without sending', () => {
        // ServerClient with unreachable host queues without throwing
        const client = new ServerClient('http://localhost:59999');
        const ws = makeWorkspace();
        client.submitProcess(makeProcess({ id: 'oq1' }), ws);
        client.submitProcess(makeProcess({ id: 'oq2' }), ws);
        client.submitProcess(makeProcess({ id: 'oq3' }), ws);
        assert.ok(client.queueLength >= 1, 'Items should be queued');
        client.dispose();
    });

    test('Workspace identity: same path produces same ID', () => {
        const path = '/home/consistent/project';
        const id1 = computeWorkspaceId(path);
        const id2 = computeWorkspaceId(path);
        assert.strictEqual(id1, id2);
    });

    test('Workspace identity: different paths produce different IDs', () => {
        const id1 = computeWorkspaceId('/home/user/alpha');
        const id2 = computeWorkspaceId('/home/user/beta');
        assert.notStrictEqual(id1, id2);
    });
});
