/**
 * Workflows REST API Handler
 *
 * HTTP API routes for workflow CRUD operations: list (enriched),
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
import type { ProcessStore, CopilotSDKService, MCPServerConfig } from '@plusplusoneplusplus/pipeline-core';
import type { CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
import type { RunWorkflowPayload } from '@plusplusoneplusplus/coc-server';
import { denyAllPermissions, isWithinDirectory, loadDefaultMcpConfig } from '@plusplusoneplusplus/pipeline-core';
import { sendJSON, sendError, parseBody } from '@plusplusoneplusplus/coc-server';
import type { Route } from '@plusplusoneplusplus/coc-server';
import { discoverPipelines } from '@plusplusoneplusplus/coc-server';
import { validatePipeline } from '../commands/validate';
import type { MultiRepoQueueExecutorBridge } from './multi-repo-executor-bridge';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_WORKFLOWS_FOLDER = '.vscode/workflows';

// ============================================================================
// Workflow Templates
// ============================================================================

const TEMPLATES: Record<string, string> = {
    custom: `name: "My Workflow"
description: "A custom workflow"

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
    'data-fanout': `name: "Data Fanout Workflow"
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
    'model-fanout': `name: "Model Fanout Workflow"
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
    'ai-generated': `name: "AI Generated Workflow"
description: "Template for AI-generated workflows"

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
// Workflow Schema Reference (embedded for AI prompt construction)
// ============================================================================

const WORKFLOW_SCHEMA_REFERENCE = `# Workflow YAML Schema Reference

## Two Workflow Modes (mutually exclusive)

### Map-Reduce Mode (batch processing)
\`\`\`yaml
name: string                    # Required: Workflow identifier
input: InputConfig              # Required: Data source
map: MapConfig                  # Required: Processing phase
reduce: ReduceConfig            # Required: Aggregation phase
parameters?: WorkflowParameter[] # Optional: Top-level parameters
\`\`\`

### Single-Job Mode (one-shot AI call)
\`\`\`yaml
name: string                    # Required: Workflow identifier
job: JobConfig                  # Required: Single AI job definition
parameters?: WorkflowParameter[] # Optional: Template variable values
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

/** Enriched workflow info with validation results. */
interface EnrichedWorkflow {
    name: string;
    path: string;
    description?: string;
    isValid: boolean;
    validationErrors: string[];
}

/**
 * Discover workflows and enrich each with description and validation info.
 */
function discoverAndEnrichWorkflows(pipelinesDir: string): EnrichedWorkflow[] {
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

        // Validate workflow
        try {
            const result = validatePipeline(yamlPath);
            isValid = result.valid;
            validationErrors = result.checks
                .filter(c => c.status === 'fail')
                .map(c => c.detail ?? c.label);
        } catch {
            isValid = false;
            validationErrors = ['Failed to validate workflow'];
        }

        return { name: p.name, path: p.path, description, isValid, validationErrors };
    });
}

// ============================================================================
// Read Route Registration
// ============================================================================

/**
 * Register workflow read-only API routes on the given route table.
 */
export function registerWorkflowRoutes(
    routes: Route[],
    store: ProcessStore,
): void {

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/workflows/:pipelineName/content
    // Returns YAML content of a workflow.
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/([^/]+)\/content$/,
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
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            const yamlPath = path.join(resolvedDir, 'pipeline.yaml');

            try {
                const content = await fs.promises.readFile(yamlPath, 'utf-8');
                sendJSON(res, 200, { content, path: yamlPath });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return sendError(res, 404, 'Workflow not found');
                }
                return sendError(res, 500, 'Failed to read workflow: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // GET /api/workspaces/:id/workflows — List all workflows (enriched)
    // ------------------------------------------------------------------
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const ws = await resolveWorkspace(store, id);
            if (!ws) {
                return sendError(res, 404, 'Workspace not found');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);
            const pipelines = discoverAndEnrichWorkflows(pipelinesDir);
            sendJSON(res, 200, { workflows: pipelines });
        },
    });
}

// ============================================================================
// Write Route Registration
// ============================================================================

/**
 * Register workflow mutation API routes on the given route table.
 */
export function registerWorkflowWriteRoutes(
    routes: Route[],
    store: ProcessStore,
    onPipelinesChanged?: (workspaceId: string) => void,
    bridge?: MultiRepoQueueExecutorBridge,
    aiService?: CopilotSDKService,
): void {

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/workflows/generate — AI workflow generation
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/generate$/,
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

            const systemPrompt = `You are a workflow YAML generator. You produce valid workflow YAML configurations and nothing else.
Output ONLY the raw YAML content. Do NOT wrap it in markdown code fences. Do NOT include any explanation before or after the YAML.
The YAML must include a top-level "name" field. Choose a short, descriptive kebab-case name based on the user's requirement.

${WORKFLOW_SCHEMA_REFERENCE}`;

            const userPrompt = `Generate a workflow YAML configuration for the following requirement:\n\n${description.trim()}`;

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
                    return sendError(res, 500, 'Workflow generation failed: ' + (result.error || 'Unknown error'));
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

                // Extract suggested name from the generated YAML
                let suggestedName: string | undefined;
                try {
                    const parsed = yaml.load(extractedYaml) as any;
                    if (parsed && typeof parsed === 'object' && typeof parsed.name === 'string' && parsed.name.trim()) {
                        suggestedName = parsed.name.trim()
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, '-')
                            .replace(/^-|-$/g, '');
                    }
                } catch {
                    // YAML parse already handled above — suggestedName stays undefined
                }

                sendJSON(res, 200, { yaml: extractedYaml, raw, valid, validationError, suggestedName });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.toLowerCase().includes('timeout')) {
                    return sendError(res, 504, 'Workflow generation timed out');
                }
                return sendError(res, 500, 'Workflow generation failed: ' + message);
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/workflows/refine — AI workflow refinement
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/refine$/,
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

            const { currentYaml, instruction, model } = body || {};
            if (!currentYaml || typeof currentYaml !== 'string' || !currentYaml.trim()) {
                return sendError(res, 400, 'Missing required field: currentYaml');
            }
            if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
                return sendError(res, 400, 'Missing required field: instruction');
            }

            // Validate that currentYaml is parseable YAML
            try {
                yaml.load(currentYaml);
            } catch (err: any) {
                return sendError(res, 400, 'Invalid YAML: ' + (err.message || 'Parse error'));
            }

            const systemPrompt = `You are a workflow YAML editor. You modify existing workflow YAML configurations based on user instructions.
Output ONLY the complete modified YAML. Do NOT wrap in markdown code fences. Do NOT include any explanation before or after the YAML.

${WORKFLOW_SCHEMA_REFERENCE}`;

            const userPrompt = `Here is the current workflow YAML:

${currentYaml.trim()}

Apply the following change:

${instruction.trim()}

Return the complete modified workflow YAML.`;

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
                    return sendError(res, 500, 'Workflow refinement failed: ' + (result.error || 'Unknown error'));
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
                    return sendError(res, 504, 'Workflow refinement timed out');
                }
                return sendError(res, 500, 'Workflow refinement failed: ' + message);
            }
        },
    });

    // ------------------------------------------------------------------
    // PATCH /api/workspaces/:id/workflows/:pipelineName/content
    // Update YAML content of a workflow.
    // ------------------------------------------------------------------
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/([^/]+)\/content$/,
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
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            const yamlPath = path.join(resolvedDir, 'pipeline.yaml');

            // Ensure the workflow directory exists
            try {
                await fs.promises.stat(yamlPath);
            } catch {
                return sendError(res, 404, 'Workflow not found');
            }

            try {
                await fs.promises.writeFile(yamlPath, content, 'utf-8');
                onPipelinesChanged?.(id);
                sendJSON(res, 200, { path: yamlPath });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to write workflow: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // DELETE /api/workspaces/:id/workflows/:pipelineName
    // Delete a workflow package directory recursively.
    // ------------------------------------------------------------------
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/([^/]+)$/,
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
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            // Check existence
            try {
                const stat = await fs.promises.stat(resolvedDir);
                if (!stat.isDirectory()) {
                    return sendError(res, 404, 'Workflow not found');
                }
            } catch {
                return sendError(res, 404, 'Workflow not found');
            }

            try {
                fs.rmSync(resolvedDir, { recursive: true, force: true });
                onPipelinesChanged?.(id);
                sendJSON(res, 200, { deleted: pipelineName });
            } catch (err: any) {
                return sendError(res, 500, 'Failed to delete workflow: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/workflows — Create workflow from template
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows$/,
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
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            const parsed = url.parse(req.url || '/', true);
            const folder = (typeof parsed.query.folder === 'string' && parsed.query.folder)
                ? parsed.query.folder
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, trimmedName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            // Check if directory already exists
            try {
                await fs.promises.stat(resolvedDir);
                return sendError(res, 409, 'Workflow already exists');
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
                return sendError(res, 500, 'Failed to create workflow: ' + (err.message || 'Unknown error'));
            }
        },
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/workflows/:name/run — Run a workflow
    // ------------------------------------------------------------------
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/workflows\/([^/]+)\/run$/,
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
                : DEFAULT_WORKFLOWS_FOLDER;
            const pipelinesDir = path.resolve(ws.rootPath, folder);

            const resolvedDir = resolveAndValidatePath(pipelinesDir, pipelineName);
            if (!resolvedDir) {
                return sendError(res, 403, 'Access denied: invalid workflow name');
            }

            const yamlPath = path.join(resolvedDir, 'pipeline.yaml');
            try {
                await fs.promises.stat(yamlPath);
            } catch {
                return sendError(res, 404, 'Workflow not found');
            }

            // Parse optional body for overrides
            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                // Empty body is fine — all fields are optional
            }

            // Resolve MCP filter
            let resolvedMcpServers: Record<string, MCPServerConfig> | undefined;
            if (Array.isArray(ws.enabledMcpServers)) {
                const defaultMcp = loadDefaultMcpConfig();
                const allServers = defaultMcp.mcpServers;
                resolvedMcpServers = Object.fromEntries(
                    ws.enabledMcpServers
                        .filter(key => key in allServers)
                        .map(key => [key, allServers[key]])
                );
            }

            const payload: RunWorkflowPayload = {
                kind: 'run-workflow',
                workflowPath: resolvedDir,
                workingDirectory: ws.rootPath,
                model: body?.model,
                params: body?.params,
                workspaceId: id,
                mcpServers: resolvedMcpServers,          // undefined when null (global config)
            };

            const taskInput: CreateTaskInput = {
                type: 'run-workflow',
                priority: body?.priority || 'normal',
                payload: payload as unknown as Record<string, unknown>,
                config: { model: body?.model },
                displayName: `Run Workflow: ${pipelineName}`,
            };

            bridge.getOrCreateBridge(ws.rootPath);
            const queueManager = bridge.registry.getQueueForRepo(ws.rootPath);
            const taskId = queueManager.enqueue(taskInput);

            sendJSON(res, 201, { taskId, pipelineName, queuedAt: Date.now() });
        },
    });
}
