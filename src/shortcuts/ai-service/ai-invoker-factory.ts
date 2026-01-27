/**
 * AI Invoker Factory
 *
 * Provides a unified factory function for creating AI invokers that handle
 * the SDK/CLI fallback chain automatically. This eliminates code duplication
 * across features that need to invoke AI (clarification, code review,
 * discovery, pipelines).
 *
 * The factory encapsulates the common pattern:
 * 1. Check backend setting (copilot-sdk, copilot-cli, clipboard)
 * 2. If SDK: check availability → try SDK → if fail, fall back to CLI
 * 3. Use CLI as primary or fallback
 * 4. Optionally fall back to clipboard on complete failure
 */

import * as vscode from 'vscode';
import { copyToClipboard, invokeCopilotCLI } from './copilot-cli-invoker';
import { getCopilotSDKService, AIInvocationResult, approveAllPermissions } from '@plusplusoneplusplus/pipeline-core';
import { getAIBackendSetting, getSDKLoadMcpConfigSetting } from './ai-config-helpers';
import { getExtensionLogger, LogCategory } from './ai-service-logger';
import { IAIProcessManager } from './types';

/**
 * Options for creating an AI invoker
 */
export interface AIInvokerFactoryOptions {
    /**
     * Use session pool for parallel workloads.
     * Set to true for features that make multiple concurrent requests
     * (e.g., code review with multiple rules, pipeline execution).
     * Set to false for one-off requests (e.g., clarification, discovery).
     * @default false
     */
    usePool?: boolean;

    /**
     * Working directory for AI operations.
     * Used by both SDK and CLI backends.
     */
    workingDirectory: string;

    /**
     * Default model to use for AI requests.
     * Can be overridden per-invocation.
     */
    model?: string;

    /**
     * Timeout in milliseconds for AI requests.
     * Only used by SDK backend.
     */
    timeoutMs?: number;

    /**
     * Feature name for logging purposes.
     * Helps identify which feature is making the request in logs.
     * @example "Code Review", "Pipeline", "Discovery", "Clarification"
     */
    featureName?: string;

    /**
     * Whether to copy prompt to clipboard on complete failure.
     * Useful for user-facing features where the user can manually
     * paste the prompt into an AI tool.
     * @default false
     */
    clipboardFallback?: boolean;

    /**
     * Whether to approve all permission requests (file writes, shell commands, etc.).
     * Use with caution - this allows the AI to modify files and execute commands.
     * @default false
     */
    approvePermissions?: boolean;

    /**
     * Process manager for tracking AI processes in the AI Processes panel.
     * If provided, the invocation will be tracked and visible in the panel.
     */
    processManager?: IAIProcessManager;

    /**
     * Optional cancellation token for aborting the AI request.
     * When token is cancelled, the SDK session will be aborted.
     * Only effective when using SDK backend.
     */
    cancellationToken?: vscode.CancellationToken;
}

/**
 * Result from AI invoker, extends AIInvocationResult with session tracking
 */
export interface AIInvokerResult extends AIInvocationResult {
    /**
     * SDK session ID if the request was made via SDK.
     * Can be used for cancellation.
     */
    sessionId?: string;
}

/**
 * AI invoker function type.
 * Compatible with the map-reduce framework's AIInvoker interface.
 */
export type AIInvoker = (
    prompt: string,
    options?: { model?: string }
) => Promise<AIInvokerResult>;

/**
 * Create a unified AI invoker that handles SDK/CLI fallback automatically.
 *
 * This is the single source of truth for the SDK → CLI → clipboard fallback chain.
 * All features that need to invoke AI should use this factory instead of
 * implementing the fallback logic themselves.
 *
 * @param options Configuration options for the invoker
 * @returns An AI invoker function
 *
 * @example
 * // For parallel workloads (code review, pipelines)
 * const aiInvoker = createAIInvoker({
 *     usePool: true,
 *     workingDirectory: workspaceRoot,
 *     featureName: 'Code Review'
 * });
 *
 * @example
 * // For one-off requests with clipboard fallback
 * const aiInvoker = createAIInvoker({
 *     usePool: false,
 *     workingDirectory: workspaceRoot,
 *     clipboardFallback: true,
 *     featureName: 'Clarification'
 * });
 */
export function createAIInvoker(options: AIInvokerFactoryOptions): AIInvoker {
    const {
        usePool = false,
        workingDirectory,
        model: defaultModel,
        timeoutMs,
        featureName = 'AI',
        clipboardFallback = false,
        approvePermissions = false,
        processManager,
        cancellationToken
    } = options;

    const backend = getAIBackendSetting();
    const logger = getExtensionLogger();
    const loadMcpConfig = getSDKLoadMcpConfigSetting();

    return async (prompt: string, invokeOptions?: { model?: string }): Promise<AIInvokerResult> => {
        const model = invokeOptions?.model || defaultModel;
        
        // Register process if manager provided
        let processId: string | undefined;
        if (processManager) {
            processId = processManager.registerTypedProcess(prompt, {
                type: 'generic',
                metadata: {
                    type: 'generic',
                    feature: featureName,
                    backend,
                    model
                }
            });
        }

        // Try SDK if configured
        if (backend === 'copilot-sdk') {
            const sdkService = getCopilotSDKService();
            const availability = await sdkService.isAvailable();

            if (availability.available) {
                logger.debug(
                    LogCategory.AI,
                    `${featureName}: Using SDK ${usePool ? 'session pool' : 'direct mode'}`
                );

                // Register cancellation listener if token provided
                let cancellationDisposable: vscode.Disposable | undefined;
                let sessionId: string | undefined;
                let isCancelled = false;
                
                if (cancellationToken) {
                    cancellationDisposable = cancellationToken.onCancellationRequested(async () => {
                        isCancelled = true;
                        if (sessionId) {
                            logger.debug(LogCategory.AI, `${featureName}: Cancellation requested, aborting session ${sessionId}`);
                            await sdkService.abortSession(sessionId);
                        }
                        // Update process status to cancelled
                        if (processId && processManager) {
                            processManager.cancelProcess(processId);
                        }
                    });
                }

                try {
                    // Check if already cancelled before making request
                    if (cancellationToken?.isCancellationRequested) {
                        if (processId && processManager) {
                            processManager.cancelProcess(processId);
                        }
                        return {
                            success: false,
                            error: 'Cancelled'
                        };
                    }

                    const result = await sdkService.sendMessage({
                        prompt,
                        model,
                        workingDirectory,
                        timeoutMs,
                        usePool,
                        loadDefaultMcpConfig: loadMcpConfig,
                        onPermissionRequest: approvePermissions ? approveAllPermissions : undefined
                    });

                    // Store session ID for potential cancellation
                    sessionId = result.sessionId;

                    // Check if cancelled during execution
                    if (isCancelled || cancellationToken?.isCancellationRequested) {
                        // Process status already updated by cancellation listener
                        return {
                            success: false,
                            error: 'Cancelled',
                            sessionId
                        };
                    }

                    if (result.success) {
                        // Complete process on success
                        if (processId && processManager) {
                            processManager.completeProcess(processId, result.response || '');
                        }
                        return {
                            success: true,
                            response: result.response,
                            sessionId: result.sessionId
                        };
                    }

                    // SDK failed, fall back to CLI
                    logger.debug(
                        LogCategory.AI,
                        `${featureName}: SDK failed, falling back to CLI: ${result.error}`
                    );
                } finally {
                    cancellationDisposable?.dispose();
                }
            } else {
                logger.debug(
                    LogCategory.AI,
                    `${featureName}: SDK not available (${availability.error}), using CLI`
                );
            }
        }

        // Handle clipboard-only backend
        if (backend === 'clipboard') {
            if (processId && processManager) {
                processManager.failProcess(processId, 'Using clipboard mode');
            }
            await copyToClipboard(prompt);
            return {
                success: false,
                error: 'Using clipboard mode - prompt copied to clipboard'
            };
        }

        // Use CLI as primary (for copilot-cli backend) or fallback (when SDK fails)
        logger.debug(LogCategory.AI, `${featureName}: Using CLI backend`);

        const result = await invokeCopilotCLI(
            prompt,
            workingDirectory,
            undefined, // Process tracking handled here, not in CLI
            undefined,
            model
        );

        if (result.success) {
            if (processId && processManager) {
                processManager.completeProcess(processId, result.response || '');
            }
            return result;
        }

        // CLI failed - optionally fall back to clipboard
        if (clipboardFallback) {
            if (processId && processManager) {
                processManager.failProcess(processId, result.error || 'CLI request failed');
            }
            await copyToClipboard(prompt);
            return {
                success: false,
                error: `${result.error || 'CLI request failed'}. Prompt copied to clipboard.`
            };
        }

        // Final failure
        if (processId && processManager) {
            processManager.failProcess(processId, result.error || 'Request failed');
        }
        return result;
    };
}

/**
 * Invoke AI with SDK/CLI fallback, returning session ID for cancellation tracking.
 *
 * This is a convenience function for features that need to track the SDK session ID
 * for cancellation purposes (e.g., discovery engine, clarification handler).
 *
 * @param prompt The prompt to send
 * @param options Configuration options
 * @returns The AI invocation result with optional session ID
 */
export async function invokeAIWithFallback(
    prompt: string,
    options: AIInvokerFactoryOptions & { model?: string }
): Promise<AIInvokerResult> {
    const invoker = createAIInvoker(options);
    return invoker(prompt, { model: options.model });
}
