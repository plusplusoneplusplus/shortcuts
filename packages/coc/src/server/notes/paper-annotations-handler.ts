/**
 * Paper Annotations REST API Handler (Goal 2).
 *
 * HTTP routes for CRUD on the per-note paper-annotations sidecar: the persisted,
 * dual-anchor Quick Ask Q&A pinned to passages inside a PDF rendered in a note.
 *
 * Storage mirrors the notes-comments sidecar exactly (see
 * {@link resolvePaperAnnotationsSidecarPath}): co-located `<path>.md.paper-annotations.json`
 * under the default managed root, or under the managed area for repo-folder roots.
 * Reusing that placement keeps the same path-safety and access-control guarantees.
 *
 * Endpoints (all guarded by the caller-supplied `features.quickAskSidenotes` flag):
 *   GET    /api/workspaces/:id/notes/paper-annotations?path=&root=            → sidecar
 *   PUT    /api/workspaces/:id/notes/paper-annotations                        → replace all
 *   POST   /api/workspaces/:id/notes/paper-annotations/annotation            → create one
 *   DELETE /api/workspaces/:id/notes/paper-annotations/annotation/:id?path=  → remove one
 *
 * Pure Node.js; cross-platform (Linux/Mac/Windows).
 */

import * as crypto from 'crypto';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { isWithinDirectory } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { readRepoPreferences } from '../preferences-handler';
import type { PaperAnnotationsSidecar, PaperAnnotation } from './paper-annotations-types';
import {
    createEmptyPaperAnnotationsSidecar,
    validateAnnotationDraft,
    normalizeAnnotationDraft,
} from './paper-annotations-types';
import { formatPaperAnnotationsMarkdown } from './paper-annotations-export';
import {
    encodeRootPath,
    resolveNotesRoot,
    isRootResolveError,
    resolvePaperAnnotationsSidecarPath,
} from './notes-root-resolver';
import type { ResolvedNotesRoot } from './notes-root-resolver';
import {
    resolveSafeNotesPath,
    isNotesPathSafetyError,
    type NotesPathSafetyError,
} from './notes-path-safety';

// ============================================================================
// Helpers (mirrors notes-comments-handler)
// ============================================================================

function getWorkspaceDataDir(dataDir: string, workspaceId: string): string {
    return path.join(dataDir, 'repos', workspaceId);
}

function getCopilotDir(): string {
    return path.join(os.homedir(), '.copilot');
}

function isAllowedPath(resolved: string, wsDataDir: string, wsRootPath?: string): boolean {
    return isWithinDirectory(resolved, wsDataDir)
        || isWithinDirectory(resolved, getCopilotDir())
        || (!!wsRootPath && isWithinDirectory(resolved, wsRootPath));
}

async function resolveSidecar(
    dataDir: string,
    workspaceId: string,
    root: ResolvedNotesRoot,
    notePath: string,
): Promise<string | NotesPathSafetyError> {
    if (root.isDefault) {
        return resolvePaperAnnotationsSidecarPath(dataDir, workspaceId, root, notePath);
    }

    const safeNotePath = await resolveSafeNotesPath(root.absolutePath, notePath);
    if (isNotesPathSafetyError(safeNotePath)) {
        return safeNotePath;
    }

    const workspaceDataRoot = getWorkspaceDataDir(dataDir, workspaceId);
    const sidecarRelativePath = path.join(
        'notes-comments',
        encodeRootPath(root.rootId),
        `${safeNotePath.relativePath}.paper-annotations.json`,
    );
    const safeSidecarPath = await resolveSafeNotesPath(
        workspaceDataRoot,
        sidecarRelativePath,
        { rejectSymlinks: true },
    );
    if (isNotesPathSafetyError(safeSidecarPath)) {
        return safeSidecarPath;
    }
    return safeSidecarPath.absolutePath;
}

function resolveRoot(
    dataDir: string,
    ws: { id: string; rootPath?: string },
    rootParam: string | undefined,
): ResolvedNotesRoot | { error: string; statusCode: number } {
    const prefs = readRepoPreferences(dataDir, ws.id);
    return resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
}

async function loadSidecar(filePath: string): Promise<PaperAnnotationsSidecar> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        return JSON.parse(raw) as PaperAnnotationsSidecar;
    } catch (err: any) {
        if (err.code === 'ENOENT') return createEmptyPaperAnnotationsSidecar();
        throw err;
    }
}

async function saveSidecar(filePath: string, data: PaperAnnotationsSidecar): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Route Registration
// ============================================================================

export interface PaperAnnotationsRouteOptions {
    routes: Route[];
    store: ProcessStore;
    dataDir: string;
    /** Live getter for the admin `features.quickAskSidenotes` flag. */
    getEnabled: () => boolean;
}

/**
 * Register paper-annotations API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerPaperAnnotationsRoutes(opts: PaperAnnotationsRouteOptions): void {
    const { routes, store, dataDir, getEnabled } = opts;

    /**
     * Shared prelude: workspace + root + sidecar path resolution + access check.
     * Returns the resolved sidecar path, or null after having sent an error.
     */
    async function resolveSidecarOrFail(
        req: any,
        res: any,
        match: RegExpMatchArray,
        notePath: unknown,
        rootParam: string | undefined,
    ): Promise<string | null> {
        const ws = await resolveWorkspaceOrFail(store, match, res);
        if (!ws) return null;

        if (!notePath || typeof notePath !== 'string') {
            sendError(res, 400, 'Missing required field: path');
            return null;
        }

        const root = resolveRoot(dataDir, ws, rootParam);
        if (isRootResolveError(root)) {
            sendError(res, root.statusCode, root.error);
            return null;
        }

        const wsDataDir = getWorkspaceDataDir(dataDir, ws.id);
        const resolved = await resolveSidecar(dataDir, ws.id, root, notePath);
        if (typeof resolved !== 'string') {
            sendError(res, resolved.statusCode, resolved.error);
            return null;
        }
        if (!isAllowedPath(resolved, wsDataDir, ws.rootPath)) {
            sendError(res, 403, 'Access denied: path is outside workspace data directory');
            return null;
        }
        return resolved;
    }

    // GET /api/workspaces/:id/notes/paper-annotations?path=...&root=...
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/paper-annotations$/,
        handler: async (req, res, match) => {
            if (!getEnabled()) return sendError(res, 404, 'Quick Ask is disabled');
            const parsed = url.parse(req.url!, true);
            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const resolved = await resolveSidecarOrFail(req, res, match!, parsed.query.path, rootParam);
            if (!resolved) return;

            const sidecar = await loadSidecar(resolved);
            sendJSON(res, 200, sidecar);
        },
    });

    // GET /api/workspaces/:id/notes/paper-annotations/export?path=...&root=...&title=...
    // (Goal 4 AC-03) Render every annotation of a note — anchored quote + Q&A —
    // as a single portable Markdown document. Returns { markdown, count }.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/paper-annotations\/export$/,
        handler: async (req, res, match) => {
            if (!getEnabled()) return sendError(res, 404, 'Quick Ask is disabled');
            const parsed = url.parse(req.url!, true);
            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const resolved = await resolveSidecarOrFail(req, res, match!, parsed.query.path, rootParam);
            if (!resolved) return;

            const sidecar = await loadSidecar(resolved);
            const title = typeof parsed.query.title === 'string' ? parsed.query.title : undefined;
            const subtitle = typeof parsed.query.path === 'string' ? parsed.query.path : undefined;
            const markdown = formatPaperAnnotationsMarkdown(sidecar, { title, subtitle });
            sendJSON(res, 200, {
                markdown,
                count: Object.keys(sidecar.annotations).length,
            });
        },
    });

    // PUT /api/workspaces/:id/notes/paper-annotations  (full replace)
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/paper-annotations$/,
        handler: async (req, res, match) => {
            if (!getEnabled()) return sendError(res, 404, 'Quick Ask is disabled');
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, annotations, root: rootParam } = body || {};
            if (!annotations || typeof annotations !== 'object') {
                return sendError(res, 400, 'Missing required field: annotations');
            }

            const resolved = await resolveSidecarOrFail(req, res, match!, notePath, rootParam);
            if (!resolved) return;

            const sidecar: PaperAnnotationsSidecar = { version: 1, annotations };
            await saveSidecar(resolved, sidecar);
            sendJSON(res, 200, sidecar);
        },
    });

    // POST /api/workspaces/:id/notes/paper-annotations/annotation  (create one)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/paper-annotations\/annotation$/,
        handler: async (req, res, match) => {
            if (!getEnabled()) return sendError(res, 404, 'Quick Ask is disabled');
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const { path: notePath, annotation, root: rootParam } = body || {};
            const draftError = validateAnnotationDraft(annotation);
            if (draftError) {
                return sendError(res, 400, draftError);
            }

            const resolved = await resolveSidecarOrFail(req, res, match!, notePath, rootParam);
            if (!resolved) return;

            const built: PaperAnnotation = normalizeAnnotationDraft(
                annotation as Record<string, unknown>,
                crypto.randomUUID(),
                new Date().toISOString(),
            );

            const sidecar = await loadSidecar(resolved);
            sidecar.annotations[built.id] = built;
            await saveSidecar(resolved, sidecar);
            sendJSON(res, 201, { annotation: built });
        },
    });

    // DELETE /api/workspaces/:id/notes/paper-annotations/annotation/:id?path=...&root=...
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/paper-annotations\/annotation\/([^/]+)$/,
        handler: async (req, res, match) => {
            if (!getEnabled()) return sendError(res, 404, 'Quick Ask is disabled');
            const annotationId = decodeURIComponent(match![2]);
            const parsed = url.parse(req.url!, true);
            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const resolved = await resolveSidecarOrFail(req, res, match!, parsed.query.path, rootParam);
            if (!resolved) return;

            const sidecar = await loadSidecar(resolved);
            if (!sidecar.annotations[annotationId]) {
                return sendError(res, 404, 'Annotation not found');
            }
            delete sidecar.annotations[annotationId];
            await saveSidecar(resolved, sidecar);
            res.writeHead(204);
            res.end();
        },
    });
}
