/**
 * Iterative Discovery — Probe Session
 *
 * Runs a single theme probe session using the Copilot SDK.
 * Creates a direct session with MCP tools and parses the response.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    type SendMessageOptions,
    type PermissionRequest,
    type PermissionRequestResult,
} from '@plusplusoneplusplus/pipeline-core';
import type { ThemeSeed } from '../../types';
import type { ThemeProbeResult } from './types';
import { buildProbePrompt } from './probe-prompts';
import { parseProbeResponse } from './probe-response-parser';
import { printInfo, printWarning, gray } from '../../logger';
import { getErrorMessage } from '../../utils/error-utils';

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for probe session: 30 minutes */
const DEFAULT_PROBE_TIMEOUT_MS = 1_800_000;

/** Available tools for probe (read-only file exploration) */
const PROBE_TOOLS = ['view', 'grep', 'glob'];

// ============================================================================
// Permission Handler
// ============================================================================

/**
 * Read-only permission handler for probe sessions.
 * Allows file reads, denies everything else (writes, shell, MCP, URLs).
 */
function readOnlyPermissions(request: PermissionRequest): PermissionRequestResult {
    if (request.kind === 'read') {
        return { kind: 'approved' };
    }
    return { kind: 'denied-by-rules' };
}

// ============================================================================
// Probe Session
// ============================================================================

/**
 * Run a single theme probe session.
 *
 * @param repoPath - Absolute path to the repository
 * @param theme - The theme seed to probe
 * @param options - Probe options (model, timeout, focus)
 * @returns ThemeProbeResult (empty result on failure, doesn't throw)
 */
export async function runThemeProbe(
    repoPath: string,
    theme: ThemeSeed,
    options: {
        model?: string;
        timeout?: number;
        focus?: string;
    } = {}
): Promise<ThemeProbeResult> {
    const service = getCopilotSDKService();

    // Check SDK availability
    const availability = await service.isAvailable();
    if (!availability) {
        // Return empty result on SDK unavailability
        return {
            theme: theme.theme,
            foundComponents: [],
            discoveredThemes: [],
            dependencies: [],
            confidence: 0,
        };
    }

    // Build the prompt
    const prompt = buildProbePrompt(repoPath, theme, options.focus);

    // Configure the SDK session
    const sendOptions: SendMessageOptions = {
        prompt,
        workingDirectory: repoPath,
        availableTools: PROBE_TOOLS,
        onPermissionRequest: readOnlyPermissions,
        usePool: false, // Direct session for MCP tool access
        timeoutMs: options.timeout || DEFAULT_PROBE_TIMEOUT_MS,
    };

    // Set model if specified
    if (options.model) {
        sendOptions.model = options.model;
    }

    try {
        // Send the message
        printInfo(`    Probing theme: ${theme.theme} ${gray(`(timeout: ${(options.timeout || DEFAULT_PROBE_TIMEOUT_MS) / 1000}s)`)}`);
        const result = await service.sendMessage(sendOptions);

        if (!result.success || !result.response) {
            // Return empty result on failure
            printWarning(`    Probe failed for "${theme.theme}": ${result.error || 'empty response'}`);
            return {
                theme: theme.theme,
                foundComponents: [],
                discoveredThemes: [],
                dependencies: [],
                confidence: 0,
            };
        }

        // Parse the response
        const parsed = parseProbeResponse(result.response, theme.theme);
        printInfo(`    Probe "${theme.theme}" found ${parsed.foundComponents.length} components ${gray(`(confidence: ${parsed.confidence})`)}`);
        return parsed;
    } catch (error) {
        // Return empty result on error (don't crash the loop)
        printWarning(`    Probe error for "${theme.theme}": ${getErrorMessage(error)}`);
        return {
            theme: theme.theme,
            foundComponents: [],
            discoveredThemes: [],
            dependencies: [],
            confidence: 0,
        };
    }
}
