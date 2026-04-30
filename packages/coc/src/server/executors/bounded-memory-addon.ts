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

import type { MemoryToolCaptureContext, MemoryWriteFrequency, Tool } from '@plusplusoneplusplus/forge';
import {
    BoundedMemoryStore,
    createMemoryTool,
    MemoryPromptBuilder,
    RawMemoryRecordStore,
} from '@plusplusoneplusplus/forge';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import { readRepoPreferences } from '../preferences-handler';

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
    /** Clean up any resources (e.g. raw store database connections). Safe to call multiple times. */
    dispose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const MEMORY_TOOL_SUFFIX =
    '\n\nUse the `memory` tool to save durable, high-value facts you discover during this session.';

const EMPTY_ADDON: BoundedMemoryAddon = Object.freeze({
    systemMessageSuffix: undefined,
    tools: [],
    suffix: '',
    dispose: () => { },
});

// ============================================================================
// Builder
// ============================================================================

/**
 * Builds a BoundedMemoryAddon for a given workspace.
 *
 * Returns the empty addon when disabled, unconfigured, or on error.
 * Instantiates BoundedMemoryStore per-request (cheap — single file read).
 *
 * When `captureContext` is provided the tool operates in capture mode:
 * `add` appends raw records to RawMemoryRecordStore instead of mutating
 * MEMORY.md. Prompt injection still reads only bounded MEMORY.md.
 */
export async function buildBoundedMemoryAddon(
    dataDir: string | undefined,
    workspaceId: string | undefined,
    captureContext?: MemoryToolCaptureContext,
): Promise<BoundedMemoryAddon> {
    if (!dataDir || !workspaceId) return EMPTY_ADDON;

    try {
        const prefs = readRepoPreferences(dataDir, workspaceId);
        if (!prefs.boundedMemory?.enabled) return EMPTY_ADDON;

        const charLimit = prefs.boundedMemory.charLimit;
        const writeFrequency = prefs.boundedMemory.writeFrequency as MemoryWriteFrequency | undefined;
        const memoryPath = getRepoDataPath(dataDir, workspaceId, 'memory/MEMORY.md');

        const store = new BoundedMemoryStore({
            filePath: memoryPath,
            ...(charLimit ? { charLimit } : {}),
        });
        await store.load();

        const systemMemoryPath = path.join(dataDir, 'memory', 'system', 'MEMORY.md');
        const systemStore = new BoundedMemoryStore({
            filePath: systemMemoryPath,
            ...(charLimit ? { charLimit } : {}),
        });
        await systemStore.load();

        // Prompt injection always reads bounded MEMORY.md (unchanged)
        const builder = new MemoryPromptBuilder({ store, systemStore, writeFrequency });
        const systemMessageSuffix = builder.getSystemPromptBlock() ?? undefined;

        // Determine mode and build the tool
        const useCapture = !!captureContext;

        let captureConfig: Parameters<typeof createMemoryTool>[2];
        const rawStoreInstances: RawMemoryRecordStore[] = [];
        if (useCapture) {
            const repoRawDbPath = getRepoDataPath(dataDir, workspaceId, 'memory/raw-memory.db');
            const systemRawDbPath = path.join(dataDir, 'memory', 'system', 'raw-memory.db');
            const repoRaw = new RawMemoryRecordStore({ dbPath: repoRawDbPath });
            const systemRaw = new RawMemoryRecordStore({ dbPath: systemRawDbPath });
            rawStoreInstances.push(repoRaw, systemRaw);

            captureConfig = {
                rawStores: {
                    repo: repoRaw,
                    system: systemRaw,
                },
                context: {
                    ...captureContext,
                    workspaceId,
                },
            };
        }

        const { tool } = createMemoryTool(
            { repo: store, system: systemStore },
            { source: 'coc-chat', mode: useCapture ? 'capture' : 'bounded', writeFrequency },
            captureConfig,
        );

        return {
            systemMessageSuffix,
            tools: [tool],
            suffix: MEMORY_TOOL_SUFFIX,
            dispose: () => {
                for (const rs of rawStoreInstances) {
                    try { rs.close(); } catch { /* already closed */ }
                }
            },
        };
    } catch {
        return EMPTY_ADDON;
    }
}
