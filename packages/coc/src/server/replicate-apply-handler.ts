/**
 * Replicate Apply REST API Handler
 *
 * POST /api/workspaces/:id/replicate/:processId/apply
 *
 * Reads the completed ReplicateResult from a process and writes the
 * file changes to disk. Idempotent — re-applying the same result
 * overwrites files with the same content.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Workspace resolution helper
// ============================================================================

async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

// ============================================================================
// Types
// ============================================================================

interface FileChange {
    path: string;
    content: string;
    status: 'new' | 'modified' | 'deleted';
}

interface ApplyResult {
    applied: string[];
    errors: Array<{ path: string; error: string }>;
    total: number;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register the replicate-apply route on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerReplicateApplyRoutes(
    routes: Route[],
    store: ProcessStore,
): void {
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/replicate\/([^/]+)\/apply$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const processId = decodeURIComponent(match![2]);

            // 1. Resolve workspace to get repo root
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }
            const repoRoot = ws.rootPath;

            // 2. Load the completed process
            const processRecord = await store.getProcess(processId);
            if (!processRecord) {
                return sendError(res, 404, 'Process not found');
            }

            if (processRecord.status !== 'completed') {
                return sendError(
                    res,
                    409,
                    `Process is not completed (status: ${processRecord.status})`,
                );
            }

            // 3. Extract FileChange[] from the process result
            let changes: FileChange[];
            try {
                const result =
                    typeof processRecord.result === 'string'
                        ? JSON.parse(processRecord.result)
                        : processRecord.result;

                changes = result?.replicateResult?.files;
                if (!Array.isArray(changes) || changes.length === 0) {
                    return sendError(
                        res,
                        422,
                        'Process result does not contain replicate file changes',
                    );
                }
            } catch {
                return sendError(res, 422, 'Failed to parse process result');
            }

            // 4. Validate all paths are within repo root (path traversal guard)
            for (const change of changes) {
                const resolved = path.resolve(repoRoot, change.path);
                if (!resolved.startsWith(repoRoot + path.sep) && resolved !== repoRoot) {
                    return sendError(
                        res,
                        403,
                        `Path traversal denied: ${change.path}`,
                    );
                }
            }

            // 5. Apply changes
            const applied: string[] = [];
            const errors: Array<{ path: string; error: string }> = [];

            for (const change of changes) {
                const fullPath = path.resolve(repoRoot, change.path);
                try {
                    switch (change.status) {
                        case 'new':
                        case 'modified': {
                            await fs.promises.mkdir(path.dirname(fullPath), {
                                recursive: true,
                            });
                            await fs.promises.writeFile(
                                fullPath,
                                change.content ?? '',
                                'utf-8',
                            );
                            applied.push(change.path);
                            break;
                        }
                        case 'deleted': {
                            try {
                                await fs.promises.unlink(fullPath);
                            } catch (err: any) {
                                if (err.code !== 'ENOENT') {
                                    throw err;
                                }
                            }
                            applied.push(change.path);
                            break;
                        }
                        default:
                            errors.push({
                                path: change.path,
                                error: `Unknown change status: ${(change as any).status}`,
                            });
                    }
                } catch (err: any) {
                    errors.push({
                        path: change.path,
                        error: err.message || String(err),
                    });
                }
            }

            // 6. Return summary
            const status = errors.length === 0 ? 200 : 207;
            sendJSON(res, status, {
                applied,
                errors,
                total: changes.length,
            } satisfies ApplyResult);
        },
    });
}
