/**
 * Workflow mutation REST API routes.
 *
 * Extracted from workflows-handler.ts to keep each module focused.
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import type { ProcessStore, ISDKService, MCPServerConfig } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { RunWorkflowPayload } from '../tasks/task-types';
import { TaskDefs } from '../tasks/task-types';
import { denyAllPermissions, loadEffectiveMcpConfig } from '@plusplusoneplusplus/forge';
import { sendJSON, sendError, parseBody } from '../core/api-handler';
import type { Route } from '../types';
import type { MultiRepoQueueRouter } from '../queue/multi-repo-queue-router';
import {
    DEFAULT_WORKFLOWS_FOLDER,
    TEMPLATES,
    WORKFLOW_SCHEMA_REFERENCE,
    GENERATION_TIMEOUT_MS,
    extractYamlFromResponse,
} from './workflow-constants';
import { resolveWorkspace, resolveAndValidatePath } from './workflow-utils';

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
    bridge?: MultiRepoQueueRouter,
    aiService?: ISDKService,
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
                const effectiveMcp = loadEffectiveMcpConfig({ workingDirectory: ws.rootPath });
                const allServers = effectiveMcp.mcpServers;
                resolvedMcpServers = Object.fromEntries(
                    ws.enabledMcpServers
                        .filter(key => key in allServers)
                        .map(key => [key, allServers[key]])
                );
            }

            const payload: RunWorkflowPayload = {
                kind: TaskDefs.runWorkflow.kind,
                workflowPath: resolvedDir,
                workingDirectory: ws.rootPath,
                model: body?.model,
                params: body?.params,
                workspaceId: id,
                mcpServers: resolvedMcpServers,          // undefined when null (global config)
            };

            const taskInput: CreateTaskInput = {
                type: TaskDefs.runWorkflow.kind,
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
