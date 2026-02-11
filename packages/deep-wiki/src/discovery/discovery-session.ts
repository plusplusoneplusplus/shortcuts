/**
 * Discovery Phase — SDK Session Orchestration
 *
 * Orchestrates the Copilot SDK session for repository discovery.
 * Creates a direct session with MCP tools (grep, glob, view),
 * sends the discovery prompt, and parses the response.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
    type PermissionRequest,
    type PermissionRequestResult,
    type TokenUsage,
} from '@plusplusoneplusplus/pipeline-core';
import type { DiscoveryOptions, ModuleGraph } from '../types';
import { buildDiscoveryPrompt } from './prompts';
import { parseModuleGraphResponse } from './response-parser';
import { printInfo, printWarning, gray } from '../logger';
import { getErrorMessage } from '../utils/error-utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for discovery session: 30 minutes */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 1_800_000;

/** Available tools for discovery (read-only file exploration) */
const DISCOVERY_TOOLS = ['view', 'grep', 'glob'];

// ============================================================================
// Permission Handler
// ============================================================================

/**
 * Read-only permission handler for discovery sessions.
 * Allows file reads, denies everything else (writes, shell, MCP, URLs).
 */
function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approved' };
    }
    return { kind: 'denied-by-rules' };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a discovery session, including token usage.
 */
export interface DiscoverySessionResult {
    /** The parsed module graph */
    graph: ModuleGraph;
    /** Aggregated token usage across all SDK calls (initial + retry) */
    tokenUsage?: TokenUsage;
}

// ============================================================================
// Discovery Session
// ============================================================================

/**
 * Run a discovery session against a repository.
 *
 * Creates a direct SDK session with read-only MCP tools, sends the
 * discovery prompt, and parses the AI response into a ModuleGraph.
 *
 * @param options - Discovery options (repoPath, model, timeout, focus)
 * @returns The parsed ModuleGraph
 * @throws Error if SDK is unavailable, AI times out, or response is malformed
 */
export async function runDiscoverySession(options: DiscoveryOptions): Promise<DiscoverySessionResult> {
    const service = getCopilotSDKService();

    // Check SDK availability
    printInfo('Checking Copilot SDK availability...');
    const availability = await service.isAvailable();
    if (!availability) {
        throw new DiscoveryError(
            'Copilot SDK is not available. Ensure GitHub Copilot is installed and authenticated.',
            'sdk-unavailable'
        );
    }

    // Build the prompt
    printInfo(`Building discovery prompt ${options.focus ? `with focus: ${options.focus}` : 'for full repository'}...`);
    const prompt = buildDiscoveryPrompt(options.repoPath, options.focus);

    // Configure the SDK session
    const timeoutMs = options.timeout || DEFAULT_DISCOVERY_TIMEOUT_MS;
    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: options.repoPath,
        availableTools: DISCOVERY_TOOLS,
        onPermissionRequest: readOnlyPermissions,
        usePool: false, // Direct session for MCP tool access
        timeoutMs,
    };

    // Set model if specified
    if (options.model) {
        sendOptions.model = options.model;
    }

    // Send the message
    printInfo(`Sending discovery prompt to AI ${gray(`(timeout: ${timeoutMs / 1000}s, tools: ${DISCOVERY_TOOLS.join(', ')})`)}`);
    const result = await service.sendMessage(sendOptions);

    if (!result.success) {
        const errorMsg = result.error || 'Unknown SDK error';
        if (errorMsg.toLowerCase().includes('timeout')) {
            throw new DiscoveryError(
                `Discovery timed out after ${timeoutMs / 1000}s. ` +
                'Try increasing --timeout or using --focus to narrow the scope.',
                'timeout'
            );
        }
        throw new DiscoveryError(`AI discovery failed: ${errorMsg}`, 'ai-error');
    }

    if (!result.response) {
        throw new DiscoveryError('AI returned empty response', 'empty-response');
    }

    // Parse the response into a ModuleGraph
    printInfo('Parsing AI response into module graph...');
    try {
        const graph = parseModuleGraphResponse(result.response);
        printInfo(`Parsed ${graph.modules.length} modules across ${graph.categories.length} categories`);
        return { graph, tokenUsage: result.tokenUsage };
    } catch (parseError) {
        // On parse failure, retry once with a stricter prompt
        printWarning(`Failed to parse response: ${getErrorMessage(parseError)}. Retrying with stricter prompt...`);
        const retryPrompt = prompt + '\n\nIMPORTANT: Your previous response was not valid JSON. Please return ONLY a raw JSON object. No markdown, no explanation, just JSON.';

        const retryOptions: SendMessageOptions = {
            ...sendOptions,
            prompt: retryPrompt,
        };

        const retryResult = await service.sendMessage(retryOptions);

        if (!retryResult.success || !retryResult.response) {
            throw new DiscoveryError(
                `Failed to parse AI response: ${getErrorMessage(parseError)}`,
                'parse-error'
            );
        }

        const graph = parseModuleGraphResponse(retryResult.response);
        printInfo(`Retry succeeded — parsed ${graph.modules.length} modules`);
        // Merge tokenUsage from both attempts
        const mergedUsage = mergeTokenUsage(result.tokenUsage, retryResult.tokenUsage);
        return { graph, tokenUsage: mergedUsage };
    }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Merge two TokenUsage objects by summing their fields.
 */
function mergeTokenUsage(a?: TokenUsage, b?: TokenUsage): TokenUsage | undefined {
    if (!a && !b) { return undefined; }
    if (!a) { return b; }
    if (!b) { return a; }
    return {
        inputTokens: a.inputTokens + b.inputTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
        cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
        totalTokens: a.totalTokens + b.totalTokens,
        cost: (a.cost ?? 0) + (b.cost ?? 0) || undefined,
        turnCount: a.turnCount + b.turnCount,
    };
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error type for discovery phase failures.
 */
export class DiscoveryError extends Error {
    constructor(
        message: string,
        public readonly code: 'sdk-unavailable' | 'timeout' | 'ai-error' | 'empty-response' | 'parse-error'
    ) {
        super(message);
        this.name = 'DiscoveryError';
    }
}
