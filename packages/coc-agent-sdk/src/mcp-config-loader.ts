import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { MCPLocalServerConfig, MCPRemoteServerConfig, MCPServerConfig } from './types';
import { getAIServiceLogger } from './logger';

/**
 * Structure of the MCP config file (~/.copilot/mcp-config.json)
 */
export interface MCPConfigFile {
    /** Map of server names to their configurations */
    mcpServers?: Record<string, MCPServerConfig>;
}

/**
 * Structure of workspace MCP config (.vscode/mcp.json)
 */
export interface VSCodeMCPConfigFile {
    /** Map of server names to their configurations */
    servers?: Record<string, MCPServerConfig>;
}

export interface MCPConfigLoadResult {
    /** Whether the config was loaded successfully */
    success: boolean;
    /** The loaded MCP server configurations (empty object if not found or error) */
    mcpServers: Record<string, MCPServerConfig>;
    /** Path to the config file that was checked */
    configPath: string;
    /** Error message if loading failed */
    error?: string;
    /** Whether the config file exists */
    fileExists: boolean;
}

/** Config directory name under the home directory */
const CONFIG_DIR = '.copilot';
const CONFIG_FILE = 'mcp-config.json';
const WORKSPACE_CONFIG_DIR = '.vscode';
const WORKSPACE_MCP_CONFIG_FILE = 'mcp.json';

/** Cached config keyed by absolute config path to avoid cross-workspace contamination */
const cachedConfigs = new Map<string, MCPConfigLoadResult>();

/** Override for home directory (used for testing) */
let homeDirectoryOverride: string | null = null;

/**
 * Testing seam; `null` restores the system default. Clears the config cache.
 */
export function setHomeDirectoryOverride(dir: string | null): void {
    homeDirectoryOverride = dir;
    // Clear cache when home directory changes
    cachedConfigs.clear();
}

/** The testing override when one is set, otherwise `os.homedir()`. */
export function getHomeDirectory(): string {
    // Return override if set (for testing)
    if (homeDirectoryOverride !== null) {
        return homeDirectoryOverride;
    }
    // os.homedir() handles all platforms correctly:
    // - Windows: %USERPROFILE% or %HOMEDRIVE%%HOMEPATH%
    // - macOS/Linux: $HOME or from /etc/passwd
    return os.homedir();
}

/** Path to `~/.copilot/mcp-config.json`. */
export function getMcpConfigPath(): string {
    return path.join(getHomeDirectory(), CONFIG_DIR, CONFIG_FILE);
}

/** Path to `<workingDirectory>/.vscode/mcp.json`. */
export function getWorkspaceMcpConfigPath(workingDirectory: string): string {
    return path.join(workingDirectory, WORKSPACE_CONFIG_DIR, WORKSPACE_MCP_CONFIG_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
    return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const result: Record<string, string> = {};
    for (const [recordKey, recordValue] of Object.entries(value)) {
        if (typeof recordValue !== 'string') {
            return undefined;
        }
        result[recordKey] = recordValue;
    }
    return result;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
}

function normalizeWorkspaceMcpServer(server: Record<string, unknown>): MCPServerConfig | undefined {
    if (typeof server.command === 'string') {
        const config: MCPLocalServerConfig = { command: server.command };
        if (server.type === 'local' || server.type === 'stdio') config.type = server.type;
        const args = stringArray(server.args);
        if (args) config.args = args;
        const env = stringRecord(server.env);
        if (env) config.env = env;
        if (typeof server.cwd === 'string') config.cwd = server.cwd;
        // The SDK requires `tools: string[]`; missing/empty means "no tools".
        // Default to ["*"] (all tools) when not specified, matching the workspace config behavior.
        config.tools = stringArray(server.tools) ?? ['*'];
        const timeout = optionalNumber(server.timeout);
        if (timeout !== undefined) config.timeout = timeout;
        const enabled = optionalBoolean(server.enabled);
        if (enabled !== undefined) config.enabled = enabled;
        return config;
    }

    if (typeof server.url === 'string' && (server.type === 'http' || server.type === 'sse')) {
        const config: MCPRemoteServerConfig = { type: server.type, url: server.url };
        const headers = stringRecord(server.headers);
        if (headers) config.headers = headers;
        config.tools = stringArray(server.tools) ?? ['*'];
        const timeout = optionalNumber(server.timeout);
        if (timeout !== undefined) config.timeout = timeout;
        const enabled = optionalBoolean(server.enabled);
        if (enabled !== undefined) config.enabled = enabled;
        return config;
    }

    return undefined;
}

function normalizeWorkspaceMcpServers(config: VSCodeMCPConfigFile): Record<string, MCPServerConfig> {
    if (!isRecord(config.servers)) {
        return {};
    }

    const aiLog = getAIServiceLogger();
    const normalized: Record<string, MCPServerConfig> = {};
    for (const [name, server] of Object.entries(config.servers)) {
        if (!isRecord(server)) {
            aiLog.warn({ serverName: name }, '[MCP] Workspace server entry is not an object — skipped');
            continue;
        }

        const normalizedServer = normalizeWorkspaceMcpServer(server);
        if (normalizedServer) {
            const serverType = normalizedServer.type ?? ('command' in normalizedServer ? 'stdio' : 'unknown');
            aiLog.debug({ serverName: name, type: serverType, enabled: normalizedServer.enabled }, '[MCP] Workspace server normalized');
            normalized[name] = normalizedServer;
        } else {
            aiLog.warn(
                { serverName: name, hasCommand: typeof (server as Record<string, unknown>).command === 'string', hasUrl: typeof (server as Record<string, unknown>).url === 'string', type: (server as Record<string, unknown>).type },
                '[MCP] Workspace server failed normalization (missing command/url or unsupported type) — skipped',
            );
        }
    }

    return normalized;
}

function selectGlobalMcpServers(config: unknown): Record<string, MCPServerConfig> {
    const aiLog = getAIServiceLogger();
    if (!isRecord(config) || !isRecord(config.mcpServers)) {
        return {};
    }

    // Default `tools` to ["*"] for global servers that don't specify it,
    // matching the SDK expectation (missing tools = no tools exposed).
    const servers = config.mcpServers as Record<string, MCPServerConfig>;
    const result: Record<string, MCPServerConfig> = {};
    for (const [name, server] of Object.entries(servers)) {
        if (!server.tools || server.tools.length === 0) {
            result[name] = { ...server, tools: ['*'] };
        } else {
            result[name] = server;
        }
        const serverType = server.type ?? ('command' in server ? 'stdio' : 'unknown');
        aiLog.debug({ serverName: name, type: serverType, enabled: server.enabled }, '[MCP] Global server registered');
    }
    return result;
}

function loadMcpConfigFromPath(
    configPath: string,
    selectServers: (config: unknown) => Record<string, MCPServerConfig>,
    sourceLabel: string,
    forceReload = false,
): MCPConfigLoadResult {
    const aiLog = getAIServiceLogger();

    if (!forceReload) {
        const cached = cachedConfigs.get(configPath);
        if (cached) {
            aiLog.debug({ configPath, source: sourceLabel }, 'Returning cached MCP config');
            return cached;
        }
    }

    aiLog.debug({ configPath, source: sourceLabel }, 'Loading MCP config');

    if (!fs.existsSync(configPath)) {
        aiLog.debug({ fileExists: false, source: sourceLabel }, 'MCP config file not found (this is normal if not configured)');
        const result = {
            success: true,
            mcpServers: {},
            configPath,
            fileExists: false
        };
        cachedConfigs.set(configPath, result);
        return result;
    }

    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(content);
        const mcpServers = selectServers(config);

        const serverCount = Object.keys(mcpServers).length;
        aiLog.debug({ serverCount, fileExists: true, success: true, source: sourceLabel }, 'MCP config loaded');

        const result = {
            success: true,
            mcpServers,
            configPath,
            fileExists: true
        };
        cachedConfigs.set(configPath, result);
        return result;

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        aiLog.warn({ err: error instanceof Error ? error : undefined, fileExists: true, success: false, source: sourceLabel }, 'Failed to parse MCP config file');

        const result = {
            success: false,
            mcpServers: {},
            configPath,
            fileExists: true,
            error: `Failed to parse MCP config: ${errorMessage}`
        };
        cachedConfigs.set(configPath, result);
        return result;
    }
}

/**
 * Load MCP servers from `~/.copilot/mcp-config.json`. Results are cached after
 * the first successful load; `forceReload` bypasses the cache.
 */
export function loadDefaultMcpConfig(forceReload = false): MCPConfigLoadResult {
    const configPath = getMcpConfigPath();
    return loadMcpConfigFromPath(
        configPath,
        selectGlobalMcpServers,
        'global',
        forceReload,
    );
}

/**
 * Load MCP servers from `<workingDirectory>/.vscode/mcp.json`, normalizing the
 * file's top-level `servers` map to the `mcpServers` shape. `forceReload`
 * bypasses the cache.
 */
export function loadWorkspaceMcpConfig(workingDirectory: string, forceReload = false): MCPConfigLoadResult {
    const configPath = getWorkspaceMcpConfigPath(workingDirectory);
    return loadMcpConfigFromPath(
        configPath,
        (config) => normalizeWorkspaceMcpServers(config as VSCodeMCPConfigFile),
        'workspace',
        forceReload,
    );
}

/** Convenience wrapper for async contexts; the load itself is synchronous. */
export async function loadDefaultMcpConfigAsync(forceReload = false): Promise<MCPConfigLoadResult> {
    return loadDefaultMcpConfig(forceReload);
}

/** Merge default and explicit MCP servers; explicit entries win. */
export function mergeMcpConfigs(
    defaultConfig: Record<string, MCPServerConfig>,
    explicitConfig?: Record<string, MCPServerConfig>
): Record<string, MCPServerConfig> {
    if (!explicitConfig) {
        return { ...defaultConfig };
    }

    // If explicit config is empty object, it means "disable all MCP servers"
    // This is a special case documented in the SDK
    if (Object.keys(explicitConfig).length === 0) {
        return {};
    }

    // Merge with explicit taking precedence
    return {
        ...defaultConfig,
        ...explicitConfig
    };
}

/**
 * Merge MCP server configurations from global, workspace, and explicit sources.
 * Later sources take precedence. Explicit empty config disables all MCP servers.
 */
export function mergeMcpConfigSources(
    globalConfig: Record<string, MCPServerConfig>,
    workspaceConfig: Record<string, MCPServerConfig>,
    explicitConfig?: Record<string, MCPServerConfig>,
): Record<string, MCPServerConfig> {
    return mergeMcpConfigs({ ...globalConfig, ...workspaceConfig }, explicitConfig);
}

/**
 * Load and merge global, workspace, and explicit MCP sources for a request.
 */
export function loadEffectiveMcpConfig(options: {
    workingDirectory?: string;
    explicitMcpServers?: Record<string, MCPServerConfig>;
    loadDefaultMcpConfig?: boolean;
    forceReload?: boolean;
}): MCPConfigLoadResult {
    const shouldLoadDefaultMcp = options.loadDefaultMcpConfig !== false;

    if (!shouldLoadDefaultMcp) {
        return {
            success: true,
            mcpServers: options.explicitMcpServers ?? {},
            configPath: '',
            fileExists: false,
        };
    }

    const globalConfig = loadDefaultMcpConfig(options.forceReload);
    const workspaceConfig = options.workingDirectory
        ? loadWorkspaceMcpConfig(options.workingDirectory, options.forceReload)
        : {
            success: true,
            mcpServers: {},
            configPath: '',
            fileExists: false,
        };

    const aiLog = getAIServiceLogger();
    aiLog.debug(
        {
            globalConfigPath: globalConfig.configPath,
            globalFileExists: globalConfig.fileExists,
            globalSuccess: globalConfig.success,
            globalServerCount: Object.keys(globalConfig.mcpServers).length,
            workspaceConfigPath: workspaceConfig.configPath || '(none)',
            workspaceFileExists: workspaceConfig.fileExists,
            workspaceSuccess: workspaceConfig.success,
            workspaceServerCount: Object.keys(workspaceConfig.mcpServers).length,
            explicitServerCount: options.explicitMcpServers ? Object.keys(options.explicitMcpServers).length : 0,
        },
        '[MCP] Merging config sources',
    );
    if (globalConfig.error) aiLog.warn({ error: globalConfig.error }, '[MCP] Global config error');
    if (workspaceConfig.error) aiLog.warn({ error: workspaceConfig.error }, '[MCP] Workspace config error');

    const success = globalConfig.success && workspaceConfig.success;
    const error = [globalConfig.error, workspaceConfig.error].filter(Boolean).join('; ') || undefined;

    const merged = mergeMcpConfigSources(globalConfig.mcpServers, workspaceConfig.mcpServers, options.explicitMcpServers);
    aiLog.debug(
        { totalServerCount: Object.keys(merged).length, serverNames: Object.keys(merged) },
        '[MCP] Effective config resolved',
    );
    return {
        success,
        mcpServers: merged,
        configPath: workspaceConfig.configPath || globalConfig.configPath,
        fileExists: globalConfig.fileExists || workspaceConfig.fileExists,
        ...(error ? { error } : {}),
    };
}

/**
 * Invalidate the cached entry for a specific config file path.
 * Call this immediately after writing to a config file so subsequent
 * reads reload from disk instead of returning stale data.
 *
 * @param configPath - Absolute path to the config file whose cache entry should be removed
 */
export function invalidateCachedConfig(configPath: string): void {
    cachedConfigs.delete(configPath);
}

/** Drop every cached config — for tests, or after an external file change. */
export function clearMcpConfigCache(): void {
    const aiLog = getAIServiceLogger();
    aiLog.debug('Clearing MCP config cache');
    cachedConfigs.clear();
}

/** Whether a config file exists at the default location. */
export function mcpConfigExists(): boolean {
    return fs.existsSync(getMcpConfigPath());
}

/** The cached entry for `configPath`, or null when nothing has been loaded. */
export function getCachedMcpConfig(configPath = getMcpConfigPath()): MCPConfigLoadResult | null {
    return cachedConfigs.get(configPath) ?? null;
}
