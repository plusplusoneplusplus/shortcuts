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
    DEFAULT_CHAR_LIMIT,
    MemoryCandidateStore,
    MemoryPromptBuilder,
    MemoryRecallIndex,
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

const DEFAULT_RECALL_MAX_ENTRIES = 8;

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
 * `add` upserts durable candidates instead of mutating MEMORY.md. Prompt
 * injection still reads only bounded MEMORY.md.
 */
export async function buildBoundedMemoryAddon(
    dataDir: string | undefined,
    workspaceId: string | undefined,
    captureContext?: MemoryToolCaptureContext,
    recallQuery?: string,
): Promise<BoundedMemoryAddon> {
    if (!dataDir || !workspaceId) return EMPTY_ADDON;

    try {
        const prefs = readRepoPreferences(dataDir, workspaceId);
        if (!prefs.boundedMemory?.enabled) return EMPTY_ADDON;

        const charLimit = prefs.boundedMemory.charLimit;
        const writeFrequency = prefs.boundedMemory.writeFrequency as MemoryWriteFrequency | undefined;
        const recallPrefs = prefs.boundedMemory.recall;
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

        const recallEnabled = recallPrefs?.enabled !== false && !!recallQuery?.trim();
        const recallIndex = recallEnabled
            ? new MemoryRecallIndex({
                dbPath: getRepoDataPath(dataDir, workspaceId, 'memory/recall-index.db'),
            })
            : undefined;
        const recallCharBudget = recallPrefs?.charBudget
            ?? Math.min(charLimit ?? DEFAULT_CHAR_LIMIT, DEFAULT_CHAR_LIMIT);

        const builder = new MemoryPromptBuilder({
            store,
            systemStore,
            writeFrequency,
            ...(recallIndex && recallQuery ? {
                recall: {
                    index: recallIndex,
                    namespace: workspaceId,
                    query: recallQuery,
                    maxEntries: recallPrefs?.maxEntries ?? DEFAULT_RECALL_MAX_ENTRIES,
                    charBudget: recallCharBudget,
                    maxBm25Score: recallPrefs?.maxBm25Score,
                },
            } : {}),
        });
        const systemMessageSuffix = builder.getSystemPromptBlock() ?? undefined;

        // Determine mode and build the tool
        const useCapture = !!captureContext;

        let captureConfig: Parameters<typeof createMemoryTool>[2];
        const candidateStoreInstances: MemoryCandidateStore[] = [];
        if (useCapture) {
            const repoCandidateDbPath = getRepoDataPath(dataDir, workspaceId, 'memory/raw-memory.db');
            const systemCandidateDbPath = path.join(dataDir, 'memory', 'system', 'raw-memory.db');
            const repoCandidates = new MemoryCandidateStore({ dbPath: repoCandidateDbPath });
            const systemCandidates = new MemoryCandidateStore({ dbPath: systemCandidateDbPath });
            candidateStoreInstances.push(repoCandidates, systemCandidates);

            captureConfig = {
                candidateStores: {
                    repo: repoCandidates,
                    system: systemCandidates,
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
                try { recallIndex?.close(); } catch { /* already closed */ }
                for (const store of candidateStoreInstances) {
                    try { store.close(); } catch { /* already closed */ }
                }
            },
        };
    } catch {
        return EMPTY_ADDON;
    }
}
