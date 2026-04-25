import type { PermissionRequest, PermissionRequestResult } from '@plusplusoneplusplus/forge';

/**
 * Read-only permission handler for AI sessions.
 * Allows file reads, denies everything else (writes, shell, MCP, URLs).
 */
export function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approve-once' };
    }
    return { kind: 'reject' };
}
