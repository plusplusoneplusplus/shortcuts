/**
 * Tests for permission handler functionality
 */

import * as assert from 'assert';
import {
    approveAllPermissions,
    denyAllPermissions,
    PermissionRequest,
    PermissionHandler
} from '@plusplusoneplusplus/forge';

/**
 * The approve/deny handlers are kind-agnostic — they never inspect the request
 * body. The SDK's `PermissionRequest` variants each carry many required fields
 * (path, intention, fullCommandText, …) that are irrelevant to handler
 * behaviour, so these tests build minimal requests keyed only by `kind`.
 */
const req = (kind: PermissionRequest['kind']): PermissionRequest =>
    ({ kind } as PermissionRequest);

suite('Permission Handler Tests', () => {
    test('approveAllPermissions should approve all request types', async () => {
        const requests: PermissionRequest[] = [
            req('read'),
            req('write'),
            req('shell'),
            req('mcp'),
            req('url')
        ];

        for (const request of requests) {
            const result = await Promise.resolve(approveAllPermissions(request, { sessionId: 'test-session' }));
            assert.strictEqual(result.kind, 'approve-once', `Should approve ${request.kind} requests`);
        }
    });

    test('denyAllPermissions should deny all request types', async () => {
        const requests: PermissionRequest[] = [
            req('read'),
            req('write'),
            req('shell'),
            req('mcp'),
            req('url')
        ];

        for (const request of requests) {
            const result = await Promise.resolve(denyAllPermissions(request, { sessionId: 'test-session' }));
            assert.strictEqual(result.kind, 'reject', `Should deny ${request.kind} requests`);
        }
    });

    test('Custom permission handler can implement selective approval', async () => {
        const selectiveHandler: PermissionHandler = (request) => {
            // Approve reads, deny everything else
            if (request.kind === 'read') {
                return { kind: 'approve-once' };
            }
            return { kind: 'reject' };
        };

        const readRequest = req('read');
        const writeRequest = req('write');

        const readResult = await Promise.resolve(selectiveHandler(readRequest, { sessionId: 'test' }));
        const writeResult = await Promise.resolve(selectiveHandler(writeRequest, { sessionId: 'test' }));

        assert.strictEqual(readResult.kind, 'approve-once');
        assert.strictEqual(writeResult.kind, 'reject');
    });

    test('Permission handler can be async', async () => {
        const asyncHandler: PermissionHandler = async (request) => {
            // Simulate async approval logic
            await new Promise(resolve => setTimeout(resolve, 10));
            return { kind: 'approve-once' };
        };

        const request = req('shell');
        const result = await asyncHandler(request, { sessionId: 'test' });

        assert.strictEqual(result.kind, 'approve-once');
    });

    test('Permission handler receives session context', () => {
        const handler: PermissionHandler = (request, invocation) => {
            assert.ok(invocation.sessionId, 'Should receive session ID');
            return { kind: 'approve-once' };
        };

        const request = req('read');
        handler(request, { sessionId: 'my-session-123' });
    });

    test('Permission request can include toolCallId metadata', () => {
        const request: PermissionRequest = {
            kind: 'write',
            toolCallId: 'tool-123',
        } as PermissionRequest;

        // Handler can access all fields
        const handler: PermissionHandler = (req) => {
            assert.strictEqual(req.kind, 'write');
            assert.strictEqual(req.toolCallId, 'tool-123');
            return { kind: 'approve-once' };
        };

        handler(request, { sessionId: 'test' });
    });
});
