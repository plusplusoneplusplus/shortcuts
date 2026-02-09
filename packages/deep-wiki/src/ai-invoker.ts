/**
 * AI Invoker Factory
 *
 * Creates AIInvoker instances for different phases of deep-wiki generation.
 * Phase 2 (Analysis) uses direct sessions with MCP tools for code investigation.
 * Phase 3 (Writing) uses direct sessions without tools for article generation.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    SendMessageOptions,
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating an analysis invoker (Phase 2).
 * Uses direct sessions with MCP tools for code investigation.
 */
export interface AnalysisInvokerOptions {
    /** Absolute path to the repository (working directory for MCP tools) */
    repoPath: string;
    /** AI model to use */
    model?: string;
    /** Timeout per module in milliseconds (default: 180000 = 3 min) */
    timeoutMs?: number;
}

/**
 * Options for creating a writing invoker (Phase 3).
 * Uses direct sessions without tools for article generation.
 */
export interface WritingInvokerOptions {
    /** AI model to use */
    model?: string;
    /** Timeout per article in milliseconds (default: 120000 = 2 min) */
    timeoutMs?: number;
}

/**
 * Result from checking AI availability.
 */
export interface AIAvailabilityResult {
    available: boolean;
    reason?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for analysis per module (3 minutes) */
const DEFAULT_ANALYSIS_TIMEOUT_MS = 180_000;

/** Default timeout for writing per article (2 minutes) */
const DEFAULT_WRITING_TIMEOUT_MS = 120_000;

/** MCP tools available during analysis */
const ANALYSIS_TOOLS = ['view', 'grep', 'glob'];

// ============================================================================
// AI Availability Check
// ============================================================================

/**
 * Check if the Copilot SDK is available for AI operations.
 */
export async function checkAIAvailability(): Promise<AIAvailabilityResult> {
    try {
        const service = getCopilotSDKService();
        const result = await service.isAvailable();
        return {
            available: result.available,
            reason: result.error,
        };
    } catch (error) {
        return {
            available: false,
            reason: error instanceof Error ? error.message : String(error),
        };
    }
}

// ============================================================================
// Analysis Invoker (Phase 2)
// ============================================================================

/**
 * Create an AIInvoker for Phase 2 (Deep Analysis).
 *
 * Uses direct sessions (usePool: false) with read-only MCP tools
 * (view, grep, glob) so the AI can investigate source code.
 * Permissions: approve reads, deny everything else.
 */
export function createAnalysisInvoker(options: AnalysisInvokerOptions): AIInvoker {
    const service = getCopilotSDKService();

    return async (prompt: string, invokerOptions?: AIInvokerOptions): Promise<AIInvokerResult> => {
        try {
            const model = invokerOptions?.model || options.model;
            const timeoutMs = invokerOptions?.timeoutMs || options.timeoutMs || DEFAULT_ANALYSIS_TIMEOUT_MS;

            const sendOptions: SendMessageOptions = {
                prompt,
                model,
                workingDirectory: options.repoPath,
                timeoutMs,
                usePool: false, // Direct session — MCP tools require it
                availableTools: ANALYSIS_TOOLS,
                onPermissionRequest: (req) =>
                    req.kind === 'read' ? { kind: 'approved' } : { kind: 'denied-by-rules' },
                loadDefaultMcpConfig: false, // Don't load user's MCP config
            };

            const result = await service.sendMessage(sendOptions);

            return {
                success: result.success,
                response: result.response || '',
                error: result.error,
            };
        } catch (error) {
            return {
                success: false,
                response: '',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    };
}

// ============================================================================
// Writing Invoker (Phase 3)
// ============================================================================

/**
 * Create an AIInvoker for Phase 3 (Article Writing).
 *
 * Uses direct sessions (usePool: false) without tools for
 * article generation. No MCP tools are needed since all context
 * is provided in the prompt.
 */
export function createWritingInvoker(options: WritingInvokerOptions): AIInvoker {
    const service = getCopilotSDKService();

    return async (prompt: string, invokerOptions?: AIInvokerOptions): Promise<AIInvokerResult> => {
        try {
            const model = invokerOptions?.model || options.model;
            const timeoutMs = invokerOptions?.timeoutMs || options.timeoutMs || DEFAULT_WRITING_TIMEOUT_MS;

            const sendOptions: SendMessageOptions = {
                prompt,
                model,
                timeoutMs,
                usePool: false, // Direct session — consistent with all deep-wiki phases
                loadDefaultMcpConfig: false, // Writing doesn't need MCP; avoid user's global MCP config
            };

            const result = await service.sendMessage(sendOptions);

            return {
                success: result.success,
                response: result.response || '',
                error: result.error,
            };
        } catch (error) {
            return {
                success: false,
                response: '',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    };
}

// ============================================================================
// Consolidation Invoker (Phase 1.5)
// ============================================================================

/**
 * Options for creating a consolidation invoker (Phase 1.5).
 * Uses direct sessions without tools for semantic clustering.
 */
export interface ConsolidationInvokerOptions {
    /** Working directory for SDK session (typically the output directory) */
    workingDirectory: string;
    /** AI model to use */
    model?: string;
    /** Timeout for clustering session in milliseconds (default: 120000 = 2 min) */
    timeoutMs?: number;
}

/** Default timeout for consolidation clustering (2 minutes) */
const DEFAULT_CONSOLIDATION_TIMEOUT_MS = 120_000;

/**
 * Create an AIInvoker for Phase 1.5 (Module Consolidation).
 *
 * Uses direct sessions (usePool: false) without tools.
 * The AI only needs to analyze the module list and return clusters.
 */
export function createConsolidationInvoker(options: ConsolidationInvokerOptions): AIInvoker {
    const service = getCopilotSDKService();

    return async (prompt: string, invokerOptions?: AIInvokerOptions): Promise<AIInvokerResult> => {
        try {
            const model = invokerOptions?.model || options.model;
            const timeoutMs = invokerOptions?.timeoutMs || options.timeoutMs || DEFAULT_CONSOLIDATION_TIMEOUT_MS;

            const sendOptions: SendMessageOptions = {
                prompt,
                model,
                timeoutMs,
                workingDirectory: options.workingDirectory,
                usePool: false,
                loadDefaultMcpConfig: false,
            };

            const result = await service.sendMessage(sendOptions);

            return {
                success: result.success,
                response: result.response || '',
                error: result.error,
            };
        } catch (error) {
            return {
                success: false,
                response: '',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    };
}
