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
import type { TopicProbeResult, ModuleGraph, MergeResult } from '../../types';
import { buildMergePrompt } from './merge-prompts';
import { parseMergeResponse } from './merge-response-parser';

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
        // Return partial result on SDK unavailability
        return {
            graph: existingGraph || {
                project: {
                    name: 'unknown',
                    description: '',
                    language: 'unknown',
                    buildSystem: 'unknown',
                    entryPoints: [],
                },
                modules: [],
                categories: [],
                architectureNotes: '',
            },
            newTopics: [],
            converged: true, // Stop iteration if SDK unavailable
            coverage: 0,
            reason: 'SDK unavailable',
        };
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
        const result = await service.sendMessage(sendOptions);

        if (!result.success || !result.response) {
            // Return partial result on failure
            return {
                graph: existingGraph || {
                    project: {
                        name: 'unknown',
                        description: '',
                        language: 'unknown',
                        buildSystem: 'unknown',
                        entryPoints: [],
                    },
                    modules: [],
                    categories: [],
                    architectureNotes: '',
                },
                newTopics: [],
                converged: true, // Stop iteration on failure
                coverage: 0,
                reason: 'Merge session failed',
            };
        }

        // Parse the response
        return parseMergeResponse(result.response);
    } catch (error) {
        // Return partial result on error
        return {
            graph: existingGraph || {
                project: {
                    name: 'unknown',
                    description: '',
                    language: 'unknown',
                    buildSystem: 'unknown',
                    entryPoints: [],
                },
                modules: [],
                categories: [],
                architectureNotes: '',
            },
            newTopics: [],
            converged: true, // Stop iteration on error
            coverage: 0,
            reason: `Merge session error: ${(error as Error).message}`,
        };
    }
}
