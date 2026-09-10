/**
 * HTTP API routes for reading notes hierarchy, content, and search
 * for a given workspace.
 */

import * as url from 'url';
import * as path from 'path';
import { mkdir } from 'fs/promises';
import * as os from 'os';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail } from '../shared/handler-utils';
import type { Route } from '../types';
import { SYSTEM_FOLDER_NAMES } from './notes-constants';
import { resolveNotesRoot, isRootResolveError } from './notes-root-resolver';
import { shapeNotesTree } from './notes-tree';
import { readRepoPreferences } from '../preferences-handler';
import type { NotesSearchService } from './notes-search-service';
import { loadNativeNotesFs, toNotesFsError } from '@plusplusoneplusplus/coc-native';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Directories an absolute content path may live under on the default root.
 *
 * Only the default root has the absolute-path escape hatch (scratchpad and
 * session-state files); the native core applies the containment check.
 */
export function contentAllowedPrefixes(dataDir: string, workspaceId: string, wsRootPath?: string): string[] {
    const prefixes = [path.join(dataDir, 'repos', workspaceId), path.join(os.homedir(), '.copilot')];
    if (wsRootPath) prefixes.push(wsRootPath);
    return prefixes;
}

async function ensureNotesRoot(notesRoot: string): Promise<void> {
    await mkdir(notesRoot, { recursive: true });
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all notes read-only API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerNotesRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
    notesSearchService: NotesSearchService,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/tree?root=... — Recursive tree scan
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/tree$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;

            const prefs = readRepoPreferences(dataDir, ws.id);
            const resolved = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(resolved)) {
                return sendError(res, resolved.statusCode, resolved.error);
            }

            const notesRoot = resolved.absolutePath;
            await ensureNotesRoot(notesRoot);

            // Auto-create system folders only for the default managed root
            if (resolved.isDefault) {
                await Promise.all(
                    SYSTEM_FOLDER_NAMES.map(name =>
                        mkdir(path.join(notesRoot, name), { recursive: true }),
                    ),
                );
            }

            const scan = await loadNativeNotesFs().notesTree(notesRoot, { isDefaultRoot: resolved.isDefault });
            const tree = shapeNotesTree(scan, { applyExplicitOrder: true });
            sendJSON(res, 200, {
                tree,
                notesRoot,
                rootId: resolved.rootId,
                systemFolders: resolved.isDefault ? SYSTEM_FOLDER_NAMES : [],
            });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/content?path=...&root=... — Read markdown
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/content$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const filePath = typeof parsed.query.path === 'string' ? parsed.query.path : '';
            if (!filePath) {
                return sendError(res, 400, 'Missing required query parameter: path');
            }

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            const notesRoot = rootResult.absolutePath;

            try {
                const note = await loadNativeNotesFs().readNote(notesRoot, filePath, {
                    isDefaultRoot: rootResult.isDefault,
                    allowedPrefixes: contentAllowedPrefixes(dataDir, ws.id, ws.rootPath),
                });
                sendJSON(res, 200, { content: note.content, path: filePath, mtime: note.mtimeMs });
            } catch (err: unknown) {
                const fsError = toNotesFsError(err);
                if (fsError.statusCode === 500) {
                    return sendError(res, 500, 'Failed to read file: ' + (fsError.message || 'Unknown error'));
                }
                return sendError(res, fsError.statusCode, fsError.message);
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/search?q=...&root=... — Full-text search
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/search$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const parsed = url.parse(req.url || '/', true);
            const query = typeof parsed.query.q === 'string' ? parsed.query.q : '';
            if (!query) {
                return sendError(res, 400, 'Missing required query parameter: q');
            }

            const rootParam = typeof parsed.query.root === 'string' ? parsed.query.root : undefined;
            const prefs = readRepoPreferences(dataDir, ws.id);
            const rootResult = resolveNotesRoot(dataDir, ws.id, ws.rootPath, rootParam, prefs.additionalNotesRoots);
            if (isRootResolveError(rootResult)) {
                return sendError(res, rootResult.statusCode, rootResult.error);
            }

            try {
                const result = await notesSearchService.search({
                    workspaceId: ws.id,
                    rootId: rootResult.rootId,
                    absolutePath: rootResult.absolutePath,
                    isDefault: rootResult.isDefault,
                    isTaskDerived: rootResult.isTaskDerived,
                }, query);
                sendJSON(res, 200, result);
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Unknown error';
                return sendError(res, 500, 'Failed to search notes: ' + message);
            }
        },
    });
}
