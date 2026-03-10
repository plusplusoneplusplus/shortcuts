import type { PermissionRequest, PermissionRequestResult } from '@plusplusoneplusplus/pipeline-core';

/**
 * Read-only permission handler for AI sessions.
 * Allows file reads, denies everything else (writes, shell, MCP, URLs).
 */
export function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approved' };
    }
    return { kind: 'denied-by-rules' };
}
