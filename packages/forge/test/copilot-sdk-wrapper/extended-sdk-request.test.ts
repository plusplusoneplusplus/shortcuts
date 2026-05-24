/**
 * Unit tests for ExtendedSdkRequest interface in types.ts
 *
 * Verifies that ExtendedSdkRequest correctly extends PermissionRequest with
 * typed `resource` and `operation` properties, eliminating the need for
 * `(request as any)` casts.
 */

import { describe, it, expect } from 'vitest';
import type { ExtendedSdkRequest, PermissionRequest } from '@plusplusoneplusplus/coc-agent-sdk';

describe('ExtendedSdkRequest', () => {
    it('should extend PermissionRequest with resource and operation fields', () => {
        const req: ExtendedSdkRequest = {
            kind: 'write',
            toolCallId: 'tc-1',
            resource: '/some/file.ts',
            operation: 'write',
        };
        expect(req.resource).toBe('/some/file.ts');
        expect(req.operation).toBe('write');
        expect(req.kind).toBe('write');
        expect(req.toolCallId).toBe('tc-1');
    });

    it('should allow resource and operation to be undefined', () => {
        const req: ExtendedSdkRequest = { kind: 'shell' };
        expect(req.resource).toBeUndefined();
        expect(req.operation).toBeUndefined();
    });

    it('should be assignable from a PermissionRequest cast', () => {
        // Simulates the runtime scenario: a PermissionRequest from the SDK
        // that has extra runtime fields but the published SDK type does not declare them.
        const sdkRequest: PermissionRequest = {
            kind: 'read',
            toolCallId: 'tc-2',
            resource: '/path/to/file',
            operation: 'read',
        };

        const extended = sdkRequest as ExtendedSdkRequest;
        expect(extended.resource).toBe('/path/to/file');
        expect(extended.operation).toBe('read');
    });

    it('should handle all PermissionRequest kind values', () => {
        const kinds: Array<PermissionRequest['kind']> = ['shell', 'write', 'mcp', 'read', 'url'];
        for (const kind of kinds) {
            const req: ExtendedSdkRequest = { kind, resource: 'r', operation: 'o' };
            expect(req.kind).toBe(kind);
        }
    });

    it('should preserve index signature from PermissionRequest for extra runtime properties', () => {
        const req: ExtendedSdkRequest = {
            kind: 'mcp',
            someRuntimeField: 'value',
        };
        expect((req as Record<string, unknown>)['someRuntimeField']).toBe('value');
    });
});
