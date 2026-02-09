/**
 * Iterative Discovery — Merge Session
 *
 * Runs the merge + gap analysis session using the Copilot SDK.
 * Merges probe results, identifies gaps, and determines convergence.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
    type PermissionRequest,
    type PermissionRequestResult,
} from '@plusplusoneplusplus/pipeline-core';
import type { TopicProbeResult, ModuleGraph, ModuleInfo, CategoryInfo, MergeResult } from '../../types';
import { normalizeModuleId, isValidModuleId } from '../../schemas';
import { buildMergePrompt } from './merge-prompts';
import { parseMergeResponse } from './merge-response-parser';
import { printInfo, printWarning, gray } from '../../logger';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for merge session: 3 minutes */
const DEFAULT_MERGE_TIMEOUT_MS = 180_000;

/** Available tools for merge (read-only file exploration) */
const MERGE_TOOLS = ['view', 'grep', 'glob'];

// ============================================================================
// Permission Handler
// ============================================================================

/**
 * Read-only permission handler for merge sessions.
 * Allows file reads, denies everything else (writes, shell, MCP, URLs).
 */
function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approved' };
    }
    return { kind: 'denied-by-rules' };
}

// ============================================================================
// Merge Session
// ============================================================================

/**
 * Run the merge + gap analysis session.
 *
 * @param repoPath - Absolute path to the repository
 * @param probeResults - All probe results from the current round
 * @param existingGraph - Existing partial graph (if any, from prior rounds)
 * @param options - Merge options (model, timeout)
 * @returns MergeResult (partial result on failure, doesn't throw)
 */
export async function mergeProbeResults(
    repoPath: string,
    probeResults: TopicProbeResult[],
    existingGraph: ModuleGraph | null,
    options: {
        model?: string;
        timeout?: number;
    } = {}
): Promise<MergeResult> {
    const service = getCopilotSDKService();

    // Check SDK availability
    const availability = await service.isAvailable();
    if (!availability) {
        printWarning('SDK unavailable — using local merge fallback');
        return buildLocalMergeResult(probeResults, existingGraph, 'SDK unavailable');
    }

    // Build the prompt
    const prompt = buildMergePrompt(repoPath, probeResults, existingGraph);

    // Configure the SDK session
    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: repoPath,
        availableTools: MERGE_TOOLS,
        onPermissionRequest: readOnlyPermissions,
        usePool: false, // Direct session for MCP tool access
        timeoutMs: options.timeout || DEFAULT_MERGE_TIMEOUT_MS,
    };

    // Set model if specified
    if (options.model) {
        sendOptions.model = options.model;
    }

    try {
        // Send the message
        const validProbes = probeResults.filter(r => r && r.foundModules.length > 0).length;
        printInfo(`  Sending merge prompt ${gray(`(${validProbes} valid probes, ${existingGraph ? existingGraph.modules.length + ' existing modules' : 'no prior graph'})`)}`);
        const result = await service.sendMessage(sendOptions);

        if (!result.success || !result.response) {
            printWarning(`Merge session failed: ${result.error || 'empty response'} — using local merge fallback`);
            return buildLocalMergeResult(probeResults, existingGraph, 'Merge session failed');
        }

        // Parse the response
        const mergeResult = parseMergeResponse(result.response);

        // Guard: if AI merge returned fewer modules than probes found, use local merge
        const probeModuleCount = probeResults.reduce((sum, r) => sum + (r?.foundModules?.length || 0), 0);
        if (mergeResult.graph.modules.length === 0 && probeModuleCount > 0) {
            printWarning(`AI merge returned 0 modules but probes found ${probeModuleCount} — using local merge fallback`);
            return buildLocalMergeResult(probeResults, existingGraph, 'AI merge returned empty graph');
        }

        return mergeResult;
    } catch (error) {
        printWarning(`Merge session error: ${(error as Error).message} — using local merge fallback`);
        return buildLocalMergeResult(probeResults, existingGraph, `Merge session error: ${(error as Error).message}`);
    }
}

// ============================================================================
// Local Merge Fallback
// ============================================================================

/**
 * Build a MergeResult locally from probe data when the AI merge fails.
 * Deduplicates modules by ID, infers categories, and collects new topics.
 */
function buildLocalMergeResult(
    probeResults: TopicProbeResult[],
    existingGraph: ModuleGraph | null,
    reason: string,
): MergeResult {
    const moduleMap = new Map<string, ModuleInfo>();
    const categorySet = new Set<string>();

    // Incorporate existing graph modules first
    if (existingGraph) {
        for (const mod of existingGraph.modules) {
            moduleMap.set(mod.id, mod);
            if (mod.category) {
                categorySet.add(mod.category);
            }
        }
    }

    // Merge probe results into modules
    for (const probe of probeResults) {
        if (!probe || !probe.foundModules) { continue; }

        for (const found of probe.foundModules) {
            let id = found.id;
            if (!isValidModuleId(id)) {
                id = normalizeModuleId(id);
            }

            if (moduleMap.has(id)) { continue; } // Keep first occurrence

            const category = probe.topic || 'general';
            categorySet.add(category);

            moduleMap.set(id, {
                id,
                name: found.name,
                path: found.path,
                purpose: found.purpose,
                keyFiles: found.keyFiles || [],
                dependencies: [],
                dependents: [],
                complexity: 'medium',
                category,
            });
        }
    }

    const modules = Array.from(moduleMap.values());
    const categories: CategoryInfo[] = Array.from(categorySet).map(name => ({
        name,
        description: '',
    }));

    // Collect new topics from probes
    const seenTopics = new Set(probeResults.map(p => p?.topic).filter(Boolean));
    const newTopics: { topic: string; description: string; hints: string[] }[] = [];
    for (const probe of probeResults) {
        if (!probe?.discoveredTopics) { continue; }
        for (const dt of probe.discoveredTopics) {
            if (!seenTopics.has(dt.topic)) {
                seenTopics.add(dt.topic);
                newTopics.push({
                    topic: normalizeModuleId(dt.topic),
                    description: dt.description,
                    hints: dt.hints || [],
                });
            }
        }
    }

    const project = existingGraph?.project || {
        name: 'unknown',
        description: '',
        language: 'unknown',
        buildSystem: 'unknown',
        entryPoints: [],
    };

    printInfo(`  Local merge: ${modules.length} modules, ${categories.length} categories`);

    return {
        graph: {
            project,
            modules,
            categories,
            architectureNotes: existingGraph?.architectureNotes || '',
        },
        newTopics,
        converged: newTopics.length === 0,
        coverage: 0,
        reason: `Local merge fallback: ${reason}`,
    };
}
