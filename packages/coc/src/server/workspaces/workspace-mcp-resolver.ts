/**
 * The one effective-MCP resolver for a workspace. Settings (list, detail,
 * mutations, OAuth start), live tool discovery, and every chat turn read the
 * same resolution, so what the page shows is what a chat runs.
 *
 * Ordinary repo: global `~/.copilot/mcp-config.json` < the repo's own
 * `.vscode/mcp.json` (workspace over global, by name).
 *
 * Repo group: global < live members' `.vscode/mcp.json` < the group root's own
 * `.vscode/mcp.json`. Merge rules:
 *
 *  - A member contributes only what its own policy allows: servers its
 *    `enabledMcpServers` disables are skipped, and its `enabledMcpTools` entry
 *    narrows the server's tools. The group policy applied later can only narrow
 *    a member-sourced tool list further, never widen it.
 *  - Member stdio servers run anchored to the member root: `cwd` (default the
 *    member root) resolves against it, and a relative command path resolves
 *    against that `cwd`. The group root is never their execution context.
 *  - Members defining the same name are compared by a fingerprint of the full
 *    resolved connection (transport, command, args, cwd, env, url, headers,
 *    tools, timeout, enabled). Identical definitions collapse into one server
 *    that lists every sharing member. Distinct definitions are a conflict: the
 *    first member in group order wins, and the others are reported as
 *    `conflicts` so the choice is visible, never silent. Name alone or URL
 *    alone is never treated as identity.
 *  - Different names are different servers even when their connections match:
 *    enable and tool policies are keyed by name.
 *
 * Fingerprints are compared in memory only and never logged or returned.
 */

import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import type { MCPServerConfig, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { loadDefaultMcpConfig, loadWorkspaceMcpConfig } from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences-handler';
import { isRepoGroupWorkspaceId, readRepoGroup, resolveRepoGroupMembers } from './repo-group-workspace';

type McpLoadResult = ReturnType<typeof loadDefaultMcpConfig>;
type EnabledMcpToolsMap = Record<string, string[]>;

/** A member repo referenced by a resolved server. */
export interface McpMemberRef {
    workspaceId: string;
    name?: string;
}

/** Which config defines an effective server. `workspace` = this workspace's own file (the group root for a group). */
export type McpDefinitionSource = 'global' | 'workspace' | 'member';

export interface EffectiveMcpServer {
    /** Runtime config; member stdio servers are already anchored to the member root. */
    config: MCPServerConfig;
    source: McpDefinitionSource;
    /** Defining member (`member` source only). */
    member?: McpMemberRef & { rootPath: string };
    /** Other members with an identical definition, folded into this one. */
    sharedWith?: McpMemberRef[];
    /** Members whose distinct same-name definition lost to the first member. */
    conflicts?: McpMemberRef[];
    /** Directory the server's stdio process runs from when it has no own `cwd`. */
    executionRoot: string;
}

/** One member's contribution, as reported to settings. */
export interface McpMemberSourceStatus extends McpMemberRef {
    rootPath?: string;
    stale?: boolean;
    staleReason?: 'workspace-removed' | 'path-missing';
    configPath: string;
    fileExists: boolean;
    success: boolean;
    error?: string;
    /** The member's raw definitions (before its own policy filter); may hold secrets, never serialize. */
    servers: Record<string, MCPServerConfig>;
    /** Names the member's own `enabledMcpServers` excludes from the group. */
    disabledByMember: string[];
}

export interface WorkspaceMcpResolution {
    isGroup: boolean;
    global: McpLoadResult;
    /** This workspace's own `.vscode/mcp.json` (the group root for a group). */
    workspace: McpLoadResult;
    /** Group members in membership order; empty for ordinary repos. */
    members: McpMemberSourceStatus[];
    /** Set when a group's membership could not be read. */
    membersError?: string;
    servers: Record<string, EffectiveMcpServer>;
}

/** Inputs for the pure merge: one entry per live member, in group order. */
export interface McpMemberDefinitions extends McpMemberRef {
    rootPath: string;
    servers: Record<string, MCPServerConfig>;
    enabledMcpServers?: string[] | null;
    enabledMcpTools?: EnabledMcpToolsMap | null;
}

function isServerEnabled(enabled: string[] | null | undefined, name: string): boolean {
    return enabled === null || enabled === undefined || enabled.includes(name);
}

/**
 * Anchor a member's stdio server to the member root. Bare commands (`npx`,
 * `node`) keep PATH lookup; only explicit relative paths are resolved.
 */
export function anchorStdioServer(config: MCPServerConfig, rootPath: string): MCPServerConfig {
    if (!('command' in config) || typeof config.command !== 'string') return config;
    const cwd = path.resolve(rootPath, config.cwd ?? '.');
    const command = !path.isAbsolute(config.command) && /[\\/]/.test(config.command)
        ? path.resolve(cwd, config.command)
        : config.command;
    return { ...config, command, cwd };
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
            .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]));
    }
    return value;
}

/** Opaque identity of a fully resolved connection, secrets included; never expose it. */
export function mcpConnectionFingerprint(config: MCPServerConfig): string {
    const normalized = { ...config, type: config.type === 'local' ? 'stdio' : (config.type ?? ('command' in config ? 'stdio' : undefined)) };
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(normalized))).digest('hex');
}

function memberRef(member: McpMemberRef): McpMemberRef {
    return { workspaceId: member.workspaceId, ...(member.name ? { name: member.name } : {}) };
}

/** Pure merge of loaded sources; see the module comment for the rules. */
export function mergeWorkspaceMcpServers(input: {
    global: Record<string, MCPServerConfig>;
    workspace: Record<string, MCPServerConfig>;
    workspaceRoot: string;
    members?: McpMemberDefinitions[];
}): Record<string, EffectiveMcpServer> {
    const result: Record<string, EffectiveMcpServer> = {};
    for (const [name, config] of Object.entries(input.global)) {
        result[name] = { config, source: 'global', executionRoot: input.workspaceRoot };
    }

    const byName = new Map<string, Array<{ member: McpMemberDefinitions; config: MCPServerConfig; fingerprint: string }>>();
    for (const member of input.members ?? []) {
        for (const [name, raw] of Object.entries(member.servers)) {
            if (!isServerEnabled(member.enabledMcpServers, name)) continue;
            const toolEntry = member.enabledMcpTools?.[name];
            const narrowed = toolEntry === undefined ? raw : { ...raw, tools: [...toolEntry] };
            const config = anchorStdioServer(narrowed, member.rootPath);
            const defs = byName.get(name) ?? [];
            defs.push({ member, config, fingerprint: mcpConnectionFingerprint(config) });
            byName.set(name, defs);
        }
    }
    for (const [name, defs] of byName) {
        const [first, ...rest] = defs;
        const sharedWith = rest.filter(d => d.fingerprint === first.fingerprint).map(d => memberRef(d.member));
        const conflicts = rest.filter(d => d.fingerprint !== first.fingerprint).map(d => memberRef(d.member));
        result[name] = {
            config: first.config,
            source: 'member',
            member: { ...memberRef(first.member), rootPath: first.member.rootPath },
            executionRoot: first.member.rootPath,
            ...(sharedWith.length ? { sharedWith } : {}),
            ...(conflicts.length ? { conflicts } : {}),
        };
    }

    for (const [name, config] of Object.entries(input.workspace)) {
        result[name] = { config, source: 'workspace', executionRoot: input.workspaceRoot };
    }
    return result;
}

/**
 * Apply the workspace's own server/tool allow-lists to a resolution and return
 * the map a chat turn sends. `undefined` means nothing is configured at all, so
 * callers keep the SDK default load; `{}` means everything is disabled.
 *
 * A tool entry replaces the tool list of global/workspace servers (the
 * long-standing repo semantics) but only intersects a member-sourced list, so a
 * group can never re-enable a tool a member's own policy turned off.
 */
export function toRuntimeMcpServers(
    servers: Record<string, EffectiveMcpServer>,
    enabledMcpServers: string[] | null | undefined,
    enabledMcpTools: EnabledMcpToolsMap | null | undefined,
): Record<string, MCPServerConfig> | undefined {
    const names = Object.keys(servers);
    if (names.length === 0) return undefined;
    const result: Record<string, MCPServerConfig> = {};
    for (const name of names) {
        if (!isServerEnabled(enabledMcpServers, name)) continue;
        const { config, source } = servers[name];
        const base = config.tools ?? ['*'];
        const entry = enabledMcpTools?.[name];
        let tools: string[];
        if (entry === undefined) tools = base;
        else if (source !== 'member' || base.includes('*')) tools = [...entry];
        else tools = base.filter(tool => entry.includes(tool));
        result[name] = { ...config, tools };
    }
    return result;
}

function emptyLoad(): McpLoadResult {
    return { success: true, mcpServers: {}, configPath: '', fileExists: false };
}

/**
 * Load and merge every MCP source for a workspace. Never throws: a member whose
 * config fails to parse, or a group whose membership is unreadable, is reported
 * on the resolution and contributes nothing.
 */
export async function resolveWorkspaceMcp(opts: {
    store: ProcessStore;
    dataDir: string | undefined;
    workspace: Pick<WorkspaceInfo, 'id' | 'rootPath'>;
    forceReload?: boolean;
}): Promise<WorkspaceMcpResolution> {
    const { workspace, forceReload } = opts;
    const global = loadDefaultMcpConfig(forceReload);
    const own = workspace.rootPath ? loadWorkspaceMcpConfig(workspace.rootPath, forceReload) : emptyLoad();
    const isGroup = isRepoGroupWorkspaceId(workspace.id);
    const members: McpMemberSourceStatus[] = [];
    const definitions: McpMemberDefinitions[] = [];
    let membersError: string | undefined;

    if (isGroup) {
        const dataDir = opts.dataDir ?? path.join(os.homedir(), '.coc');
        try {
            if (!readRepoGroup(dataDir, workspace.id)) throw new Error('Repo group membership is unavailable');
            const resolved = await resolveRepoGroupMembers(dataDir, opts.store, workspace.id);
            const registry = new Map((await opts.store.getWorkspaces()).map(ws => [ws.id, ws]));
            for (const member of resolved) {
                const ref = memberRef(member);
                if (member.stale || !member.rootPath) {
                    members.push({
                        ...ref,
                        ...(member.rootPath ? { rootPath: member.rootPath } : {}),
                        stale: true,
                        ...(member.staleReason ? { staleReason: member.staleReason } : {}),
                        configPath: '', fileExists: false, success: true, servers: {}, disabledByMember: [],
                    });
                    continue;
                }
                const load = loadWorkspaceMcpConfig(member.rootPath, forceReload);
                const enabledMcpServers = registry.get(member.workspaceId)?.enabledMcpServers;
                members.push({
                    ...ref,
                    rootPath: member.rootPath,
                    configPath: load.configPath,
                    fileExists: load.fileExists,
                    success: load.success,
                    ...(load.error ? { error: load.error } : {}),
                    servers: load.mcpServers,
                    disabledByMember: Object.keys(load.mcpServers).filter(name => !isServerEnabled(enabledMcpServers, name)),
                });
                definitions.push({
                    ...ref,
                    rootPath: member.rootPath,
                    servers: load.mcpServers,
                    enabledMcpServers,
                    enabledMcpTools: opts.dataDir
                        ? readRepoPreferences(opts.dataDir, member.workspaceId).enabledMcpTools ?? null
                        : null,
                });
            }
        } catch (error) {
            membersError = error instanceof Error ? error.message : String(error);
        }
    }

    return {
        isGroup,
        global,
        workspace: own,
        members,
        ...(membersError ? { membersError } : {}),
        servers: mergeWorkspaceMcpServers({
            global: global.mcpServers,
            workspace: own.mcpServers,
            workspaceRoot: workspace.rootPath,
            members: definitions,
        }),
    };
}
