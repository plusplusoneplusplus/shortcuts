/**
 * Tool Call Cache Presets
 *
 * Preset ToolCallFilter instances for common caching scenarios.
 * EXPLORE_FILTER is the primary use case: caching task agent invocations.
 *
 * No VS Code dependencies — pure Node.js.
 */

import type { ToolCallFilter } from './tool-call-cache-types';

/**
 * Matches only task tool invocations (any agent_type).
 * Read-only tools like grep, glob, view, etc. are intentionally excluded.
 */
export const EXPLORE_FILTER: ToolCallFilter = (
    toolName: string,
    _args: Record<string, unknown>,
): boolean => {
    return toolName === 'task';
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
