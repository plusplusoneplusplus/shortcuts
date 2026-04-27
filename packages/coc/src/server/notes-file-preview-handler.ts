/**
 * Notes File Preview Handler — provides file content preview for hover tooltips.
 *
 * GET /api/workspaces/:id/notes/file-preview?path=…
 * Returns { content, exists, type: 'note' | 'file' } for use by the
 * FilePreviewTooltip component.
 *
 * Checks notes root first (for note files), then workspace root (for repo files).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail } from './shared/handler-utils';
import type { Route } from './types';
import { getRepoDataPath } from './paths';

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}

const MAX_PREVIEW_BYTES = 4096;

export function registerNotesFilePreviewRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {
    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/file-preview?path=… — File preview
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/file-preview$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);

            // Try notes root first
            const notesResolved = path.resolve(notesRoot, filePath);
            try {
                const content = await fs.promises.readFile(notesResolved, 'utf-8');
                const truncated = content.length > MAX_PREVIEW_BYTES
                    ? content.slice(0, MAX_PREVIEW_BYTES)
                    : content;
                return sendJSON(res, 200, { content: truncated, exists: true, type: 'note' });
            } catch {
                // Not in notes root — try workspace root
            }

            // Try workspace root (the actual repository)
            if (ws.rootPath) {
                const wsResolved = path.resolve(ws.rootPath, filePath);
                try {
                    const content = await fs.promises.readFile(wsResolved, 'utf-8');
                    const truncated = content.length > MAX_PREVIEW_BYTES
                        ? content.slice(0, MAX_PREVIEW_BYTES)
                        : content;
                    return sendJSON(res, 200, { content: truncated, exists: true, type: 'file' });
                } catch {
                    // Not found in workspace root either
                }
            }

            // File not found anywhere
            return sendJSON(res, 200, { content: '', exists: false, type: 'file' });
        },
    });
}
