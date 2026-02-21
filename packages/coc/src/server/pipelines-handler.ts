/**
 * Pipelines REST API Handler
 *
 * HTTP API routes for pipeline CRUD operations: list (enriched),
 * read/write YAML content, create from template, and delete.
 *
 * Mirrors tasks-handler.ts pattern (separate read + write registration).
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { discoverPipelines } from '@plusplusoneplusplus/coc-server';
import { validatePipeline } from '../commands/validate';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PIPELINES_FOLDER = '.vscode/pipelines';

// ============================================================================
// Pipeline Templates
// ============================================================================

const TEMPLATES: Record<string, string> = {
    custom: `name: "My Pipeline"
description: "A custom pipeline"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    Analyze: {{title}}
    Return JSON with your analysis.
  output:
    - result
  parallel: 5

reduce:
  type: json
`,
    'data-fanout': `name: "Data Fanout Pipeline"
description: "Process data items in parallel"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    Process this item:
    Title: {{title}}
    Description: {{description}}

    Return JSON with category and summary.
  output:
    - category
    - summary
  parallel: 10

reduce:
  type: table
`,
    'model-fanout': `name: "Model Fanout Pipeline"
description: "Run the same prompt across multiple models"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    Analyze: {{title}}
    Provide a detailed assessment.
  output:
    - assessment
    - confidence
  parallel: 3

reduce:
  type: json
`,
    'ai-generated': `name: "AI Generated Pipeline"
description: "Template for AI-generated pipelines"

input:
  type: csv
  path: "input.csv"

map:
  prompt: |
    {{title}}
    {{description}}

    Analyze and return structured JSON.
  output:
    - analysis
  parallel: 5

reduce:
  type: json
`,
};

// ============================================================================
// Helpers
// ============================================================================

async function resolveWorkspace(store: ProcessStore, id: string) {
    const workspaces = await store.getWorkspaces();
    return workspaces.find(w => w.id === id);
}

/**
 * Resolve a user-supplied path against a base directory and validate
 * that the result is inside (or equal to) the base directory.
 * Returns the resolved absolute path, or null if the check fails.
 */
function resolveAndValidatePath(base: string, name: string): string | null {
    const resolved = path.resolve(base, name);
    if (resolved === base || resolved.startsWith(base + path.sep)) {
        return resolved;
    }
    return null;
}

/** Enriched pipeline info with validation results. */
interface EnrichedPipeline {
    name: string;
    path: string;
    description?: string;
    isValid: boolean;
    validationErrors: string[];
}

/**
 * Discover pipelines and enrich each with description and validation info.
 */
function discoverAndEnrichPipelines(pipelinesDir: string): EnrichedPipeline[] {
    const basic = discoverPipelines(pipelinesDir);
    return basic.map(p => {
        const yamlPath = path.join(p.path, 'pipeline.yaml');
        let description: string | undefined;
        let isValid = false;
        let validationErrors: string[] = [];

        // Read description from raw YAML
        try {
            const content = fs.readFileSync(yamlPath, 'utf-8');
            const parsed = yaml.load(content) as any;
            if (parsed && typeof parsed === 'object' && typeof parsed.description === 'string') {
                description = parsed.description;
            }
        } catch {
            // Ignore read errors — validation will catch them
        }

        // Validate pipeline
        try {
            const result = validatePipeline(yamlPath);
            isValid = result.valid;
            validationErrors = result.checks
                .filter(c => c.status === 'fail')
                .map(c => c.detail ?? c.label);
        } catch {
            isValid = false;
            validationErrors = ['Failed to validate pipeline'];
        }

        return { name: p.name, path: p.path, description, isValid, validationErrors };
    });
}

// ============================================================================
// Read Route Registration
// ============================================================================

/**
 * Register pipeline read-only API routes on the given route table.
 */
export function registerPipelineRoutes(
    routes: Route[],
    store: ProcessStore,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/pipelines/:pipelineName/content
    // Returns YAML content of a pipeline.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/([^/]+)\/content$/,
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
                : DEFAULT_PIPELINES_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid pipeline name');
            }

            const yamlPath = path.join(resolvedDir, 'pipeline.yaml');

            try {
                const content = await fs.promises.readFile(yamlPath, 'utf-8');
                sendJSON(res, 200, { content, path: yamlPath });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'Pipeline not found');
                }
                return sendError(res, 500, 'Failed to read pipeline: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/pipelines — List all pipelines (enriched)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_PIPELINES_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);
            const pipelines = discoverAndEnrichPipelines(pipelinesDir);
            sendJSON(res, 200, { pipelines });
        },
    });
}

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register pipeline mutation API routes on the given route table.
 */
export function registerPipelineWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    onPipelinesChanged?: (workspaceId: string) => void,
): void {

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/pipelines/:pipelineName/content
    // Update YAML content of a pipeline.
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/([^/]+)\/content$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const pipelineName = decodeURIComponent(match![2]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { content } = body || {};
            if (content === undefined || content === null || typeof content !== 'string') {
                return sendError(res, 400, 'Missing required field: content');
            }

            // Validate YAML syntax
            try {
                yaml.load(content);
            } catch (err: any) {
                return sendError(res, 400, 'Invalid YAML: ' + (err.message || 'Parse error'));
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_PIPELINES_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid pipeline name');
            }

            const yamlPath = path.join(resolvedDir, 'pipeline.yaml');

            // Ensure the pipeline directory exists
            try {
                await fs.promises.stat(yamlPath);
            } catch {
                return sendError(res, 404, 'Pipeline not found');
            }

            try {
                await fs.promises.writeFile(yamlPath, content, 'utf-8');
                onPipelinesChanged?.(id);
                sendJSON(res, 200, { path: yamlPath });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write pipeline: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/pipelines/:pipelineName
    // Delete a pipeline package directory recursively.
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/([^/]+)$/,
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
                : DEFAULT_PIPELINES_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid pipeline name');
            }

            // Check existence
            try {
                const stat = await fs.promises.stat(resolvedDir);
                if (!stat.isDirectory()) {
                    return sendError(res, 404, 'Pipeline not found');
                }
            } catch {
                return sendError(res, 404, 'Pipeline not found');
            }

            try {
                fs.rmSync(resolvedDir, { recursive: true, force: true });
                onPipelinesChanged?.(id);
                sendJSON(res, 200, { deleted: pipelineName });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to delete pipeline: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/pipelines — Create pipeline from template
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON body');
            }

            const { name, template } = body || {};
            if (!name || typeof name !== 'string' || !name.trim()) {
                return sendError(res, 400, 'Missing required field: name');
            }

            const trimmedName = name.trim();

            // Block path separators and traversal
            if (trimmedName.includes('/') || trimmedName.includes('\\') || trimmedName.includes('..')) {
                return sendError(res, 403, 'Access denied: invalid pipeline name');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_PIPELINES_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, trimmedName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid pipeline name');
            }

            // Check if directory already exists
            try {
                await fs.promises.stat(resolvedDir);
                return sendError(res, 409, 'Pipeline already exists');
            } catch {
                // Expected — directory does not exist
            }

            const templateKey = (typeof template === 'string' && template) ? template : 'custom';
            const templateContent = TEMPLATES[templateKey];
            if (!templateContent) {
                return sendError(res, 400, `Unknown template: ${templateKey}. Valid templates: ${Object.keys(TEMPLATES).join(', ')}`);
            }

            try {
                fs.mkdirSync(resolvedDir, { recursive: true });
                fs.writeFileSync(path.join(resolvedDir, 'pipeline.yaml'), templateContent, 'utf-8');
                onPipelinesChanged?.(id);
                sendJSON(res, 201, { name: trimmedName, path: resolvedDir, template: templateKey });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to create pipeline: ' + (err.message || 'Unknown error'));
            }
        },
    });
}
