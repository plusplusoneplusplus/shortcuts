/**
 * Bounded Memory Addon
 *
 * Encapsulates all bounded-memory wiring for executors. Builds a
 * self-contained addon containing the system message suffix (frozen
 * MEMORY.md snapshot), the AI-callable memory tool, and the prompt
 * suffix directive.
 *
 * Follows the existing addon pattern (buildFollowUpSuggestionsAddon,
 * buildSearchConversationsAddon, etc.) in prompt-builder.ts.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { Tool } from '@plusplusoneplusplus/forge';
import {
    BoundedMemoryStore,
    MemoryPromptBuilder,
    createMemoryTool,
} from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences-handler';
import { getRepoDataPath } from '../paths';

// ============================================================================
// Types
// ============================================================================

export interface BoundedMemoryAddon {
    /** SystemMessageConfig fragment to append (the frozen snapshot + MEMORY_GUIDANCE). */
    systemMessageSuffix: string | undefined;
    /** The memory tool for the AI to call during the conversation. */
    tools: Tool<any>[];
    /** Prompt suffix instructing the AI about the memory tool. */
    suffix: string;
}

// ============================================================================
// Constants
// ============================================================================

const MEMORY_TOOL_SUFFIX =
    '\n\nYou have access to the `memory` tool. Use it to save important facts about' +
    ' this codebase that would help in future conversations. Do NOT save trivial or' +
    ' obvious information.';

const EMPTY_ADDON: BoundedMemoryAddon = Object.freeze({
    systemMessageSuffix: undefined,
    tools: [],
    suffix: '',
});

// ============================================================================
// Builder
// ============================================================================

/**
 * Builds a BoundedMemoryAddon for a given workspace.
 *
 * Returns the empty addon when disabled, unconfigured, or on error.
 * Instantiates BoundedMemoryStore per-request (cheap — single file read).
 */
export async function buildBoundedMemoryAddon(
    dataDir: string | undefined,
    workspaceId: string | undefined,
): Promise<BoundedMemoryAddon> {
    if (!dataDir || !workspaceId) return EMPTY_ADDON;

    try {
        const prefs = readRepoPreferences(dataDir, workspaceId);
        if (!prefs.boundedMemory?.enabled) return EMPTY_ADDON;

        const charLimit = prefs.boundedMemory.charLimit;
        const memoryPath = getRepoDataPath(dataDir, workspaceId, 'memory/MEMORY.md');

        const store = new BoundedMemoryStore({
            filePath: memoryPath,
            ...(charLimit ? { charLimit } : {}),
        });
        await store.load();

        const builder = new MemoryPromptBuilder({ store });
        const systemMessageSuffix = builder.getSystemPromptBlock() ?? undefined;

        const { tool } = createMemoryTool(
            { memory: store },
            { source: 'coc-chat' },
        );

        return {
            systemMessageSuffix,
            tools: [tool],
            suffix: MEMORY_TOOL_SUFFIX,
        };
    } catch {
        return EMPTY_ADDON;
    }
}
