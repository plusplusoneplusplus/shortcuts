/**
 * MCP Config Writer
 *
 * Utilities for reading raw JSON and writing to MCP config files:
 *  - Global:    ~/.copilot/mcp-config.json   (key: "mcpServers")
 *  - Workspace: <repo>/.vscode/mcp.json      (key: "servers")
 *
 * These helpers intentionally bypass the forge mcp-config-loader cache so
 * that mutations are reflected immediately and extra fields like `description`
 * and `toolScope` (which the normalising loader strips) are preserved.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getMcpConfigPath, getWorkspaceMcpConfigPath } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

export type McpToolScope = 'all' | 'readonly' | 'allowlist';
export type McpConfigScope = 'global' | 'workspace';

export interface McpServerDetail {
    description: string;
    envKeys: string[];
    args: string[];
    toolScope: McpToolScope;
    source: McpConfigScope;
    /** Raw JSON block for the server entry as stored in the config file. */
    rawJson: Record<string, unknown>;
}

export interface McpServerUpdate {
    description?: string;
    args?: string[];
    /** Full env map replacement for specified keys (merged into existing keys). */
    env?: Record<string, string>;
    toolScope?: McpToolScope;
}

export interface McpServerCreate {
    name: string;
    /** Transport type. */
    type: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
    description?: string;
    toolScope?: McpToolScope;
    scope: McpConfigScope;
}

// ============================================================================
// Raw file read/write helpers
// ============================================================================

/**
 * Read raw JSON from the global MCP config file.
 * Returns `{ mcpServers: {} }` if the file doesn't exist or is invalid.
 */
export function readRawGlobalConfig(): Record<string, unknown> {
    const configPath = getMcpConfigPath();
    if (!fs.existsSync(configPath)) {
        return { mcpServers: {} };
    }
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { mcpServers: {} };
        }
        return parsed as Record<string, unknown>;
    } catch {
        return { mcpServers: {} };
    }
}

/** Write raw JSON to the global MCP config file (creates parent dirs if needed). */
export function writeRawGlobalConfig(data: Record<string, unknown>): void {
    const configPath = getMcpConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read raw JSON from the workspace MCP config file (`.vscode/mcp.json`).
 * Returns `{ servers: {} }` if the file doesn't exist or is invalid.
 */
export function readRawWorkspaceConfig(rootPath: string): Record<string, unknown> {
    const configPath = getWorkspaceMcpConfigPath(rootPath);
    if (!fs.existsSync(configPath)) {
        return { servers: {} };
    }
    try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return { servers: {} };
        }
        return parsed as Record<string, unknown>;
    } catch {
        return { servers: {} };
    }
}

/** Write raw JSON to the workspace MCP config file (creates parent dirs if needed). */
export function writeRawWorkspaceConfig(rootPath: string, data: Record<string, unknown>): void {
    const configPath = getWorkspaceMcpConfigPath(rootPath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================================
// Description helpers
// ============================================================================

/**
 * Build a map of server name → description for all servers in both config
 * files. Workspace descriptions win when the same name appears in both.
 */
export function readAllDescriptions(rootPath: string): Record<string, string> {
    const result: Record<string, string> = {};

    const globalConfig = readRawGlobalConfig();
    const globalServers = asRecord(globalConfig.mcpServers);
    for (const [name, entry] of Object.entries(globalServers)) {
        if (isRecord(entry) && typeof entry.description === 'string') {
            result[name] = entry.description;
        }
    }

    const wsConfig = readRawWorkspaceConfig(rootPath);
    const wsServers = asRecord(wsConfig.servers);
    for (const [name, entry] of Object.entries(wsServers)) {
        if (isRecord(entry) && typeof entry.description === 'string') {
            result[name] = entry.description;
        } else if (isRecord(entry)) {
            // Workspace entry exists but no description — don't overwrite global description
        }
    }

    return result;
}

// ============================================================================
// CRUD operations
// ============================================================================

/**
 * Find which config file a named server lives in and return its raw entry.
 * Workspace takes precedence over global (matching effective merge order).
 */
export function findServerSource(
    serverName: string,
    rootPath: string,
): { source: McpConfigScope; rawEntry: Record<string, unknown> } | null {
    const wsConfig = readRawWorkspaceConfig(rootPath);
    const wsServers = asRecord(wsConfig.servers);
    if (serverName in wsServers && isRecord(wsServers[serverName])) {
        return { source: 'workspace', rawEntry: wsServers[serverName] as Record<string, unknown> };
    }

    const globalConfig = readRawGlobalConfig();
    const globalServers = asRecord(globalConfig.mcpServers);
    if (serverName in globalServers && isRecord(globalServers[serverName])) {
        return { source: 'global', rawEntry: globalServers[serverName] as Record<string, unknown> };
    }

    return null;
}

/**
 * Return full detail for a named server, or `null` if not found.
 */
export function getServerDetail(serverName: string, rootPath: string): McpServerDetail | null {
    const found = findServerSource(serverName, rootPath);
    if (!found) return null;

    const { source, rawEntry } = found;
    const envObj = rawEntry.env;
    const envKeys =
        typeof envObj === 'object' && envObj !== null && !Array.isArray(envObj)
            ? Object.keys(envObj as Record<string, unknown>)
            : [];
    const args = Array.isArray(rawEntry.args) ? (rawEntry.args as unknown[]).map(String) : [];
    const toolScope: McpToolScope =
        rawEntry.toolScope === 'readonly' ? 'readonly'
        : rawEntry.toolScope === 'allowlist' ? 'allowlist'
        : 'all';
    const description = typeof rawEntry.description === 'string' ? rawEntry.description : '';

    return { description, envKeys, args, toolScope, source, rawJson: rawEntry };
}

/**
 * Update a server entry in its source config file.
 * Returns `false` if the server is not found.
 */
export function updateServerConfig(
    serverName: string,
    rootPath: string,
    update: McpServerUpdate,
): boolean {
    const found = findServerSource(serverName, rootPath);
    if (!found) return false;

    const { source } = found;

    if (source === 'global') {
        const config = readRawGlobalConfig();
        const servers = asRecord(config.mcpServers);
        const entry = asRecord(servers[serverName]);
        applyUpdate(entry, update);
        servers[serverName] = entry;
        config.mcpServers = servers;
        writeRawGlobalConfig(config);
    } else {
        const config = readRawWorkspaceConfig(rootPath);
        const servers = asRecord(config.servers);
        const entry = asRecord(servers[serverName]);
        applyUpdate(entry, update);
        servers[serverName] = entry;
        config.servers = servers;
        writeRawWorkspaceConfig(rootPath, config);
    }

    return true;
}

/**
 * Remove a server entry from its source config file.
 * Returns `false` if the server is not found.
 */
export function deleteServerFromConfig(serverName: string, rootPath: string): boolean {
    const found = findServerSource(serverName, rootPath);
    if (!found) return false;

    if (found.source === 'global') {
        const config = readRawGlobalConfig();
        const servers = asRecord(config.mcpServers);
        delete servers[serverName];
        config.mcpServers = servers;
        writeRawGlobalConfig(config);
    } else {
        const config = readRawWorkspaceConfig(rootPath);
        const servers = asRecord(config.servers);
        delete servers[serverName];
        config.servers = servers;
        writeRawWorkspaceConfig(rootPath, config);
    }

    return true;
}

/**
 * Add a new server entry to the specified config file.
 * Does not validate if the name already exists — caller must check.
 */
export function addServerToConfig(rootPath: string, serverData: McpServerCreate): void {
    const entry: Record<string, unknown> = {};

    if (serverData.type === 'http' || serverData.type === 'sse') {
        entry.type = serverData.type;
        if (serverData.url) entry.url = serverData.url;
    } else {
        // stdio is the default; only write type if explicitly specified
        if (serverData.type && serverData.type !== 'stdio') entry.type = serverData.type;
        if (serverData.command) entry.command = serverData.command;
        if (serverData.args && serverData.args.length > 0) entry.args = serverData.args;
    }

    if (serverData.env && Object.keys(serverData.env).length > 0) {
        entry.env = serverData.env;
    }
    if (serverData.description) entry.description = serverData.description;
    if (serverData.toolScope && serverData.toolScope !== 'all') {
        entry.toolScope = serverData.toolScope;
    }

    if (serverData.scope === 'global') {
        const config = readRawGlobalConfig();
        const servers = asRecord(config.mcpServers);
        servers[serverData.name] = entry;
        config.mcpServers = servers;
        writeRawGlobalConfig(config);
    } else {
        const config = readRawWorkspaceConfig(rootPath);
        const servers = asRecord(config.servers);
        servers[serverData.name] = entry;
        config.servers = servers;
        writeRawWorkspaceConfig(rootPath, config);
    }
}

/**
 * Move a server entry between global and workspace config files.
 * Returns `false` if the server is not found or is already in `targetScope`.
 */
export function migrateServerScope(
    serverName: string,
    rootPath: string,
    targetScope: McpConfigScope,
): boolean {
    const found = findServerSource(serverName, rootPath);
    if (!found) return false;
    if (found.source === targetScope) return true; // already there

    // Capture the raw entry before deletion
    const rawEntry = { ...found.rawEntry };

    // Remove from the current source
    if (found.source === 'global') {
        const config = readRawGlobalConfig();
        const servers = asRecord(config.mcpServers);
        delete servers[serverName];
        config.mcpServers = servers;
        writeRawGlobalConfig(config);
    } else {
        const config = readRawWorkspaceConfig(rootPath);
        const servers = asRecord(config.servers);
        delete servers[serverName];
        config.servers = servers;
        writeRawWorkspaceConfig(rootPath, config);
    }

    // Add to the target source
    if (targetScope === 'global') {
        const config = readRawGlobalConfig();
        const servers = asRecord(config.mcpServers);
        servers[serverName] = rawEntry;
        config.mcpServers = servers;
        writeRawGlobalConfig(config);
    } else {
        const config = readRawWorkspaceConfig(rootPath);
        const servers = asRecord(config.servers);
        servers[serverName] = rawEntry;
        config.servers = servers;
        writeRawWorkspaceConfig(rootPath, config);
    }

    return true;
}

// ============================================================================
// Internal helpers
// ============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
    return isRecord(value) ? (value as Record<string, unknown>) : {};
}

function applyUpdate(entry: Record<string, unknown>, update: McpServerUpdate): void {
    if (update.description !== undefined) entry.description = update.description;
    if (update.args !== undefined) entry.args = update.args;
    if (update.env !== undefined) {
        const existing = asRecord(entry.env);
        entry.env = { ...existing, ...update.env };
    }
    if (update.toolScope !== undefined) entry.toolScope = update.toolScope;
}
