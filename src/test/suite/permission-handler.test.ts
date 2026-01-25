/**
 * Tests for permission handler functionality
 */

import * as assert from 'assert';
import {
    approveAllPermissions,
    denyAllPermissions,
    PermissionRequest,
    PermissionHandler
} from '../../shortcuts/ai-service';

suite('Permission Handler Tests', () => {
    test('approveAllPermissions should approve all request types', async () => {
        const requests: PermissionRequest[] = [
            { kind: 'read' },
            { kind: 'write' },
            { kind: 'shell' },
            { kind: 'mcp' },
            { kind: 'url' }
        ];

        for (const request of requests) {
            const result = await Promise.resolve(approveAllPermissions(request, { sessionId: 'test-session' }));
            assert.strictEqual(result.kind, 'approved', `Should approve ${request.kind} requests`);
        }
    });

    test('denyAllPermissions should deny all request types', async () => {
        const requests: PermissionRequest[] = [
            { kind: 'read' },
            { kind: 'write' },
            { kind: 'shell' },
            { kind: 'mcp' },
            { kind: 'url' }
        ];

        for (const request of requests) {
            const result = await Promise.resolve(denyAllPermissions(request, { sessionId: 'test-session' }));
            assert.strictEqual(result.kind, 'denied-by-rules', `Should deny ${request.kind} requests`);
        }
    });

    test('Custom permission handler can implement selective approval', async () => {
        const selectiveHandler: PermissionHandler = (request) => {
            // Approve reads, deny everything else
            if (request.kind === 'read') {
                return { kind: 'approved' };
            }
            return { kind: 'denied-by-rules' };
        };

        const readRequest: PermissionRequest = { kind: 'read' };
        const writeRequest: PermissionRequest = { kind: 'write' };

        const readResult = await Promise.resolve(selectiveHandler(readRequest, { sessionId: 'test' }));
        const writeResult = await Promise.resolve(selectiveHandler(writeRequest, { sessionId: 'test' }));

        assert.strictEqual(readResult.kind, 'approved');
        assert.strictEqual(writeResult.kind, 'denied-by-rules');
    });

    test('Permission handler can be async', async () => {
        const asyncHandler: PermissionHandler = async (request) => {
            // Simulate async approval logic
            await new Promise(resolve => setTimeout(resolve, 10));
            return { kind: 'approved' };
        };

        const request: PermissionRequest = { kind: 'shell' };
        const result = await asyncHandler(request, { sessionId: 'test' });

        assert.strictEqual(result.kind, 'approved');
    });

    test('Permission handler receives session context', () => {
        const handler: PermissionHandler = (request, invocation) => {
            assert.ok(invocation.sessionId, 'Should receive session ID');
            return { kind: 'approved' };
        };

        const request: PermissionRequest = { kind: 'read' };
        handler(request, { sessionId: 'my-session-123' });
    });

    test('Permission request can include additional metadata', () => {
        const request: PermissionRequest = {
            kind: 'write',
            toolCallId: 'tool-123',
            filePath: '/path/to/file.txt',
            customField: 'custom-value'
        };

        // Handler can access all fields
        const handler: PermissionHandler = (req) => {
            assert.strictEqual(req.kind, 'write');
            assert.strictEqual(req.toolCallId, 'tool-123');
            assert.strictEqual(req['filePath'], '/path/to/file.txt');
            return { kind: 'approved' };
        };

        handler(request, { sessionId: 'test' });
    });
});
