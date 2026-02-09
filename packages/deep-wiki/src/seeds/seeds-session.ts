/**
 * Seeds Phase — SDK Session Orchestration
 *
 * Orchestrates the Copilot SDK session for topic seed generation.
 * Creates a direct session with MCP tools (grep, glob, view),
 * sends the seeds prompt, and parses the response.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
    type PermissionRequest,
    type PermissionRequestResult,
} from '@plusplusoneplusplus/pipeline-core';
import type { SeedsCommandOptions, TopicSeed } from '../types';
import { buildSeedsPrompt } from './prompts';
import { parseSeedsResponse } from './response-parser';
import { generateHeuristicSeeds } from './heuristic-fallback';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for seeds session: 2 minutes */
const DEFAULT_SEEDS_TIMEOUT_MS = 120_000;

/** Available tools for seeds (read-only file exploration) */
const SEEDS_TOOLS = ['view', 'grep', 'glob'];

// ============================================================================
// Permission Handler
// ============================================================================

/**
 * Read-only permission handler for seeds sessions.
 * Allows file reads, denies everything else (writes, shell, MCP, URLs).
 */
function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approved' };
    }
    return { kind: 'denied-by-rules' };
}

// ============================================================================
// Seeds Session
// ============================================================================

/**
 * Run a seeds generation session against a repository.
 *
 * Creates a direct SDK session with read-only MCP tools, sends the
 * seeds prompt, and parses the AI response into TopicSeed array.
 * Falls back to heuristic directory-based generation if AI under-generates.
 *
 * @param repoPath - Absolute path to the repository
 * @param options - Seeds command options (maxTopics, minTopics, model, verbose)
 * @returns Array of TopicSeed objects
 * @throws Error if SDK is unavailable, AI times out, or response is malformed
 */
export async function runSeedsSession(
    repoPath: string,
    options: Pick<SeedsCommandOptions, 'maxTopics' | 'minTopics' | 'model' | 'verbose'>
): Promise<TopicSeed[]> {
    const service = getCopilotSDKService();

    // Check SDK availability
    const availability = await service.isAvailable();
    if (!availability) {
        throw new SeedsError(
            'Copilot SDK is not available. Ensure GitHub Copilot is installed and authenticated.',
            'sdk-unavailable'
        );
    }

    // Build the prompt
    const prompt = buildSeedsPrompt(repoPath, options.minTopics, options.maxTopics);

    // Configure the SDK session
    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: repoPath,
        availableTools: SEEDS_TOOLS,
        onPermissionRequest: readOnlyPermissions,
        usePool: false, // Direct session for MCP tool access
        timeoutMs: DEFAULT_SEEDS_TIMEOUT_MS,
    };

    // Set model if specified
    if (options.model) {
        sendOptions.model = options.model;
    }

    // Send the message
    const result = await service.sendMessage(sendOptions);

    if (!result.success) {
        const errorMsg = result.error || 'Unknown SDK error';
        if (errorMsg.toLowerCase().includes('timeout')) {
            throw new SeedsError(
                `Seeds generation timed out after ${DEFAULT_SEEDS_TIMEOUT_MS / 1000}s. ` +
                'Falling back to directory-based heuristic.',
                'timeout'
            );
        }
        throw new SeedsError(`AI seeds generation failed: ${errorMsg}`, 'ai-error');
    }

    if (!result.response) {
        throw new SeedsError('AI returned empty response', 'empty-response');
    }

    // Parse the response into TopicSeed array
    let seeds: TopicSeed[];
    try {
        seeds = parseSeedsResponse(result.response);
    } catch (parseError) {
        // On parse failure, fall back to heuristic
        if (options.verbose) {
            process.stderr.write(
                `[WARN] Failed to parse AI response: ${(parseError as Error).message}. Falling back to heuristic.\n`
            );
        }
        return generateHeuristicSeeds(repoPath);
    }

    // Check if AI under-generated (below minTopics)
    if (seeds.length < options.minTopics) {
        if (options.verbose) {
            process.stderr.write(
                `[WARN] AI generated only ${seeds.length} topics (minimum: ${options.minTopics}). ` +
                'Falling back to directory-based heuristic.\n'
            );
        }
        return generateHeuristicSeeds(repoPath);
    }

    // Limit to maxTopics if AI over-generated
    if (seeds.length > options.maxTopics) {
        if (options.verbose) {
            process.stderr.write(
                `[WARN] AI generated ${seeds.length} topics (maximum: ${options.maxTopics}). Truncating to ${options.maxTopics}.\n`
            );
        }
        return seeds.slice(0, options.maxTopics);
    }

    return seeds;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error type for seeds phase failures.
 */
export class SeedsError extends Error {
    constructor(
        message: string,
        public readonly code: 'sdk-unavailable' | 'timeout' | 'ai-error' | 'empty-response' | 'parse-error'
    ) {
        super(message);
        this.name = 'SeedsError';
    }
}
