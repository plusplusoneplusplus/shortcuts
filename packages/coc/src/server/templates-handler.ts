/**
 * Templates REST API Handler
 *
 * HTTP API routes for template CRUD operations: list, read single,
 * create, update (merge), and delete.
 *
 * Templates are stored as `.vscode/templates/*.yaml` per workspace.
 * Mirrors workflows-handler.ts pattern (separate read + write registration).
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { isWithinDirectory } from '@plusplusoneplusplus/pipeline-core';
import { GitLogService } from '@plusplusoneplusplus/pipeline-core/git';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Constants
// ============================================================================

const TEMPLATES_DIR = '.vscode/templates';

// ============================================================================
// Helpers
// ============================================================================

async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

/**
 * Resolve a user-supplied template name against a base directory and validate
 * that the result is inside (or equal to) the base directory.
 * Returns the resolved absolute path, or null if the check fails.
 */
function resolveAndValidateTemplatePath(base: string, name: string): string | null {
    const resolved = path.resolve(base, name);
    if (isWithinDirectory(resolved, base)) {
        return resolved;
    }
    return null;
}

/**
 * Read and parse a single `.yaml` template file.
 * Returns null if the file cannot be read or parsed.
 */
async function readTemplateFile(filePath: string): Promise<Record<string, unknown> | null> {
    try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        const parsed = yaml.load(raw);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

// ============================================================================
// Read Route Registration
// ============================================================================

/**
 * Register template read-only API routes on the given route table.
 */
export function registerTemplateRoutes(routes: Route[], store: ProcessStore): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/templates — List all templates
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/templates$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
            let entries: string[];
            try {
                entries = await fs.promises.readdir(templatesDir);
            } catch {
                return sendJSON(res, 200, { templates: [] });
            }

            const yamlFiles = entries.filter(e => e.endsWith('.yaml') || e.endsWith('.yml'));
            const templates: Record<string, unknown>[] = [];

            for (const file of yamlFiles) {
                const filePath = path.join(templatesDir, file);
                const parsed = await readTemplateFile(filePath);
                if (parsed) {
                    parsed._fileName = path.basename(file, path.extname(file));
                    templates.push(parsed);
                }
            }

            sendJSON(res, 200, { templates });
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/templates/:name — Read single template
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const templateName = decodeURIComponent(match![2]);
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
            const filePath = resolveAndValidateTemplatePath(templatesDir, `${templateName}.yaml`);
            if (!filePath) {
                return sendError(res, 403, 'Access denied: invalid template name');
            }

            const parsed = await readTemplateFile(filePath);
            if (!parsed) {
                return sendError(res, 404, 'Template not found');
            }

            // Enrich with commit metadata if this is a commit-kind template
            if (parsed.kind === 'commit' && typeof parsed.commitHash === 'string') {
                try {
                    const gitLog = new GitLogService();
                    const commit = gitLog.getCommit(ws.rootPath, parsed.commitHash);
                    if (commit) {
                        parsed._commit = {
                            shortHash: commit.shortHash,
                            subject: commit.subject,
                            authorName: commit.authorName,
                            date: commit.date,
                            relativeDate: commit.relativeDate,
                        };
                    }
                    gitLog.dispose();
                } catch {
                    // Git metadata is best-effort — swallow errors
                }
            }

            parsed._fileName = templateName;
            sendJSON(res, 200, parsed);
        },
    });
}

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register template mutation API routes on the given route table.
 */
export function registerTemplateWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    onTemplatesChanged?: (workspaceId: string) => void,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/templates — Create a new template
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/templates$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            // --- Validation ---
            const { name, kind, commitHash, description, hints } = body || {};

            if (!name || typeof name !== 'string' || !name.trim()) {
                return sendError(res, 400, 'Missing required field: name');
            }
            const trimmedName = name.trim();

            // Path safety: no slashes, no dot-dot
            if (trimmedName.includes('/') || trimmedName.includes('\\') || trimmedName.includes('..')) {
                return sendError(res, 403, 'Access denied: invalid template name');
            }

            if (!kind || typeof kind !== 'string') {
                return sendError(res, 400, 'Missing required field: kind');
            }
            if (kind !== 'commit') {
                return sendError(res, 400, `Unsupported template kind: ${kind}. Supported: commit`);
            }

            // Commit-kind requires commitHash
            if (kind === 'commit') {
                if (!commitHash || typeof commitHash !== 'string' || !commitHash.trim()) {
                    return sendError(res, 400, 'Missing required field: commitHash (required for commit kind)');
                }
            }

            // --- Check for conflict ---
            const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
            const resolvedPath = resolveAndValidateTemplatePath(templatesDir, `${trimmedName}.yaml`);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: invalid template name');
            }

            try {
                await fs.promises.stat(resolvedPath);
                return sendError(res, 409, 'Template already exists');
            } catch {
                // Good — file doesn't exist
            }

            // --- Build template object ---
            const template: Record<string, unknown> = {
                name: trimmedName,
                kind,
            };
            if (kind === 'commit') {
                template.commitHash = commitHash.trim();
            }
            if (description && typeof description === 'string') {
                template.description = description;
            }
            if (Array.isArray(hints) && hints.length > 0) {
                template.hints = hints.filter((h: unknown) => typeof h === 'string');
            }

            // --- Write file ---
            const yamlContent = yaml.dump(template, { lineWidth: 120, noRefs: true });
            await fs.promises.mkdir(templatesDir, { recursive: true });
            await fs.promises.writeFile(resolvedPath, yamlContent, 'utf-8');

            onTemplatesChanged?.(workspaceId);
            sendJSON(res, 201, { name: trimmedName, path: resolvedPath });
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/templates/:name — Update a template
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/,
        handler: async (req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const templateName = decodeURIComponent(match![2]);
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
            const resolvedPath = resolveAndValidateTemplatePath(templatesDir, `${templateName}.yaml`);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: invalid template name');
            }

            // Verify file exists
            try {
                await fs.promises.stat(resolvedPath);
            } catch {
                return sendError(res, 404, 'Template not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            if (!body || typeof body !== 'object') {
                return sendError(res, 400, 'Request body must be a JSON object');
            }

            // Read existing template, merge with updates
            const existing = await readTemplateFile(resolvedPath);
            if (!existing) {
                return sendError(res, 500, 'Failed to read existing template');
            }

            // Apply allowed field updates (whitelist approach)
            const allowedFields = ['description', 'hints', 'commitHash', 'kind'];
            for (const field of allowedFields) {
                if (field in body) {
                    existing[field] = body[field];
                }
            }

            // Re-validate after merge
            if (existing.kind === 'commit') {
                if (!existing.commitHash || typeof existing.commitHash !== 'string') {
                    return sendError(res, 400, 'commitHash is required for commit kind');
                }
            }

            // `name` field in YAML always matches the filename — do not allow rename via PATCH
            existing.name = templateName;

            // Remove internal fields before writing
            delete existing._fileName;
            delete existing._commit;

            const yamlContent = yaml.dump(existing, { lineWidth: 120, noRefs: true });
            await fs.promises.writeFile(resolvedPath, yamlContent, 'utf-8');

            onTemplatesChanged?.(workspaceId);
            sendJSON(res, 200, { name: templateName, path: resolvedPath });
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/templates/:name — Delete a template
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/templates\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const workspaceId = decodeURIComponent(match![1]);
            const templateName = decodeURIComponent(match![2]);
            const ws = await resolveWorkspace(store, workspaceId);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const templatesDir = path.join(ws.rootPath, TEMPLATES_DIR);
            const resolvedPath = resolveAndValidateTemplatePath(templatesDir, `${templateName}.yaml`);
            if (!resolvedPath) {
                return sendError(res, 403, 'Access denied: invalid template name');
            }

            try {
                await fs.promises.stat(resolvedPath);
            } catch {
                return sendError(res, 404, 'Template not found');
            }

            await fs.promises.unlink(resolvedPath);
            onTemplatesChanged?.(workspaceId);
            sendJSON(res, 200, { deleted: templateName });
        },
    });
}
