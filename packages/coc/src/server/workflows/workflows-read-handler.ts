/**
 * Workflow read-only REST API routes.
 *
 * Extracted from workflows-handler.ts to keep each module focused.
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import type { Route } from '../types';
import { DEFAULT_WORKFLOWS_FOLDER } from './workflow-constants';
import { resolveWorkspace, resolveAndValidatePath, discoverAndEnrichWorkflows } from './workflow-utils';

// ============================================================================
// Read Route Registration
// ============================================================================

/**
 * Register workflow read-only API routes on the given route table.
 */
export function registerWorkflowRoutes(
    routes: Route[],
    store: ProcessStore,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/workflows/:pipelineName/content
    // Returns YAML content of a workflow.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/([^/]+)\/content$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const pipelineName = decodeURIComponent(match![2]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            const yamlPath = path.join(resolvedDir, 'pipeline.yaml');

            try {
                const content = await fs.promises.readFile(yamlPath, 'utf-8');
                sendJSON(res, 200, { content, path: yamlPath });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'Workflow not found');
                }
                return sendError(res, 500, 'Failed to read workflow: ' + (err.message || 'Unknown error'));
            }
        },
    });

}
