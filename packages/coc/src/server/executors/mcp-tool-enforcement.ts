/**
 * MCP per-tool runtime enforcement for the dashboard chat/session path.
 *
 * The repo settings MCP page lets users toggle individual MCP tools off. Those
 * toggles are persisted in the per-repo `enabledMcpTools` allow-list (server →
 * list of ENABLED tool names) with these semantics:
 *
 *   - A server with **no entry** has *all* its tools enabled.
 *   - Once an entry exists, only the listed tools are enabled — any tool not in
 *     the list (including a newly discovered tool) is disabled.
 *
 * This module turns that allow-list into a concrete `mcpServers` map for an SDK
 * `sendMessage` call. Because `MCPServerConfig.tools` is itself a per-server
 * whitelist ("list of tools to enable; `['*']` = all"), the allow-list maps
 * directly onto it — no runtime discovery of the full tool set is required.
 *
 * Enforcement is intentionally scoped to the chat/session executors. The
 * workflow path resolves its own `mcpServers` in `workflows-write-handler.ts`
 * and the CLI path (`ai-invoker.ts`) is out of scope.
 *
 * Side effect (accepted): resolving `mcpServers` here and sending it with
 * `loadDefaultMcpConfig: false` also makes chat honor the server-level
 * `enabledMcpServers` allow-list. In the common no-toggle case the resolved map
 * is identical to the SDK's default global+workspace load, so behavior is
 * preserved; it only narrows the set when a server or tool is actually disabled.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { MCPServerConfig, ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { loadEffectiveMcpConfig } from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences-handler';

/** Per-server allow-list of ENABLED tool names. */
export type EnabledMcpToolsMap = Record<string, string[]>;

/**
 * Apply the server-level (`enabledMcpServers`) and tool-level
 * (`enabledMcpTools`) allow-lists to a resolved MCP server map.
 *
 * Pure — does no I/O — so the allow-list semantics can be unit-tested directly.
 *
 * @param allServers      the effective (global + workspace) server configs
 * @param enabledMcpServers server-level allow-list; `null`/`undefined` = all on
 * @param enabledMcpTools  per-server tool allow-list; `null`/`undefined` = all on
 * @returns the filtered server map to send explicitly, or `undefined` when there
 *          are no servers configured at all (caller should then fall back to the
 *          SDK's default load to preserve behavior). An empty `{}` is returned
 *          when servers exist but every one is disabled — `{}` tells the SDK to
 *          disable all MCP servers, which is the intended outcome.
 */
export function applyMcpAllowList(
    allServers: Record<string, MCPServerConfig>,
    enabledMcpServers: string[] | null | undefined,
    enabledMcpTools: EnabledMcpToolsMap | null | undefined,
): Record<string, MCPServerConfig> | undefined {
    const serverNames = Object.keys(allServers);
    if (serverNames.length === 0) {
        // Nothing configured — let the caller preserve the SDK default behavior
        // rather than sending `{}` (which would mean "disable all MCP servers").
        return undefined;
    }

    const toolsMap = enabledMcpTools ?? {};
    const result: Record<string, MCPServerConfig> = {};

    for (const name of serverNames) {
        const serverEnabled =
            enabledMcpServers === null || enabledMcpServers === undefined || enabledMcpServers.includes(name);
        if (!serverEnabled) continue;

        const config = allServers[name];
        const toolEntry = toolsMap[name];
        // No entry → keep the server's existing tools (already defaulted to
        // ['*'] by the config loaders). Entry present → enable exactly those
        // tool names; an empty entry ([]) disables every tool on the server.
        const tools = toolEntry === undefined ? (config.tools ?? ['*']) : [...toolEntry];
        result[name] = { ...config, tools };
    }

    return result;
}

/**
 * Resolve the effective MCP config for a working directory and apply the
 * allow-lists. Reads (cached) global + workspace MCP config from disk.
 */
export function resolveChatMcpServers(input: {
    rootPath: string | undefined;
    enabledMcpServers: string[] | null | undefined;
    enabledMcpTools: EnabledMcpToolsMap | null | undefined;
    forceReload?: boolean;
}): Record<string, MCPServerConfig> | undefined {
    if (!input.rootPath) return undefined;
    const effective = loadEffectiveMcpConfig({
        workingDirectory: input.rootPath,
        forceReload: input.forceReload,
    });
    return applyMcpAllowList(effective.mcpServers, input.enabledMcpServers, input.enabledMcpTools);
}

/**
 * Look up a workspace's server-level + tool-level allow-lists and resolve the
 * `mcpServers` map for a chat/session turn.
 *
 * Returns `undefined` (caller falls back to the SDK default load) when there is
 * no workspace context or no MCP servers are configured. Never throws — any
 * lookup failure degrades to `undefined` so a chat turn is never blocked by
 * allow-list resolution.
 */
export async function resolveChatMcpServersForWorkspace(opts: {
    store: ProcessStore;
    dataDir: string | undefined;
    workspaceId: string | undefined;
    workingDirectory: string | undefined;
    forceReload?: boolean;
}): Promise<Record<string, MCPServerConfig> | undefined> {
    if (!opts.workspaceId) return undefined;
    try {
        let workspace: WorkspaceInfo | undefined;
        try {
            const workspaces = await opts.store.getWorkspaces();
            workspace = workspaces.find(ws => ws.id === opts.workspaceId);
        } catch {
            workspace = undefined;
        }

        const rootPath = workspace?.rootPath ?? opts.workingDirectory;
        if (!rootPath) return undefined;

        const enabledMcpTools = opts.dataDir
            ? readRepoPreferences(opts.dataDir, opts.workspaceId).enabledMcpTools ?? undefined
            : undefined;

        return resolveChatMcpServers({
            rootPath,
            enabledMcpServers: workspace?.enabledMcpServers,
            enabledMcpTools,
            forceReload: opts.forceReload,
        });
    } catch {
        // Resolution must never break a chat turn — fall back to default load.
        return undefined;
    }
}
