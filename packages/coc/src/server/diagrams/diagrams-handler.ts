/**
 * Diagrams REST API Handler
 *
 * CRUD routes for Excalidraw diagram files stored under
 * `~/.coc/repos/<workspaceId>/diagrams/`.
 *
 * Endpoints:
 *   GET    /api/workspaces/:id/diagrams            — list all diagrams
 *   GET    /api/workspaces/:id/diagrams/:filename   — read a diagram
 *   PUT    /api/workspaces/:id/diagrams/:filename   — create or update a diagram
 *   DELETE /api/workspaces/:id/diagrams/:filename   — delete a diagram
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import * as fs from 'fs';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { Route } from '../types';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Constants
// ============================================================================

const EXCALIDRAW_EXTENSION = '.excalidraw';

// ============================================================================
// Helpers
// ============================================================================

function getDiagramsRoot(dataDir: string, workspaceId: string): string {
    return getRepoDataPath(dataDir, workspaceId, 'diagrams');
}

async function ensureDiagramsDir(diagramsRoot: string): Promise<void> {
    await fs.promises.mkdir(diagramsRoot, { recursive: true });
}

/**
 * Validate and normalise a diagram filename.
 * Returns the sanitised filename (always ending in `.excalidraw`) or null if invalid.
 */
function normaliseFilename(raw: string): string | null {
    if (!raw || typeof raw !== 'string') return null;

    // Reject path traversal
    const decoded = decodeURIComponent(raw);
    if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return null;

    // Ensure the extension
    const name = decoded.endsWith(EXCALIDRAW_EXTENSION)
        ? decoded
        : decoded + EXCALIDRAW_EXTENSION;

    // Basic sanity: no empty base name
    const base = name.slice(0, -EXCALIDRAW_EXTENSION.length);
    if (!base || base.trim().length === 0) return null;

    return name;
}

// ============================================================================
// Types
// ============================================================================

export interface DiagramListEntry {
    filename: string;
    sizeBytes: number;
    createdAt: string;
    updatedAt: string;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register diagram CRUD API routes on the given route table.
 */
export function registerDiagramRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/diagrams — List all diagrams
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/diagrams$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const diagramsRoot = getDiagramsRoot(dataDir, ws.id);
            await ensureDiagramsDir(diagramsRoot);

            let entries: fs.Dirent[];
            try {
                entries = await fs.promises.readdir(diagramsRoot, { withFileTypes: true });
            } catch {
                return sendJSON(res, 200, { diagrams: [] });
            }

            const diagrams: DiagramListEntry[] = [];
            for (const entry of entries) {
                if (!entry.isFile() || !entry.name.endsWith(EXCALIDRAW_EXTENSION)) continue;
                try {
                    const stat = await fs.promises.stat(path.join(diagramsRoot, entry.name));
                    diagrams.push({
                        filename: entry.name,
                        sizeBytes: stat.size,
                        createdAt: stat.birthtime.toISOString(),
                        updatedAt: stat.mtime.toISOString(),
                    });
                } catch {
                    // Skip files we can't stat
                }
            }

            // Sort alphabetically
            diagrams.sort((a, b) => a.filename.localeCompare(b.filename));

            sendJSON(res, 200, { diagrams });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/diagrams/:filename — Read a diagram
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/diagrams\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const filename = normaliseFilename(match![2]);
            if (!filename) {
                return sendError(res, 400, 'Invalid diagram filename');
            }

            const diagramsRoot = getDiagramsRoot(dataDir, ws.id);
            const filePath = path.join(diagramsRoot, filename);

            try {
                const [content, stat] = await Promise.all([
                    fs.promises.readFile(filePath, 'utf-8'),
                    fs.promises.stat(filePath),
                ]);
                const parsed = JSON.parse(content);
                sendJSON(res, 200, {
                    filename,
                    content: parsed,
                    sizeBytes: stat.size,
                    createdAt: stat.birthtime.toISOString(),
                    updatedAt: stat.mtime.toISOString(),
                });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, `Diagram not found: ${filename}`);
                }
                return sendError(res, 500, 'Failed to read diagram: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // PUT /api/workspaces/:id/diagrams/:filename — Create or update
    // ------------------------------------------------------------------
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/diagrams\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const filename = normaliseFilename(match![2]);
            if (!filename) {
                return sendError(res, 400, 'Invalid diagram filename');
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            // Accept either { content: {...} } or the raw Excalidraw JSON directly
            const diagramContent = body.content ?? body;
            if (!diagramContent || typeof diagramContent !== 'object') {
                return sendError(res, 400, 'Request body must be a JSON object (Excalidraw scene) or { content: <scene> }');
            }

            const diagramsRoot = getDiagramsRoot(dataDir, ws.id);
            await ensureDiagramsDir(diagramsRoot);

            const filePath = path.join(diagramsRoot, filename);
            const isNew = !fs.existsSync(filePath);

            try {
                await fs.promises.writeFile(filePath, JSON.stringify(diagramContent, null, 2), 'utf-8');
                const stat = await fs.promises.stat(filePath);
                sendJSON(res, isNew ? 201 : 200, {
                    filename,
                    sizeBytes: stat.size,
                    createdAt: stat.birthtime.toISOString(),
                    updatedAt: stat.mtime.toISOString(),
                    created: isNew,
                });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write diagram: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/diagrams/:filename — Delete a diagram
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/diagrams\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const filename = normaliseFilename(match![2]);
            if (!filename) {
                return sendError(res, 400, 'Invalid diagram filename');
            }

            const diagramsRoot = getDiagramsRoot(dataDir, ws.id);
            const filePath = path.join(diagramsRoot, filename);

            try {
                await fs.promises.unlink(filePath);
                sendJSON(res, 200, { deleted: true, filename });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, `Diagram not found: ${filename}`);
                }
                return sendError(res, 500, 'Failed to delete diagram: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
