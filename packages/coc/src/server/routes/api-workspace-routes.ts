/**
 * Workspace REST API Routes
 *
 * Workspace CRUD, discovery, git-info (single + batch), MCP config, and skills config.
 * Extracted from `api-handler.ts` to keep each route module focused on one domain.
 */

import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { MCPServerConfig, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { BranchService, loadDefaultMcpConfig, loadWorkspaceMcpConfig, detectRemoteUrl, resolvePathForHostFilesystem, computeWorkspaceId } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { sendJSON } from '../core/api-handler';
import { setStaticConfigCacheHeaders } from '../shared/router';
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
import { withToolParameterMetadata } from '../llm-tools/llm-tool-parameter-schemas';
import { detectEnDevEligibility } from '../endev/endev-detector';
import { skillCache } from '../skills/skill-handler';
import {
    getServerDetail,
    updateServerConfig,
    deleteServerFromConfig,
    addServerToConfig,
    migrateServerScope,
    readAllDescriptions,
    findServerSource,
    type McpToolScope,
    type McpConfigScope,
} from './mcp-config-writer';
import { testMcpConnection } from './mcp-connection-tester';
import { discoverWorkspaceMcpTools } from './mcp-tools-discovery';
import { readMcpServerAuthInfo, type McpServerAuthStatus } from '../mcp-oauth';

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
    /** Derived server status (added to availableServers only). */
    status?: 'ok' | 'auth' | 'off' | 'err';
    /** Auth state for remote servers (added to availableServers only). */
    authStatus?: McpServerAuthStatus;
    /** Token expiry (epoch seconds), when known (added to availableServers only). */
    authExpiresAt?: number;
    /** User-provided description from config file (added to availableServers only). */
    description?: string;
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

/**
 * Derive server status for the list view: ok | auth | off | err.
 *
 * `auth` is reserved for remote servers whose OAuth token is missing or
 * expired — a stale token still shows `ok` because the SDK will refresh it
 * silently on first use. Stdio servers are always `ok` when enabled.
 */
function deriveServerStatus(
    type: string,
    isEnabled: boolean,
    authStatus: McpServerAuthStatus,
): 'ok' | 'auth' | 'off' | 'err' {
    if (!isEnabled) return 'off';
    if (type === 'http' || type === 'sse') {
        if (authStatus === 'required' || authStatus === 'expired') return 'auth';
    }
    return 'ok';
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

    // Read descriptions from raw config files (not filtered/normalized by loader)
    const descriptions = readAllDescriptions(ws.rootPath);

    // Compute effective server list with status and description
    const enabledSet = ws.enabledMcpServers;
    const availableServers = Object.entries({
        ...globalConfig.mcpServers,
        ...workspaceConfig.mcpServers,
    }).map(([name, config]) => {
        const isEnabled = enabledSet === null || enabledSet === undefined || enabledSet.includes(name);
        const type = config.type ?? 'stdio';
        const entry = toMcpServerEntry(name, config, workspaceNames.has(name) ? 'workspace' : 'global', true);
        const url = 'url' in config ? config.url : undefined;
        const auth = readMcpServerAuthInfo(url, type);
        entry.authStatus = auth.status;
        if (auth.expiresAt !== undefined) entry.authExpiresAt = auth.expiresAt;
        entry.status = deriveServerStatus(type, isEnabled, auth.status);
        const desc = descriptions[name];
        if (desc) entry.description = desc;
        return entry;
    });

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

    // Start the git-info cache background refresh for this server instance.
    // Only workspaces a dashboard client currently has open are proactively
    // refreshed; everything else is served lazily on demand.
    gitInfoCache.start(
        (wsId) => fetchOneGitInfo(wsId, store),
        () => ctx.activeWorkspaceTracker?.getSnapshot().activeWorkspaceIds ?? [],
    );

    // POST /api/workspaces — Register a workspace
    routes.push({
        method: 'POST',
        pattern: '/api/workspaces',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.name || !body.rootPath) {
                return handleAPIError(res, missingFields(['name', 'rootPath']));
            }

            let remoteUrl: string | undefined = body.remoteUrl;
            if (!remoteUrl) {
                remoteUrl = await detectRemoteUrl(body.rootPath);
            }

            // Workspace identity is server-authoritative for the UI registration
            // paths (Add Repo / Add Folder / Clone), which no longer author ids:
            // when no id is supplied the server derives a machine-scoped id from
            // this machine's raw OS hostname + root path, so two machines
            // registering the same absolute path produce distinct ids and never
            // collide in the remote view. An explicitly supplied id is honored
            // as-is — virtual/system workspaces (My Work, My Life, Global) keep
            // their fixed, machine-independent ids, and explicit callers (data
            // import, fixtures) keep theirs.
            const providedId = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : undefined;
            const id = providedId ?? computeWorkspaceId(os.hostname(), body.rootPath);

            const workspace: WorkspaceInfo = {
                id,
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
    // Routed through gitInfoCache to avoid blocking the request on a live
    // `git status`+`git rev-list` subprocess pair on every repo switch.
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git-info$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            try {
                const data = await gitInfoCache.getOrFetch(ws.id);
                sendJSON(res, 200, data);
            } catch {
                sendJSON(res, 200, { branch: null, dirty: false, isGitRepo: false, remoteUrl: null });
            }
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
            // Surface the per-repo enabled-tools allow-list so the UI can render
            // and round-trip per-tool toggles (AC-03 allow-list semantics).
            const enabledMcpTools = ctx.dataDir
                ? readRepoPreferences(ctx.dataDir, ws.id).enabledMcpTools ?? null
                : null;
            sendJSON(res, 200, { ...buildMcpConfigResponse(ws, forceReload), enabledMcpTools });
        },
    });

    // GET /api/workspaces/:id/mcp-config/tools — Live-discover tools for all enabled MCP servers
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config\/tools$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const parsed = url.parse(req.url || '/', true);
            const forceReload = parsed.query.forceReload === 'true' || parsed.query.refresh === 'true';
            const servers = await discoverWorkspaceMcpTools(ws.rootPath, ws.enabledMcpServers, { forceReload });
            sendJSON(res, 200, { servers });
        },
    });

    // GET /api/workspaces/:id/endev/status — Detect or read cached EnDev xDPU eligibility
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/endev\/status$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            if (!ctx.dataDir) {
                return handleAPIError(res, badRequest('dataDir is required for EnDev detection'));
            }
            const parsed = url.parse(req.url || '/', true);
            const forceRefresh = parsed.query.forceRefresh === 'true' || parsed.query.refresh === 'true';
            const status = await detectEnDevEligibility(ctx.dataDir, ws, { forceRefresh });
            if (forceRefresh) {
                skillCache.delete(ws.id);
            }
            sendJSON(res, 200, status);
        },
    });

    // POST /api/workspaces/:id/endev/revalidate — Force EnDev xDPU eligibility revalidation
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/endev\/revalidate$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            if (!ctx.dataDir) {
                return handleAPIError(res, badRequest('dataDir is required for EnDev detection'));
            }
            const status = await detectEnDevEligibility(ctx.dataDir, ws, { forceRefresh: true });
            skillCache.delete(ws.id);
            sendJSON(res, 200, status);
        },
    });

    // PUT /api/workspaces/:id/mcp-config — Save workspace-enabled MCP server list (+ optional enabledMcpTools)
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

            // Optional enabledMcpTools — stored in per-repo preferences
            if (Object.prototype.hasOwnProperty.call(body, 'enabledMcpTools')) {
                if (!ctx.dataDir) {
                    return handleAPIError(res, badRequest('dataDir is required to save enabledMcpTools'));
                }
                if (body.enabledMcpTools !== null
                    && (typeof body.enabledMcpTools !== 'object' || Array.isArray(body.enabledMcpTools))) {
                    return handleAPIError(res, badRequest('`enabledMcpTools` must be a Record<string, string[]> or null'));
                }
                const existing = readRepoPreferences(ctx.dataDir, id);
                const patch = body.enabledMcpTools === null ? { enabledMcpTools: undefined } : { enabledMcpTools: body.enabledMcpTools };
                const merged = validatePerRepoPreferences({ ...existing, ...patch });
                writeRepoPreferences(ctx.dataDir, id, merged);
            }

            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/mcp-config/:server/detail — Full server detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config\/([^/]+)\/detail$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const serverName = decodeURIComponent(match![2]);
            const detail = getServerDetail(serverName, ws.rootPath);
            if (!detail) {
                return handleAPIError(res, notFound('MCP server'));
            }
            sendJSON(res, 200, detail);
        },
    });

    // POST /api/workspaces/:id/mcp-config — Add a new MCP server entry
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (typeof body.name !== 'string' || !body.name.trim()) {
                return handleAPIError(res, missingFields(['name']));
            }
            if (!['stdio', 'http', 'sse'].includes(body.type)) {
                return handleAPIError(res, badRequest('`type` must be "stdio", "http", or "sse"'));
            }
            if (!['global', 'workspace'].includes(body.scope)) {
                return handleAPIError(res, badRequest('`scope` must be "global" or "workspace"'));
            }
            if (body.type === 'http' || body.type === 'sse') {
                if (typeof body.url !== 'string' || !body.url.trim()) {
                    return handleAPIError(res, badRequest('`url` is required for http/sse transport'));
                }
            }

            // Check for name conflict
            const existing = findServerSource(body.name, ws.rootPath);
            if (existing) {
                return handleAPIError(res, badRequest(`Server "${body.name}" already exists in ${existing.source} config`));
            }

            await addServerToConfig(ws.rootPath, {
                name: body.name,
                type: body.type,
                command: typeof body.command === 'string' ? body.command : undefined,
                url: typeof body.url === 'string' ? body.url : undefined,
                args: Array.isArray(body.args) ? body.args : undefined,
                env: (typeof body.env === 'object' && body.env !== null && !Array.isArray(body.env)) ? body.env : undefined,
                description: typeof body.description === 'string' ? body.description : undefined,
                toolScope: (['all', 'readonly', 'allowlist'] as McpToolScope[]).includes(body.toolScope) ? body.toolScope as McpToolScope : undefined,
                scope: body.scope as McpConfigScope,
            });

            sendJSON(res, 201, { name: body.name, scope: body.scope });
        },
    });

    // PUT /api/workspaces/:id/mcp-config/:server — Update a server's config in its source file
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config\/([^/]+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const serverName = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const update: { description?: string; args?: string[]; env?: Record<string, string>; toolScope?: McpToolScope } = {};
            if (typeof body.description === 'string') update.description = body.description;
            if (Array.isArray(body.args)) update.args = body.args;
            if (typeof body.env === 'object' && body.env !== null && !Array.isArray(body.env)) {
                update.env = body.env;
            }
            if (['all', 'readonly', 'allowlist'].includes(body.toolScope)) {
                update.toolScope = body.toolScope as McpToolScope;
            }

            const ok = await updateServerConfig(serverName, ws.rootPath, update);
            if (!ok) {
                return handleAPIError(res, notFound('MCP server'));
            }
            sendJSON(res, 200, { name: serverName, updated: true });
        },
    });

    // DELETE /api/workspaces/:id/mcp-config/:server — Remove a server from its source config
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const serverName = decodeURIComponent(match![2]);
            const ok = await deleteServerFromConfig(serverName, ws.rootPath);
            if (!ok) {
                return handleAPIError(res, notFound('MCP server'));
            }
            sendJSON(res, 200, { name: serverName, deleted: true });
        },
    });

    // POST /api/workspaces/:id/mcp-config/:server/migrate — Move a server between global/workspace
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config\/([^/]+)\/migrate$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const serverName = decodeURIComponent(match![2]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!['global', 'workspace'].includes(body.targetScope)) {
                return handleAPIError(res, badRequest('`targetScope` must be "global" or "workspace"'));
            }

            const ok = await migrateServerScope(serverName, ws.rootPath, body.targetScope as McpConfigScope);
            if (!ok) {
                return handleAPIError(res, notFound('MCP server'));
            }
            sendJSON(res, 200, { name: serverName, scope: body.targetScope });
        },
    });

    // POST /api/workspaces/:id/mcp-config/test — Test MCP server connectivity
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config\/test$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!['stdio', 'http', 'sse'].includes(body.type)) {
                return handleAPIError(res, badRequest('`type` must be "stdio", "http", or "sse"'));
            }
            if (body.type === 'stdio' && (typeof body.command !== 'string' || !body.command.trim())) {
                return handleAPIError(res, badRequest('`command` is required for stdio transport'));
            }
            if ((body.type === 'http' || body.type === 'sse') && (typeof body.url !== 'string' || !body.url.trim())) {
                return handleAPIError(res, badRequest('`url` is required for http/sse transport'));
            }

            const result = await testMcpConnection({
                type: body.type as 'stdio' | 'http' | 'sse',
                command: typeof body.command === 'string' ? body.command : undefined,
                url: typeof body.url === 'string' ? body.url : undefined,
                args: Array.isArray(body.args) ? body.args : undefined,
                env: (typeof body.env === 'object' && body.env !== null && !Array.isArray(body.env)) ? body.env : undefined,
            });

            sendJSON(res, result.success ? 200 : 422, result);
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
            // Static config — short-lived private cache (both branches below are 200s).
            setStaticConfigCacheHeaders(res);
            const liveFlags = ctx.getLiveFeatureFlags?.() ?? { excalidrawEnabled: false, canvasEnabled: false, explorationEnabled: false };
            const effectiveRegistry = withToolParameterMetadata(getEffectiveLlmToolRegistry({ loopsEnabled: ctx.loopsEnabled, canvasEnabled: liveFlags.canvasEnabled, explorationEnabled: liveFlags.explorationEnabled }));
            const conversationRetrievalAvailable = typeof ctx.store.searchConversations === 'function';
            if (!ctx.dataDir) {
                sendJSON(res, 200, {
                    tools: effectiveRegistry,
                    disabledLlmTools: getEffectiveDefaultDisabledTools(),
                    conversationRetrievalAvailable,
                });
                return;
            }
            sendJSON(res, 200, {
                tools: effectiveRegistry,
                disabledLlmTools: readEffectiveDisabledLlmTools(ctx.dataDir, ws.id),
                conversationRetrievalAvailable,
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
                tools: withToolParameterMetadata(getEffectiveLlmToolRegistry({ loopsEnabled: ctx.loopsEnabled, canvasEnabled: ctx.getLiveFeatureFlags?.()?.canvasEnabled ?? false, explorationEnabled: ctx.getLiveFeatureFlags?.()?.explorationEnabled ?? false })),
                disabledLlmTools: merged.disabledLlmTools ?? getEffectiveDefaultDisabledTools(globalPrefs.uiLayoutMode),
                conversationRetrievalAvailable: typeof ctx.store.searchConversations === 'function',
            });
        },
    });
}
