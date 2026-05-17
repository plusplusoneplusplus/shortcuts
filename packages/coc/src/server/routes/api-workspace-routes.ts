/**
 * Workspace REST API Routes
 *
 * Workspace CRUD, discovery, git-info (single + batch), MCP config, and skills config.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import type { MCPServerConfig, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { BranchService, loadDefaultMcpConfig, loadWorkspaceMcpConfig, detectRemoteUrl, resolvePathForHostFilesystem } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { handleAPIError, missingFields, notFound, badRequest } from '../errors';
import { gitCache } from '../git/git-cache';
import { gitInfoCache, type GitInfoResult } from '../git/git-info-cache';
import { resolveWorkspaceOrFail, parseBodyOrReject } from '../shared/handler-utils';
import type { ApiRouteContext } from './api-shared';
import {
    readEffectiveDisabledLlmTools,
    readGlobalPreferences,
    readRepoPreferences,
    writeRepoPreferences,
    validatePerRepoPreferences,
} from '../preferences-handler';
import { getEffectiveDefaultDisabledTools, getEffectiveLlmToolRegistry } from '../llm-tools/llm-tool-registry';

// Lazy singleton service
let _branchService: BranchService | undefined;
function getBranchService(): BranchService {
    if (!_branchService) { _branchService = new BranchService(); }
    return _branchService;
}

/**
 * Detect and persist the remote URL for a workspace if it has changed.
 */
async function syncRemoteUrl(ws: WorkspaceInfo, store: ProcessStore): Promise<string | undefined> {
    const remoteUrl = await detectRemoteUrl(ws.rootPath);
    if (remoteUrl && remoteUrl !== ws.remoteUrl) {
        await store.updateWorkspace(ws.id, { remoteUrl });
    }
    return remoteUrl;
}

function hasGitDirectory(rootPath: string): boolean {
    try {
        return fs.existsSync(resolvePathForHostFilesystem(rootPath, '.git'));
    } catch {
        return false;
    }
}

type WorkspaceMcpServerSource = 'global' | 'workspace';

interface WorkspaceMcpServerEntry {
    name: string;
    type: string;
    url?: string;
    command?: string;
    source?: WorkspaceMcpServerSource;
    effective?: boolean;
    overriddenBy?: WorkspaceMcpServerSource;
}

interface WorkspaceMcpSourceSection {
    configPath: string;
    fileExists: boolean;
    success: boolean;
    error?: string;
    servers: WorkspaceMcpServerEntry[];
}

function toMcpServerEntry(
    name: string,
    config: MCPServerConfig,
    source: WorkspaceMcpServerSource,
    effective: boolean,
): WorkspaceMcpServerEntry {
    return {
        name,
        type: config.type ?? 'stdio',
        source,
        effective,
        ...('url' in config && config.url ? { url: config.url } : {}),
        ...('command' in config && config.command ? { command: config.command } : {}),
        ...(!effective ? { overriddenBy: 'workspace' as const } : {}),
    };
}

function toMcpSourceSection(
    config: ReturnType<typeof loadDefaultMcpConfig>,
    servers: WorkspaceMcpServerEntry[],
): WorkspaceMcpSourceSection {
    return {
        configPath: config.configPath ?? '',
        fileExists: Boolean(config.fileExists),
        success: config.success !== false,
        ...(config.error ? { error: config.error } : {}),
        servers,
    };
}

function buildMcpConfigResponse(ws: WorkspaceInfo, forceReload = false) {
    const globalConfig = loadDefaultMcpConfig(forceReload);
    const workspaceConfig = loadWorkspaceMcpConfig(ws.rootPath, forceReload);
    const workspaceNames = new Set(Object.keys(workspaceConfig.mcpServers));

    const globalServers = Object.entries(globalConfig.mcpServers).map(([name, config]) =>
        toMcpServerEntry(name, config, 'global', !workspaceNames.has(name))
    );
    const workspaceServers = Object.entries(workspaceConfig.mcpServers).map(([name, config]) =>
        toMcpServerEntry(name, config, 'workspace', true)
    );
    const availableServers = Object.entries({
        ...globalConfig.mcpServers,
        ...workspaceConfig.mcpServers,
    }).map(([name, config]) =>
        toMcpServerEntry(name, config, workspaceNames.has(name) ? 'workspace' : 'global', true)
    );

    return {
        availableServers,
        enabledMcpServers: ws.enabledMcpServers ?? null,
        sources: {
            global: toMcpSourceSection(globalConfig, globalServers),
            workspace: toMcpSourceSection(workspaceConfig, workspaceServers),
        },
    };
}

/**
 * Fetch git-info for a single workspace by ID.
 * Used by both the HTTP handler and the GitInfoCacheService background refresh.
 */
async function fetchOneGitInfo(workspaceId: string, store: ProcessStore): Promise<GitInfoResult> {
    const workspaces = await store.getWorkspaces();
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) {
        throw new Error(`Workspace ${workspaceId} not found`);
    }

    const dirty = await getBranchService().hasUncommittedChanges(ws.rootPath);
    const branchStatus = await getBranchService().getBranchStatus(ws.rootPath, dirty);

    if (!branchStatus) {
        const remoteUrl = await syncRemoteUrl(ws, store);
        return { branch: null, dirty: false, isGitRepo: false, remoteUrl: remoteUrl || null };
    }

    const remoteUrl = await syncRemoteUrl(ws, store);
    return {
        branch: branchStatus.name || 'HEAD',
        dirty,
        ahead: branchStatus.ahead,
        behind: branchStatus.behind,
        isGitRepo: true,
        remoteUrl: remoteUrl || null,
    };
}


export function registerApiWorkspaceRoutes(ctx: ApiRouteContext): void {
    const { routes, store } = ctx;

    // Start the git-info cache background refresh for this server instance
    gitInfoCache.start(store, (wsId) => fetchOneGitInfo(wsId, store));

    // POST /api/workspaces — Register a workspace
    routes.push({
        method: 'POST',
        pattern: '/api/workspaces',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.id || !body.name || !body.rootPath) {
                return handleAPIError(res, missingFields(['id', 'name', 'rootPath']));
            }

            let remoteUrl: string | undefined = body.remoteUrl;
            if (!remoteUrl) {
                remoteUrl = await detectRemoteUrl(body.rootPath);
            }

            const workspace: WorkspaceInfo = {
                id: body.id,
                name: body.name,
                rootPath: body.rootPath,
                color: body.color,
                remoteUrl,
            };

            await store.registerWorkspace(workspace);
            sendJSON(res, 201, workspace);
        },
    });

    // GET /api/workspaces — List all workspaces
    routes.push({
        method: 'GET',
        pattern: '/api/workspaces',
        handler: async (_req, res) => {
            const workspaces = await store.getWorkspaces();
            const enriched = workspaces.map(ws => ({
                ...ws,
                isGitRepo: hasGitDirectory(ws.rootPath),
            }));
            sendJSON(res, 200, { workspaces: enriched });
        },
    });

    // GET /api/workspaces/discover?path=<dir> — Scan a directory for git repos not yet registered
    routes.push({
        method: 'GET',
        pattern: '/api/workspaces/discover',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '', true);
            const dirPath = parsed.query['path'] as string | undefined;

            if (!dirPath) {
                return handleAPIError(res, badRequest('path query parameter is required'));
            }

            const resolvedPath = path.resolve(dirPath);

            if (!fs.existsSync(resolvedPath)) {
                return handleAPIError(res, badRequest('path does not exist'));
            }

            let stat: fs.Stats;
            try {
                stat = fs.statSync(resolvedPath);
            } catch {
                return handleAPIError(res, badRequest('path is not accessible'));
            }

            if (!stat.isDirectory()) {
                return handleAPIError(res, badRequest('path is not a directory'));
            }

            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
            } catch {
                return handleAPIError(res, badRequest('unable to read directory'));
            }

            const existingWorkspaces = await store.getWorkspaces();
            const registeredPaths = new Set(
                existingWorkspaces.map(ws => path.resolve(ws.rootPath))
            );

            const repos: Array<{ path: string; name: string }> = [];

            // Check if the scanned directory itself is a git repo
            if (fs.existsSync(path.join(resolvedPath, '.git'))) {
                if (!registeredPaths.has(resolvedPath)) {
                    repos.push({ path: resolvedPath, name: path.basename(resolvedPath) });
                }
            }

            // Scan direct child directories for git repos
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const childPath = path.join(resolvedPath, entry.name);
                if (!fs.existsSync(path.join(childPath, '.git'))) continue;
                if (registeredPaths.has(path.resolve(childPath))) continue;
                repos.push({ path: childPath, name: path.basename(childPath) });
            }

            sendJSON(res, 200, { repos });
        },
    });

    // DELETE /api/workspaces/:id — Remove a workspace
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const removed = await store.removeWorkspace(id);
            if (!removed) {
                return handleAPIError(res, notFound('Workspace'));
            }
            res.writeHead(204);
            res.end();
        },
    });

    // PATCH /api/workspaces/:id — Update workspace fields
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const updates: Partial<Omit<WorkspaceInfo, 'id'>> = {};
            if (body.name !== undefined) { updates.name = body.name; }
            if (body.color !== undefined) { updates.color = body.color; }
            if (body.rootPath !== undefined) { updates.rootPath = body.rootPath; }
            if (body.remoteUrl !== undefined) { updates.remoteUrl = body.remoteUrl; }
            if (body.description !== undefined) { updates.description = body.description; }

            const updated = await store.updateWorkspace(id, updates);
            if (!updated) {
                return handleAPIError(res, notFound('Workspace'));
            }
            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/git-info — Git branch and status
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git-info$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const dirty = await getBranchService().hasUncommittedChanges(ws.rootPath);
            const branchStatus = await getBranchService().getBranchStatus(ws.rootPath, dirty);

            if (!branchStatus) {
                const remoteUrl = await syncRemoteUrl(ws, store);
                sendJSON(res, 200, { branch: null, dirty: false, isGitRepo: false, remoteUrl: remoteUrl || null });
                return;
            }

            const branch = branchStatus.name || 'HEAD';
            const remoteUrl = await syncRemoteUrl(ws, store);
            const ahead = branchStatus.ahead;
            const behind = branchStatus.behind;

            sendJSON(res, 200, { branch, dirty, ahead, behind, isGitRepo: true, remoteUrl: remoteUrl || null });
        },
    });

    // POST /api/git-info/batch — Fetch git-info for multiple workspaces in one round-trip
    routes.push({
        method: 'POST',
        pattern: '/api/git-info/batch',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const { workspaceIds } = body;
            if (!Array.isArray(workspaceIds)) {
                return handleAPIError(res, missingFields(['workspaceIds']));
            }

            const workspaces = await store.getWorkspaces();
            const knownIds = new Set(workspaces.map(w => w.id));

            const CONCURRENCY = 4;
            const results: Record<string, any> = {};
            for (let i = 0; i < workspaceIds.length; i += CONCURRENCY) {
                const batch = workspaceIds.slice(i, i + CONCURRENCY);
                await Promise.all(batch.map(async (wsId: string) => {
                    if (!knownIds.has(wsId)) { results[wsId] = null; return; }
                    try {
                        results[wsId] = await gitInfoCache.getOrFetch(wsId);
                    } catch {
                        results[wsId] = null;
                    }
                }));
            }

            sendJSON(res, 200, { results });
        },
    });

    // GET /api/workspaces/:id/mcp-config — Get available MCP servers and workspace-enabled list
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const parsed = url.parse(req.url || '/', true);
            const forceReload = parsed.query.forceReload === 'true' || parsed.query.refresh === 'true';
            sendJSON(res, 200, buildMcpConfigResponse(ws, forceReload));
        },
    });

    // PUT /api/workspaces/:id/mcp-config — Save workspace-enabled MCP server list
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Object.prototype.hasOwnProperty.call(body, 'enabledMcpServers')) {
                return handleAPIError(res, missingFields(['enabledMcpServers']));
            }
            if (body.enabledMcpServers !== null && !Array.isArray(body.enabledMcpServers)) {
                return handleAPIError(res, badRequest('`enabledMcpServers` must be an array of strings or null'));
            }
            if (Array.isArray(body.enabledMcpServers) && body.enabledMcpServers.some((e: any) => typeof e !== 'string')) {
                return handleAPIError(res, badRequest('`enabledMcpServers` items must be strings'));
            }
            const updated = await store.updateWorkspace(id, { enabledMcpServers: body.enabledMcpServers });
            if (!updated) {
                return handleAPIError(res, notFound('Workspace'));
            }
            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/skills-config — Get workspace skill list and disabled skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills-config$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const disabledSkills: string[] = ws.disabledSkills ?? [];
            const extraSkillFolders: string[] = ws.extraSkillFolders ?? [];
            sendJSON(res, 200, { disabledSkills, extraSkillFolders });
        },
    });

    // PUT /api/workspaces/:id/skills-config — Save workspace disabled skills list
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Object.prototype.hasOwnProperty.call(body, 'disabledSkills')) {
                return handleAPIError(res, missingFields(['disabledSkills']));
            }
            if (!Array.isArray(body.disabledSkills)) {
                return handleAPIError(res, badRequest('`disabledSkills` must be an array of strings'));
            }
            if (body.disabledSkills.some((e: any) => typeof e !== 'string')) {
                return handleAPIError(res, badRequest('`disabledSkills` items must be strings'));
            }
            const wsUpdates: Partial<Omit<WorkspaceInfo, 'id'>> = { disabledSkills: body.disabledSkills };
            if (Object.prototype.hasOwnProperty.call(body, 'extraSkillFolders')) {
                if (!Array.isArray(body.extraSkillFolders)) {
                    return handleAPIError(res, badRequest('`extraSkillFolders` must be an array of strings'));
                }
                if (body.extraSkillFolders.some((e: any) => typeof e !== 'string')) {
                    return handleAPIError(res, badRequest('`extraSkillFolders` items must be strings'));
                }
                wsUpdates.extraSkillFolders = body.extraSkillFolders;
            }
            const updated = await store.updateWorkspace(id, wsUpdates);
            if (!updated) {
                return handleAPIError(res, notFound('Workspace'));
            }
            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/llm-tools-config — Get LLM tool registry and disabled state
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/llm-tools-config$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const effectiveRegistry = getEffectiveLlmToolRegistry({ loopsEnabled: ctx.loopsEnabled });
            if (!ctx.dataDir) {
                sendJSON(res, 200, { tools: effectiveRegistry, disabledLlmTools: getEffectiveDefaultDisabledTools() });
                return;
            }
            sendJSON(res, 200, {
                tools: effectiveRegistry,
                disabledLlmTools: readEffectiveDisabledLlmTools(ctx.dataDir, ws.id),
            });
        },
    });

    // PUT /api/workspaces/:id/llm-tools-config — Save disabled LLM tools list
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/llm-tools-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            if (!ctx.dataDir) {
                return handleAPIError(res, badRequest('dataDir not configured'));
            }
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Object.prototype.hasOwnProperty.call(body, 'disabledLlmTools')) {
                return handleAPIError(res, missingFields(['disabledLlmTools']));
            }
            if (!Array.isArray(body.disabledLlmTools)) {
                return handleAPIError(res, badRequest('`disabledLlmTools` must be an array of strings'));
            }
            if (body.disabledLlmTools.some((e: any) => typeof e !== 'string')) {
                return handleAPIError(res, badRequest('`disabledLlmTools` items must be strings'));
            }
            const existing = readRepoPreferences(ctx.dataDir, ws.id);
            const merged = validatePerRepoPreferences({
                ...existing,
                disabledLlmTools: body.disabledLlmTools,
            });
            writeRepoPreferences(ctx.dataDir, ws.id, merged);
            const globalPrefs = readGlobalPreferences(ctx.dataDir);
            sendJSON(res, 200, {
                tools: getEffectiveLlmToolRegistry({ loopsEnabled: ctx.loopsEnabled }),
                disabledLlmTools: merged.disabledLlmTools ?? getEffectiveDefaultDisabledTools(globalPrefs.uiLayoutMode),
            });
        },
    });
}
