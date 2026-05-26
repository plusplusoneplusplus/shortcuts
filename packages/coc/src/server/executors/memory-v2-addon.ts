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
 * Reads from both Global memory (gated by globalPrefs.memoryV2.enabled) and
 * Workspace memory (gated by repoPrefs.memoryV2.enabled). Returns the empty
 * addon when neither scope is enabled or any error occurs.
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
import { readGlobalPreferences, readRepoPreferences } from '../preferences-handler';
import { createMemoryStoreFactTool, createMemoryRecallTool, type MemoryV2ToolDeps } from '../llm-tools/memory-v2-tools';

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
    /** Built-in Copilot tools that should be excluded when memory V2 is active. */
    excludedBuiltinTools: string[];
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
    excludedBuiltinTools: [],
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
 * Opens enabled memory scopes:
 * - Global store: gated by `globalPrefs.memoryV2.enabled`
 * - Workspace store: gated by `repoPrefs.memoryV2.enabled`
 *
 * Returns the empty addon when:
 * - `dataDir` or `workspaceId` is missing
 * - neither global nor workspace memory is enabled
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

    let globalHandle: ReturnType<typeof createMemoryStores> | undefined;
    let workspaceHandle: ReturnType<typeof createMemoryStores> | undefined;

    try {
        const globalPrefs = readGlobalPreferences(dataDir);
        const repoPrefs = readRepoPreferences(dataDir, workspaceId);

        const globalEnabled = globalPrefs.memoryV2?.enabled === true;
        const workspaceEnabled = repoPrefs.memoryV2?.enabled === true;

        if (!globalEnabled && !workspaceEnabled) return EMPTY_ADDON;

        const frozenLimit = globalPrefs.memoryV2?.frozenSnapshotLimit
            ?? repoPrefs.memoryV2?.frozenSnapshotLimit
            ?? DEFAULT_FROZEN_SNAPSHOT_LIMIT;
        const recallLimit = globalPrefs.memoryV2?.recallLimit
            ?? repoPrefs.memoryV2?.recallLimit
            ?? DEFAULT_RECALL_LIMIT;

        // Open stores for enabled scopes
        if (globalEnabled) {
            const globalStoreDir = path.join(dataDir, GLOBAL_MEMORY_SUBDIR);
            globalHandle = createMemoryStores(globalStoreDir);
        }

        if (workspaceEnabled) {
            const wsStoreDir = path.join(dataDir, 'repos', workspaceId, WORKSPACE_MEMORY_SUBDIR);
            workspaceHandle = createMemoryStores(wsStoreDir);
        }

        // Build frozen snapshot from all enabled scopes
        const allFrozenFacts: MemoryFact[] = [];
        if (globalHandle) {
            const gFacts = await globalHandle.facts.listFacts({ statuses: ['active'], limit: frozenLimit });
            allFrozenFacts.push(...gFacts);
        }
        if (workspaceHandle) {
            const wFacts = await workspaceHandle.facts.listFacts({ statuses: ['active'], limit: frozenLimit });
            allFrozenFacts.push(...wFacts);
        }
        const frozenBlock = buildFrozenSnapshotBlock(allFrozenFacts);

        // Build per-turn recall block (only when a query is provided)
        let recallBlock: string | undefined;
        if (query?.trim()) {
            const allRecalled: MemorySearchResult[] = [];

            if (globalHandle) {
                const engine = new HybridSearchEngine(globalHandle.facts);
                const results = await engine.search({ text: query, limit: recallLimit, statuses: ['active'] });
                const ids = results.map(r => r.fact.id);
                if (ids.length > 0) await globalHandle.facts.recordRecall(ids);
                allRecalled.push(...results);
            }

            if (workspaceHandle) {
                const engine = new HybridSearchEngine(workspaceHandle.facts);
                const results = await engine.search({ text: query, limit: recallLimit, statuses: ['active'] });
                const ids = results.map(r => r.fact.id);
                if (ids.length > 0) await workspaceHandle.facts.recordRecall(ids);
                allRecalled.push(...results);
            }

            // Sort by score and deduplicate (facts can only appear in one store, but guard anyway)
            const seen = new Set<string>();
            const deduped = allRecalled
                .sort((a, b) => b.score - a.score)
                .filter(r => {
                    if (seen.has(r.fact.id)) return false;
                    seen.add(r.fact.id);
                    return true;
                })
                .slice(0, recallLimit);

            recallBlock = buildRecallBlock(deduped);
        }

        const systemMessageSuffix = assembleSystemSuffix(frozenBlock, recallBlock) || undefined;

        // Create LLM tools
        const toolDeps: MemoryV2ToolDeps = {
            globalFactStore: globalHandle?.facts,
            globalEpisodeStore: globalHandle?.episodes,
            workspaceFactStore: workspaceHandle?.facts,
            workspaceEpisodeStore: workspaceHandle?.episodes,
            workspaceId,
            processId,
        };
        const { tool: storeTool } = createMemoryStoreFactTool(toolDeps);
        const { tool: recallTool } = createMemoryRecallTool(toolDeps);

        const dispose = () => {
            try { globalHandle?.close(); } catch { /* already closed */ }
            try { workspaceHandle?.close(); } catch { /* already closed */ }
        };

        return {
            systemMessageSuffix,
            tools: [storeTool, recallTool],
            suffix: MEMORY_TOOL_SUFFIX,
            excludedBuiltinTools: ['vote_memory', 'store_memory'],
            dispose,
        };
    } catch {
        try { globalHandle?.close(); } catch { /* ignore */ }
        try { workspaceHandle?.close(); } catch { /* ignore */ }
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
