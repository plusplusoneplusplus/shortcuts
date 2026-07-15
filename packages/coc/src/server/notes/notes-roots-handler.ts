/**
 * Notes Roots Management REST API Handler
 *
 * Dedicated endpoints for listing, adding, and removing additional notes roots
 * for a workspace. The default managed root is always present and cannot be removed.
 *
 * Endpoints:
 *   GET    /api/workspaces/:id/notes/roots       — list all roots (default + additional)
 *   POST   /api/workspaces/:id/notes/roots       — add a new root
 *   DELETE /api/workspaces/:id/notes/roots        — remove a root
 */

import * as path from 'path';
import { sendJSON, sendError } from '../core/api-handler';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import { readRepoPreferences, writeRepoPreferences } from '../preferences-handler';
import {
    canonicalizeExistingNotesDirectory,
    DEFAULT_ROOT_ID,
    discoverTaskDerivedNotesRoots,
    MAX_ADDITIONAL_NOTES_ROOTS,
    validateNotesRootPath,
} from './notes-root-resolver';
import { taskRootPathComparisonKey } from '../tasks/task-root-resolver';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

export interface NotesRootEntry {
    /** 'default' for the managed root, or the relative path for repo-folder roots. */
    rootId: string;
    /** Display label for the root. */
    label: string;
    /** Whether this is the default managed root (always present, cannot be removed). */
    isDefault: boolean;
    /** Task-derived collections are protected and managed through task settings. */
    isProtected?: boolean;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register notes roots management API routes on the given route table.
 */
export function registerNotesRootsRoutes(
    routes: Route[],
    store: ProcessStore,
    dataDir: string,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/notes/roots — List all configured roots
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/roots$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const prefs = readRepoPreferences(dataDir, ws.id);
            const additional = prefs.additionalNotesRoots ?? [];
            const taskRoots = discoverTaskDerivedNotesRoots(dataDir, ws.id, ws.rootPath);
            const taskRootPaths = new Set(
                taskRoots.map(root => taskRootPathComparisonKey(root.absolutePath)),
            );
            const visibleAdditional = additional.filter(rootPath => {
                const canonicalPath = canonicalizeExistingNotesDirectory(path.resolve(ws.rootPath, rootPath));
                return !canonicalPath || !taskRootPaths.has(taskRootPathComparisonKey(canonicalPath));
            });

            const roots: NotesRootEntry[] = [
                { rootId: DEFAULT_ROOT_ID, label: 'Notes', isDefault: true },
                ...taskRoots.map(root => ({
                    rootId: root.rootId,
                    label: root.label,
                    isDefault: false,
                    isProtected: true,
                })),
                ...visibleAdditional.map(r => ({
                    rootId: r,
                    label: r,
                    isDefault: false,
                })),
            ];

            sendJSON(res, 200, { roots, maxAdditionalRoots: MAX_ADDITIONAL_NOTES_ROOTS });
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/notes/roots — Add a new root
    // Body: { rootPath: string }
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/roots$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (!body) return;

            const rawPath = body.rootPath;
            if (typeof rawPath !== 'string' || !rawPath.trim()) {
                return sendError(res, 400, 'Missing required field: rootPath');
            }

            // Validate the path format
            const validationError = validateNotesRootPath(rawPath);
            if (validationError) {
                return sendError(res, 400, validationError);
            }

            // Normalize
            const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');

            const prefs = readRepoPreferences(dataDir, ws.id);
            const existing = prefs.additionalNotesRoots ?? [];

            // Check for duplicates
            if (existing.includes(normalized)) {
                return sendError(res, 409, `Root '${normalized}' is already configured.`);
            }

            // Check max limit
            if (existing.length >= MAX_ADDITIONAL_NOTES_ROOTS) {
                return sendError(res, 400, `Maximum of ${MAX_ADDITIONAL_NOTES_ROOTS} additional roots allowed.`);
            }

            // Persist
            const updated = { ...prefs, additionalNotesRoots: [...existing, normalized] };
            writeRepoPreferences(dataDir, ws.id, updated);

            sendJSON(res, 201, {
                rootId: normalized,
                label: normalized,
                isDefault: false,
            });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/notes/roots — Remove a root
    // Body: { rootPath: string }
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/notes\/roots$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (!body) return;

            const rawPath = body.rootPath;
            if (typeof rawPath !== 'string' || !rawPath.trim()) {
                return sendError(res, 400, 'Missing required field: rootPath');
            }

            // Cannot remove the default root
            const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
            if (normalized === DEFAULT_ROOT_ID || normalized === '') {
                return sendError(res, 400, 'Cannot remove the default managed root.');
            }
            if (discoverTaskDerivedNotesRoots(dataDir, ws.id, ws.rootPath)
                .some(root => root.rootId === normalized)) {
                return sendError(res, 400, 'Task-derived Notes roots are protected and managed through task settings.');
            }

            const prefs = readRepoPreferences(dataDir, ws.id);
            const existing = prefs.additionalNotesRoots ?? [];

            if (!existing.includes(normalized)) {
                return sendError(res, 404, `Root '${normalized}' is not configured.`);
            }

            const updated = {
                ...prefs,
                additionalNotesRoots: existing.filter(r => r !== normalized),
            };
            writeRepoPreferences(dataDir, ws.id, updated);

            sendJSON(res, 200, { removed: normalized });
        },
    });
}
