/**
 * Notes Image Handler — upload and serve image attachments for notes.
 *
 * Images are stored under `<notesRoot>/.attachments/<uuid>.<ext>`.
 * Markdown references use relative paths: `.attachments/<uuid>.<ext>`.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from './api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';
import { serveStaticFile } from './shared/router';
import type { Route } from './types';
import { getRepoDataPath } from './paths';

// ============================================================================
// Constants
// ============================================================================

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ATTACHMENTS_DIR = '.attachments';

// ============================================================================
// Helpers
// ============================================================================

function getNotesRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'notes');
}

/**
 * Parse a base64 data URL and return the buffer and detected extension.
 * Accepts: `data:image/png;base64,iVBOR...` or raw base64 string.
 */
function parseDataUrl(data: string): { buffer: Buffer; ext: string } | null {
    const dataUrlMatch = /^data:image\/(\w+);base64,(.+)$/.exec(data);
    if (dataUrlMatch) {
        const mimeSubtype = dataUrlMatch[1].toLowerCase();
        const ext = mimeSubtype === 'jpeg' ? '.jpg' : `.${mimeSubtype}`;
        try {
            const buffer = Buffer.from(dataUrlMatch[2], 'base64');
            return { buffer, ext };
        } catch {
            return null;
        }
    }
    return null;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register notes image API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesImageRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/image — Upload image attachment
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/image$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { fileName, data } = body;

            if (!fileName || typeof fileName !== 'string') {
                return sendError(res, 400, 'Missing or invalid "fileName" field');
            }
            if (!data || typeof data !== 'string') {
                return sendError(res, 400, 'Missing or invalid "data" field (expected base64 data URL)');
            }

            // Parse and validate the data URL
            const parsed = parseDataUrl(data);
            if (!parsed) {
                return sendError(res, 400, 'Invalid data URL format — expected data:image/<type>;base64,...');
            }

            // Validate extension
            if (!ALLOWED_EXTENSIONS.has(parsed.ext)) {
                return sendError(res, 400, `File type "${parsed.ext}" is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
            }

            // Validate size
            if (parsed.buffer.length > MAX_IMAGE_SIZE_BYTES) {
                return sendError(res, 400, `Image too large (${Math.round(parsed.buffer.length / 1024 / 1024)}MB). Maximum: ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB`);
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const attachmentsDir = path.join(notesRoot, ATTACHMENTS_DIR);

            try {
                await fs.promises.mkdir(attachmentsDir, { recursive: true });

                const uuid = crypto.randomUUID();
                const storedName = `${uuid}${parsed.ext}`;
                const fullPath = path.join(attachmentsDir, storedName);
                const relativePath = `${ATTACHMENTS_DIR}/${storedName}`;

                await fs.promises.writeFile(fullPath, parsed.buffer);

                sendJSON(res, 201, { path: relativePath });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to save image: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/image?path=.attachments/xxx.png
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/image$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const imagePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';

            if (!imagePath) {
                return sendError(res, 400, 'Missing "path" query parameter');
            }

            const notesRoot = getNotesRoot(dataDir, ws.id);
            const resolved = path.resolve(notesRoot, imagePath);

            // Security: ensure resolved path is within the notes directory
            if (!isWithinDirectory(resolved, notesRoot)) {
                return sendError(res, 403, 'Access denied: path is outside notes directory');
            }

            // Validate the file is within the .attachments directory
            const attachmentsDir = path.join(notesRoot, ATTACHMENTS_DIR);
            if (!isWithinDirectory(resolved, attachmentsDir)) {
                return sendError(res, 403, 'Access denied: path must be within .attachments directory');
            }

            const served = serveStaticFile(resolved, res);
            if (!served) {
                return sendError(res, 404, 'Image not found');
            }
        },
    });
}
