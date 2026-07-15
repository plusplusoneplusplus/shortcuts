/**
 * Notes Image Handler — upload and serve image attachments for notes.
 *
 * Default root: images stored under `<notesRoot>/.attachments/<uuid>.<ext>`.
 * Repo-folder roots: images stored co-located at `<repoRoot>/.images/<uuid>.<ext>`.
 * Markdown references use relative paths: `.attachments/<uuid>.<ext>` or `.images/<uuid>.<ext>`.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import { serveStaticFile } from '../shared/router';
import type { Route } from '../types';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import type { ResolvedNotesRoot } from './notes-root-resolver';
import { resolveSafeNotesPath, isNotesPathSafetyError } from './notes-path-safety';
import { readRepoPreferences } from '../preferences-handler';

// ============================================================================
// Constants
// ============================================================================

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']);
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
/** Image directory for the default managed root. */
const ATTACHMENTS_DIR = '.attachments';
/** Image directory for repo-folder roots (co-located in the repo). */
const IMAGES_DIR = '.images';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Return the image storage directory name for the given root.
 * Default root uses `.attachments`; repo-folder roots use `.images`.
 */
function getImageDirName(resolved: ResolvedNotesRoot): string {
    return resolved.isDefault ? ATTACHMENTS_DIR : IMAGES_DIR;
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
    // Body: { fileName, data, root? }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/image$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { fileName, data, root: rootParam } = body;

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

            // Resolve notes root (default or repo-folder)
            const prefs = readRepoPreferences(dataDir, ws.id);
            const resolved = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(resolved)) {
                return sendError(res, resolved.statusCode, resolved.error);
            }

            const imgDirName = getImageDirName(resolved);
            const safeImageDir = resolved.isDefault
                ? undefined
                : await resolveSafeNotesPath(resolved.absolutePath, imgDirName);
            if (safeImageDir && isNotesPathSafetyError(safeImageDir)) {
                return sendError(res, safeImageDir.statusCode, safeImageDir.error);
            }
            const attachmentsDir = safeImageDir?.absolutePath ?? path.join(resolved.absolutePath, imgDirName);

            try {
                await fs.promises.mkdir(attachmentsDir, { recursive: true });

                const uuid = crypto.randomUUID();
                const storedName = `${uuid}${parsed.ext}`;
                const fullPath = path.join(attachmentsDir, storedName);
                const relativePath = `${imgDirName}/${storedName}`;

                await fs.promises.writeFile(fullPath, parsed.buffer);

                sendJSON(res, 201, { path: relativePath, rootId: resolved.rootId });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to save image: ' + err.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/image?path=.attachments/xxx.png&root=...
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/image$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const imagePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;

            if (!imagePath) {
                return sendError(res, 400, 'Missing "path" query parameter');
            }

            // Resolve notes root (default or repo-folder)
            const prefs = readRepoPreferences(dataDir, ws.id);
            const resolved = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(resolved)) {
                return sendError(res, resolved.statusCode, resolved.error);
            }

            const notesRoot = resolved.absolutePath;
            const imgDirName = getImageDirName(resolved);
            const imgDir = path.join(notesRoot, imgDirName);
            let resolvedPath: string;
            if (resolved.isDefault) {
                resolvedPath = path.resolve(notesRoot, imagePath);
                if (!isWithinDirectory(resolvedPath, notesRoot)) {
                    return sendError(res, 403, 'Access denied: path is outside notes directory');
                }
                if (!isWithinDirectory(resolvedPath, imgDir)) {
                    return sendError(res, 403, `Access denied: path must be within ${imgDirName} directory`);
                }
            } else {
                const safePath = await resolveSafeNotesPath(notesRoot, imagePath);
                if (isNotesPathSafetyError(safePath)) {
                    return sendError(res, safePath.statusCode, safePath.error);
                }
                const imagePrefix = `${imgDirName}/`;
                if (!safePath.relativePath.startsWith(imagePrefix)) {
                    return sendError(res, 403, `Access denied: path must be within ${imgDirName} directory`);
                }
                const safeImagePath = await resolveSafeNotesPath(
                    imgDir,
                    safePath.relativePath.slice(imagePrefix.length),
                );
                if (isNotesPathSafetyError(safeImagePath)) {
                    return sendError(res, safeImagePath.statusCode, safeImagePath.error);
                }
                resolvedPath = safeImagePath.absolutePath;
            }

            const served = serveStaticFile(resolvedPath, res);
            if (!served) {
                return sendError(res, 404, 'Image not found');
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/local-image?path=<absolute-path>
    // Serves image files from within the workspace rootPath.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/local-image$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const imagePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';

            if (!imagePath) {
                return sendError(res, 400, 'Missing "path" query parameter');
            }

            const resolved = path.resolve(imagePath);

            // Security: file must be within the workspace root
            if (!ws.rootPath || !isWithinDirectory(resolved, ws.rootPath)) {
                return sendError(res, 403, 'Access denied: path is outside workspace root');
            }

            // Validate file extension
            const ext = path.extname(resolved).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) {
                return sendError(res, 403, `File type "${ext}" is not allowed`);
            }

            const served = serveStaticFile(resolved, res);
            if (!served) {
                return sendError(res, 404, 'Image not found');
            }
        },
    });
}
