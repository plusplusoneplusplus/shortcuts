/**
 * AI Invoker Factory
 *
 * Creates AIInvoker instances for the CLI using the Copilot SDK service
 * from pipeline-core. Handles session management and permission approvals.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import {
    getCopilotSDKService,
    approveAllPermissions,
    denyAllPermissions,
    DEFAULT_AI_TIMEOUT_MS,
    ToolCallCapture,
    FileToolCallCacheStore,
    EXPLORE_FILTER,
} from '@plusplusoneplusplus/pipeline-core';
import type {
    AIInvoker,
    AIInvokerOptions,
    AIInvokerResult,
    CopilotSDKService,
    MCPServerConfig,
    SendMessageOptions,
    Tool,
} from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a CLI AI invoker
 */
export interface CLIAIInvokerOptions {
    /** Default model to use */
    model?: string;
    /** Whether to auto-approve all permission requests */
    approvePermissions?: boolean;
    /** Working directory for the AI session */
    workingDirectory?: string;
    /** Timeout per AI call in milliseconds */
    timeoutMs?: number;
    /** Whether to load default MCP config */
    loadMcpConfig?: boolean;
    /** Pre-filtered MCP server map; mirrors `mcpServers` on `SendMessageOptions` and can be forwarded without transformation. */
    mcpServers?: Record<string, MCPServerConfig>;
    /** Optional callback invoked with each AI output chunk for streaming */
    onChunk?: (chunk: string) => void;
    /** Custom tools to expose to the AI session */
    tools?: Tool<any>[];
    /** Override for the cache store data dir; defaults to ~/.coc/memory */
    cacheDataDir?: string;
    /** Current git HEAD hash for staleness tracking; optional — cache still works without it */
    gitHash?: string;
}

/**
 * Result from checking AI availability
 */
export interface AIAvailabilityResult {
    available: boolean;
    reason?: string;
}

// ============================================================================
// AI Invoker Factory
// ============================================================================

/**
 * Check if the Copilot SDK is available
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

/**
 * Create an AIInvoker for CLI pipeline execution.
 *
 * Uses the CopilotSDKService singleton from pipeline-core.
 * Each invocation creates a direct session (no pool) for proper permission handling.
 */
export function createCLIAIInvoker(options: CLIAIInvokerOptions = {}): AIInvoker {
    const service = getCopilotSDKService();
    const permissionHandler = options.approvePermissions
        ? approveAllPermissions
        : denyAllPermissions;

    const invoker: AIInvoker = async (
        prompt: string,
        invokerOptions?: AIInvokerOptions
    ): Promise<AIInvokerResult> => {
        try {
            const model = invokerOptions?.model || options.model;
            const timeoutMs = invokerOptions?.timeoutMs || options.timeoutMs || DEFAULT_AI_TIMEOUT_MS;

            const sendOptions: SendMessageOptions = {
                prompt,
                model,
                workingDirectory: options.workingDirectory,
                timeoutMs,
                onPermissionRequest: permissionHandler,
                loadDefaultMcpConfig: options.mcpServers !== undefined
                    ? false                             // explicit server list → skip global load
                    : options.loadMcpConfig !== false,  // existing behaviour preserved
                mcpServers: options.mcpServers,
                onStreamingChunk: options.onChunk,
                tools: options.tools,
                onToolEvent: invokerOptions?.onToolEvent,
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

    const store = new FileToolCallCacheStore(
        options.cacheDataDir ? { dataDir: options.cacheDataDir } : undefined
    );
    const capture = new ToolCallCapture(store, EXPLORE_FILTER, {
        gitHash: options.gitHash,
    });
    const captureHandler = capture.createToolEventHandler();

    return (prompt: string, invokerOptions?: AIInvokerOptions): Promise<AIInvokerResult> => {
        const mergedOptions: AIInvokerOptions = {
            ...invokerOptions,
            onToolEvent: invokerOptions?.onToolEvent
                ? (event) => { invokerOptions.onToolEvent!(event); captureHandler(event); }
                : captureHandler,
        };
        return invoker(prompt, mergedOptions);
    };
}

/**
 * Create a dry-run AI invoker that doesn't actually call AI.
 * Returns a mock response for testing/validation purposes.
 */
export function createDryRunAIInvoker(): AIInvoker {
    return async (prompt: string, _options?: AIInvokerOptions): Promise<AIInvokerResult> => {
        return {
            success: true,
            response: JSON.stringify({
                _dryRun: true,
                _promptLength: prompt.length,
                _message: 'Dry run - no AI call made',
            }),
        };
    };
}
