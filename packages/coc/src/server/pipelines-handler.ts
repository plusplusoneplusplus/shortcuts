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
import type { ProcessStore, CopilotSDKService } from '@plusplusoneplusplus/pipeline-core';
import type { CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
import type { RunPipelinePayload } from '@plusplusoneplusplus/coc-server';
import { denyAllPermissions, isWithinDirectory } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { discoverPipelines } from '@plusplusoneplusplus/coc-server';
import { validatePipeline } from '../commands/validate';
import type { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';

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
// Pipeline Schema Reference (embedded for AI prompt construction)
// ============================================================================

const PIPELINE_SCHEMA_REFERENCE = `# Pipeline YAML Schema Reference

## Two Pipeline Modes (mutually exclusive)

### Map-Reduce Mode (batch processing)
\`\`\`yaml
name: string                    # Required: Pipeline identifier
input: InputConfig              # Required: Data source
map: MapConfig                  # Required: Processing phase
reduce: ReduceConfig            # Required: Aggregation phase
parameters?: PipelineParameter[] # Optional: Top-level parameters
\`\`\`

### Single-Job Mode (one-shot AI call)
\`\`\`yaml
name: string                    # Required: Pipeline identifier
job: JobConfig                  # Required: Single AI job definition
parameters?: PipelineParameter[] # Optional: Template variable values
\`\`\`

Constraint: job and map are mutually exclusive.

## Input Configuration (exactly ONE of)
- items: inline array of objects
- from: { type: csv, path: "file.csv" } OR array of { model: "model-name" }
- generate: { prompt: string, schema: string[] }

Common options: parameters (shared values), limit (max items)

## Map Configuration
- prompt: string (or promptFile: string) — exactly one required
- output?: string[] — field names for JSON parsing (omit for text mode)
- model?: string — AI model override
- parallel?: number — concurrency (default: 5)
- timeoutMs?: number — timeout per item (default: 600000ms)
- batchSize?: number — items per AI call (default: 1; requires {{ITEMS}} if > 1)

Template variables: {{fieldName}} from input items, {{ITEMS}} for batch, {{paramName}} from parameters

## Reduce Configuration
- type: 'list' | 'table' | 'json' | 'csv' | 'text' | 'ai'
- For type='ai': prompt or promptFile required, optional output, model
- Template variables: {{RESULTS}}, {{COUNT}}, {{SUCCESS_COUNT}}, {{FAILURE_COUNT}}

## Job Configuration
- prompt: string (or promptFile: string) — exactly one required
- output?: string[] — field names for JSON parsing (omit for text mode)
- model?: string — AI model override
- Template variables: {{paramName}} from top-level parameters

## Filter Configuration (optional, pre-processing)
- type: 'rule' — rule-based with mode ('all'|'any') and rules array
- type: 'ai' — AI-based with prompt, output must include 'include' field
- type: 'hybrid' — combines rule + ai with combineMode ('and'|'or')

## Parameters
\`\`\`yaml
parameters:
  - name: string
    value: string
\`\`\`
Available as {{name}} in prompts. CLI override: --param name=value

## Key Rules
- name is always required
- job and map cannot coexist
- input must have exactly ONE source type
- map/job must have exactly ONE of prompt or promptFile
- AI reduce requires a prompt
- batchSize > 1 requires {{ITEMS}} in prompt
- Use parallel: 3-5 for most tasks
- Use reasonable timeouts (300s-900s depending on complexity)
`;

// ============================================================================
// AI Response Helpers
// ============================================================================

/**
 * Extract YAML content from an AI response that may contain markdown fences.
 */
export function extractYamlFromResponse(response: string): string {
    // 1. Try to extract from ```yaml ... ``` code blocks
    const yamlBlockMatch = response.match(/```(?:yaml|yml)\s*\n([\s\S]*?)```/);
    if (yamlBlockMatch) {
        return yamlBlockMatch[1].trim();
    }
    // 2. Try to extract from generic ``` ... ``` code blocks
    const genericBlockMatch = response.match(/```\s*\n([\s\S]*?)```/);
    if (genericBlockMatch) {
        return genericBlockMatch[1].trim();
    }
    // 3. Assume the entire response is YAML (strip leading/trailing whitespace)
    return response.trim();
}

const GENERATION_TIMEOUT_MS = 120_000; // 2 min — pure text generation, no tool use

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
    if (isWithinDirectory(resolved, base)) {
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
    bridge?: MultiRepoQueueExecutorBridge,
    aiService?: CopilotSDKService,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/pipelines/generate — AI pipeline generation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/generate$/,
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

            const { description, model } = body || {};
            if (!description || typeof description !== 'string' || !description.trim()) {
                return sendError(res, 400, 'Missing required field: description');
            }

            const systemPrompt = `You are a pipeline YAML generator. You produce valid pipeline YAML configurations and nothing else.
Output ONLY the raw YAML content. Do NOT wrap it in markdown code fences. Do NOT include any explanation before or after the YAML.

${PIPELINE_SCHEMA_REFERENCE}`;

            const userPrompt = `Generate a pipeline YAML configuration for the following requirement:\n\n${description.trim()}`;

            try {
                if (!aiService) {
                    return sendError(res, 503, 'AI service not configured');
                }
                const service = aiService;
                const available = await service.isAvailable();
                if (!available.available) {
                    return sendError(res, 503, 'AI service unavailable');
                }

                const result = await service.sendMessage({
                    prompt: systemPrompt + '\n\n' + userPrompt,
                    model: model || undefined,
                    workingDirectory: ws.rootPath,
                    timeoutMs: GENERATION_TIMEOUT_MS,
                    onPermissionRequest: denyAllPermissions,
                });

                if (!result.success) {
                    return sendError(res, 500, 'Pipeline generation failed: ' + (result.error || 'Unknown error'));
                }

                const raw = result.response || '';
                const extractedYaml = extractYamlFromResponse(raw);

                let valid = true;
                let validationError: string | undefined;
                try {
                    yaml.load(extractedYaml);
                } catch (err: any) {
                    valid = false;
                    validationError = err.message || 'YAML parse error';
                }

                sendJSON(res, 200, { yaml: extractedYaml, raw, valid, validationError });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes('timeout')) {
                    return sendError(res, 504, 'Pipeline generation timed out');
                }
                return sendError(res, 500, 'Pipeline generation failed: ' + message);
            }
        },
    });

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

            const { name, template, content: bodyContent } = body || {};
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

            let yamlContent: string;
            let usedTemplate: string;
            if (bodyContent && typeof bodyContent === 'string' && bodyContent.trim()) {
                // Validate YAML syntax
                try {
                    yaml.load(bodyContent);
                } catch (err: any) {
                    return sendError(res, 400, 'Invalid YAML: ' + (err.message || 'Parse error'));
                }
                yamlContent = bodyContent;
                usedTemplate = 'custom';
            } else {
                const templateKey = (typeof template === 'string' && template) ? template : 'custom';
                const templateContent = TEMPLATES[templateKey];
                if (!templateContent) {
                    return sendError(res, 400, `Unknown template: ${templateKey}. Valid templates: ${Object.keys(TEMPLATES).join(', ')}`);
                }
                yamlContent = templateContent;
                usedTemplate = templateKey;
            }

            try {
                fs.mkdirSync(resolvedDir, { recursive: true });
                fs.writeFileSync(path.join(resolvedDir, 'pipeline.yaml'), yamlContent, 'utf-8');
                onPipelinesChanged?.(id);
                sendJSON(res, 201, { name: trimmedName, path: resolvedDir, template: usedTemplate });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to create pipeline: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/pipelines/:name/run — Run a pipeline
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/pipelines\/([^/]+)\/run$/,
        handler: async (req, res, match) => {
            if (!bridge) {
                return sendError(res, 503, 'Queue system not available');
            }

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
                await fs.promises.stat(yamlPath);
            } catch {
                return sendError(res, 404, 'Pipeline not found');
            }

            // Parse optional body for overrides
            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // Empty body is fine — all fields are optional
            }

            const payload: RunPipelinePayload = {
                kind: 'run-pipeline',
                pipelinePath: resolvedDir,
                workingDirectory: ws.rootPath,
                model: body?.model,
                params: body?.params,
                workspaceId: id,
            };

            const taskInput: CreateTaskInput = {
                type: 'run-pipeline',
                priority: body?.priority || 'normal',
                payload: payload as unknown as Record<string, unknown>,
                config: { model: body?.model },
                displayName: `Run Pipeline: ${pipelineName}`,
            };

            bridge.getOrCreateBridge(ws.rootPath);
            const queueManager = bridge.registry.getQueueForRepo(ws.rootPath);
            const taskId = queueManager.enqueue(taskInput);

            sendJSON(res, 201, { taskId, pipelineName, queuedAt: Date.now() });
        },
    });
}
