/**
 * Tool Call Cache Presets
 *
 * Preset ToolCallFilter instances for common caching scenarios.
 * EXPLORE_FILTER is the primary use case: caching read-only exploration tools.
 *
 * No VS Code dependencies — pure Node.js.
 */

import type { ToolCallFilter } from './tool-call-cache-types';

const EXPLORE_TOOL_NAMES = new Set([
    'grep', 'glob', 'view', 'read_file', 'list_directory',
]);

/**
 * Matches read-only, exploration-oriented tool calls:
 * grep, glob, view, read_file, list_directory, and task with agent_type='explore'.
 */
export const EXPLORE_FILTER: ToolCallFilter = (
    toolName: string,
    args: Record<string, unknown>,
): boolean => {
    if (EXPLORE_TOOL_NAMES.has(toolName)) return true;
    if (toolName === 'task' && args.agent_type === 'explore') return true;
    return false;
};

/** Matches every tool call unconditionally. Useful for debugging/analysis. */
export const ALL_TOOLS_FILTER: ToolCallFilter = () => true;

/**
 * Factory function for custom name-based filters (no args inspection).
 * Returns a filter that matches only the specified tool names.
 */
export function createToolNameFilter(...names: string[]): ToolCallFilter {
    const nameSet = new Set(names);
    return (toolName: string) => nameSet.has(toolName);
}
