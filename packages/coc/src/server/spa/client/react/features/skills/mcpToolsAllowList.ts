/**
 * Allow-list write logic for per-tool MCP toggles.
 *
 * The per-repo `enabledMcpTools` preference maps a server name to the list of
 * tool names that remain ENABLED. The semantics are an allow-list:
 *
 *   - A server with **no entry** has *all* tools enabled (the common case).
 *   - Once an entry exists, only the listed tools are enabled — any tool not in
 *     the list (including a newly discovered tool) is disabled. New/undiscovered
 *     tools therefore default OFF once an entry exists.
 *   - The first time a user toggles a tool OFF, we materialize the entry as the
 *     complement of that tool within the currently discovered tools (every
 *     discovered tool stays enabled except the one just turned off).
 *
 * These helpers are pure so the toggle logic can be unit-tested without React.
 */

export type EnabledMcpToolsMap = Record<string, string[]>;

/**
 * Whether a tool is enabled given its server's allow-list entry.
 * `undefined` entry → all tools enabled.
 */
export function isMcpToolEnabled(entry: string[] | undefined, toolName: string): boolean {
    return entry === undefined ? true : entry.includes(toolName);
}

/**
 * Compute the next allow-list entry for one server after toggling one tool.
 *
 * @param entry           current entry (or `undefined` for "no entry / all on")
 * @param discoveredTools tool names currently discovered for the server — the
 *                        universe used to materialize the complement on the
 *                        first toggle-off
 * @returns the new entry array, or `undefined` to mean "no entry" (all on)
 */
export function toggleMcpToolEntry(
    entry: string[] | undefined,
    discoveredTools: string[],
    toolName: string,
    enabled: boolean,
): string[] | undefined {
    if (entry === undefined) {
        // No entry yet → every discovered tool is currently on.
        if (enabled) return undefined; // turning on an already-on tool: no-op
        // First toggle-off → materialize the complement of {toolName}.
        return discoveredTools.filter(t => t !== toolName);
    }
    if (enabled) {
        return entry.includes(toolName) ? entry : [...entry, toolName];
    }
    return entry.filter(t => t !== toolName);
}

/** Apply a single-tool toggle to the whole map, returning a new map. */
export function applyMcpToolToggle(
    map: EnabledMcpToolsMap,
    serverName: string,
    discoveredTools: string[],
    toolName: string,
    enabled: boolean,
): EnabledMcpToolsMap {
    const next = { ...map };
    const updated = toggleMcpToolEntry(next[serverName], discoveredTools, toolName, enabled);
    if (updated === undefined) {
        delete next[serverName];
    } else {
        next[serverName] = updated;
    }
    return next;
}

/**
 * Enable every tool for a server → drop its entry entirely (no entry = all on,
 * including any tools discovered later).
 */
export function enableAllMcpTools(map: EnabledMcpToolsMap, serverName: string): EnabledMcpToolsMap {
    const next = { ...map };
    delete next[serverName];
    return next;
}

/** Disable every tool for a server → an empty allow-list. */
export function disableAllMcpTools(map: EnabledMcpToolsMap, serverName: string): EnabledMcpToolsMap {
    return { ...map, [serverName]: [] };
}

/**
 * Normalize a map for persistence: drop empty objects to `null` so the stored
 * preference round-trips cleanly (the schema treats an empty record as absent).
 */
export function normalizeEnabledMcpTools(map: EnabledMcpToolsMap): EnabledMcpToolsMap | null {
    return Object.keys(map).length > 0 ? map : null;
}
