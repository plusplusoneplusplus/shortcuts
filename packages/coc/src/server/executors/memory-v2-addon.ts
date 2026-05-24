/**
 * Memory V2 Addon (AC-05)
 *
 * Builds the MemoryV2Addon bundle for chat executors:
 *   - A frozen high-priority memory snapshot injected into the system prompt
 *     for cache stability (top-N facts by importance, status='active').
 *   - Per-turn recalled context injected as a fenced block in the system
 *     prompt, based on the current prompt query.
 *   - Two AI-callable tools: store_memory and recall_memory.
 *
 * Gated by `prefs.memoryV2.enabled` — returns the empty addon when disabled,
 * unconfigured, or when any error occurs during store initialization.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as path from 'path';
import type { Tool } from '@plusplusoneplusplus/forge';
import {
    createMemoryStores,
    HybridSearchEngine,
    GLOBAL_MEMORY_SUBDIR,
    WORKSPACE_MEMORY_SUBDIR,
    type MemoryFact,
    type MemorySearchResult,
} from '@plusplusoneplusplus/coc-memory';
import { readRepoPreferences } from '../preferences-handler';
import { createMemoryStoreFactTool, createMemoryRecallTool } from '../llm-tools/memory-v2-tools';

// ============================================================================
// Types
// ============================================================================

export interface MemoryV2Addon {
    /** System message suffix containing frozen snapshot + per-turn recall block. */
    systemMessageSuffix: string | undefined;
    /** The memory v2 LLM tools: store_memory + recall_memory. */
    tools: Tool<any>[];
    /** Tool guidance suffix for the system message. */
    suffix: string;
    /** Close open store connections. Safe to call multiple times. */
    dispose: () => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_FROZEN_SNAPSHOT_LIMIT = 10;
const DEFAULT_RECALL_LIMIT = 5;

const EMPTY_ADDON: MemoryV2Addon = Object.freeze({
    systemMessageSuffix: undefined,
    tools: [],
    suffix: '',
    dispose: () => {},
});

const MEMORY_TOOL_SUFFIX =
    '\n\nYou have a persistent `memory` tool. Actively capture facts, preferences, and patterns you discover during this session. When in doubt, save it — storage is cheap and forgetting is expensive.';

// ============================================================================
// Builder
// ============================================================================

/**
 * Build a MemoryV2Addon for a given workspace.
 *
 * Returns the empty addon when:
 * - `dataDir` or `workspaceId` is missing
 * - `prefs.memoryV2.enabled` is not `true`
 * - any error occurs during store initialization or fact retrieval
 *
 * @param dataDir     CoC data root (e.g. `~/.coc`)
 * @param workspaceId Workspace identifier
 * @param query       Current prompt text — used for per-turn recall search.
 *                    Pass undefined to skip per-turn recall (frozen snapshot only).
 * @param processId   Optional process ID for tool provenance.
 */
export async function buildMemoryV2Addon(
    dataDir: string | undefined,
    workspaceId: string | undefined,
    query?: string,
    processId?: string,
): Promise<MemoryV2Addon> {
    if (!dataDir || !workspaceId) return EMPTY_ADDON;

    try {
        const prefs = readRepoPreferences(dataDir, workspaceId);
        if (!prefs.memoryV2?.enabled) return EMPTY_ADDON;

        const isolated = prefs.memoryV2.isolated === true;
        const frozenLimit = prefs.memoryV2.frozenSnapshotLimit ?? DEFAULT_FROZEN_SNAPSHOT_LIMIT;
        const recallLimit = prefs.memoryV2.recallLimit ?? DEFAULT_RECALL_LIMIT;
        const scope = isolated ? 'workspace' as const : 'global' as const;

        const storeDir = isolated
            ? path.join(dataDir, 'repos', workspaceId, WORKSPACE_MEMORY_SUBDIR)
            : path.join(dataDir, GLOBAL_MEMORY_SUBDIR);

        const handle = createMemoryStores(storeDir);
        const { facts: factStore, episodes: episodeStore } = handle;

        // Build frozen snapshot: top-N active facts by importance (sorted by store)
        const frozenFacts = await factStore.listFacts({
            statuses: ['active'],
            limit: frozenLimit,
        });
        const frozenBlock = buildFrozenSnapshotBlock(frozenFacts);

        // Build per-turn recall block (only when a query is provided)
        let recallBlock: string | undefined;
        if (query?.trim()) {
            const engine = new HybridSearchEngine(factStore);
            const recalled = await engine.search({
                text: query,
                limit: recallLimit,
                statuses: ['active'],
            });
            // Record recall for the retrieved facts
            const ids = recalled.map(r => r.fact.id);
            if (ids.length > 0) {
                await factStore.recordRecall(ids);
            }
            recallBlock = buildRecallBlock(recalled);
        }

        const systemMessageSuffix = assembleSystemSuffix(frozenBlock, recallBlock) || undefined;

        // Create LLM tools
        const toolDeps = {
            factStore,
            episodeStore,
            scope,
            workspaceId: isolated ? workspaceId : undefined,
            processId,
        };
        const { tool: storeTool } = createMemoryStoreFactTool(toolDeps);
        const { tool: recallTool } = createMemoryRecallTool(toolDeps);

        return {
            systemMessageSuffix,
            tools: [storeTool, recallTool],
            suffix: MEMORY_TOOL_SUFFIX,
            dispose: () => {
                try { handle.close(); } catch { /* already closed */ }
            },
        };
    } catch {
        return EMPTY_ADDON;
    }
}

// ============================================================================
// Private helpers
// ============================================================================

function buildFrozenSnapshotBlock(facts: MemoryFact[]): string {
    if (facts.length === 0) return '';

    const lines: string[] = [
        '<memory_snapshot>',
        'High-priority remembered facts (frozen for this session):',
    ];
    for (const fact of facts) {
        const tags = fact.tags.length > 0 ? ` [${fact.tags.join(', ')}]` : '';
        lines.push(`- ${fact.content}${tags}`);
    }
    lines.push('</memory_snapshot>');
    return lines.join('\n');
}

function buildRecallBlock(results: MemorySearchResult[]): string {
    if (results.length === 0) return '';

    const lines: string[] = [
        '<recalled_memory>',
        'Recalled facts relevant to this request (background context only):',
    ];
    for (const r of results) {
        const tags = r.fact.tags.length > 0 ? ` [${r.fact.tags.join(', ')}]` : '';
        lines.push(`- ${r.fact.content}${tags}`);
    }
    lines.push('</recalled_memory>');
    return lines.join('\n');
}

function assembleSystemSuffix(frozenBlock: string, recallBlock: string | undefined): string {
    const parts: string[] = [];
    if (frozenBlock) parts.push(frozenBlock);
    if (recallBlock) parts.push(recallBlock);
    return parts.join('\n\n');
}
