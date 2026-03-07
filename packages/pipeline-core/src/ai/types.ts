/**
 * AI Service Types (Pure Node.js)
 * 
 * Core types for AI service operations. These types are VS Code-free
 * and can be used in CLI tools, tests, and other Node.js environments.
 */

/**
 * Supported AI backends for invocation.
 * - 'copilot-sdk': Use the @github/copilot-sdk for structured JSON-RPC communication
 * - 'copilot-cli': Use the copilot CLI via child process (legacy)
 * - 'clipboard': Copy prompt to clipboard for manual use
 */
export type AIBackendType = 'copilot-sdk' | 'copilot-cli' | 'clipboard';

/**
 * Valid AI model options for Copilot CLI.
 * Derived from the central model registry (model-registry.ts).
 */
export { VALID_MODELS, AIModel, DEFAULT_MODEL_ID } from '../copilot-sdk-wrapper/model-registry';

// Re-export model registry helpers and types for convenience
export {
    ModelDefinition,
    MODEL_REGISTRY,
    getModelLabel,
    getModelDescription,
    getModelDefinition,
    getAllModels,
    getActiveModels,
    isValidModelId,
    getModelCount,
    getModelsByTier
} from '../copilot-sdk-wrapper/model-registry';

/**
 * Result of an AI invocation
 */
export interface AIInvocationResult {
    /** Whether the invocation was successful */
    success: boolean;
    /** The response text from the AI (if successful) */
    response?: string;
    /** Error message (if failed) */
    error?: string;
}

/**
 * Default prompt templates for different instruction types
 */
export const DEFAULT_PROMPTS = {
    clarify: `Please clarify the following snippet with more depth.

- Explain what it does in plain language.
- Walk through the key steps, including control flow and data flow.
- State any assumptions you are making from limited context.
- Call out ambiguities and ask up to 3 targeted questions.
- Suggest 2 to 3 concrete next checks, such as what to inspect or test next.

Snippet`,
    goDeeper: `Please provide an in-depth explanation and analysis of the following snippet.

Go beyond a summary and explore the surrounding implications.

- Intent and responsibilities in the broader system.
- Step-by-step control flow and data flow.
- Edge cases and failure modes, including correctness, security, and performance.
- Likely dependencies and impacts, and what else to inspect.
- Concrete improvements or refactors with tradeoffs.
- How to validate, including focused tests, repro steps, or logs.

Snippet`,
    customDefault: 'Please explain the following snippet'
} as const;

/**
 * Supported CLI tools for interactive sessions
 */
export type InteractiveToolType = 'copilot' | 'claude';

// ============================================================================
// Shared AI execution types (relocated from map-reduce/types)
// ============================================================================

/**
 * A generic item with string key-value pairs for template substitution.
 * Used across pipeline and workflow execution engines.
 */
export interface PromptItem {
    [key: string]: string;
}

/**
 * AI invocation function type
 */
export type AIInvoker = (prompt: string, options?: AIInvokerOptions) => Promise<AIInvokerResult>;

/**
 * Options for AI invocation
 */
export interface AIInvokerOptions {
    /** Model to use (optional, uses default if not specified) */
    model?: string;
    /** Working directory for execution */
    workingDirectory?: string;
    /** Timeout in ms */
    timeoutMs?: number;
    /** Custom tools to register on the AI session (SDK-native tools, not MCP). */
    tools?: import('../copilot-sdk-wrapper/types').Tool<any>[];
    /** Callback invoked for each tool event during the AI session. */
    onToolEvent?: (event: import('../copilot-sdk-wrapper/types').ToolEvent) => void;
}

/**
 * Result from AI invocation
 */
export interface AIInvokerResult {
    /** Whether the invocation succeeded */
    success: boolean;
    /** The AI response (if successful) */
    response?: string;
    /** Error message (if failed) */
    error?: string;
    /** SDK session ID if the request was made via SDK (for session resume) */
    sessionId?: string;
    /** Token usage data from the SDK (if available) */
    tokenUsage?: import('../copilot-sdk-wrapper/types').TokenUsage;
}

/**
 * Session metadata for session resume functionality
 */
export interface SessionMetadata {
    /** SDK session ID for resuming sessions */
    sessionId?: string;
    /** Backend type used for this process */
    backend?: 'copilot-sdk' | 'copilot-cli' | 'clipboard';
    /** Working directory used for the session */
    workingDirectory?: string;
}

/**
 * Process tracking hooks for integration with AI process manager
 */
export interface ProcessTracker {
    /**
     * Register a new process for tracking
     * @param description Description of the process
     * @param parentGroupId Optional parent group ID
     * @returns Process ID
     */
    registerProcess(description: string, parentGroupId?: string): string;

    /**
     * Update process status
     * @param processId Process ID
     * @param status New status
     * @param response Optional response
     * @param error Optional error
     * @param structuredResult Optional structured result (JSON string)
     */
    updateProcess(
        processId: string,
        status: 'running' | 'completed' | 'failed',
        response?: string,
        error?: string,
        structuredResult?: string
    ): void;

    /**
     * Attach session metadata to a process for session resume functionality.
     * @param processId Process ID
     * @param metadata Session metadata (sessionId, backend, workingDirectory)
     */
    attachSessionMetadata?(processId: string, metadata: SessionMetadata): void;

    /**
     * Register a group of processes
     * @param description Description of the group
     * @returns Group ID
     */
    registerGroup(description: string): string;

    /**
     * Complete a process group
     * @param groupId Group ID
     * @param summary Summary text
     * @param stats Execution statistics
     */
    completeGroup(
        groupId: string,
        summary: string,
        stats: { totalItems: number; successfulMaps: number; failedMaps: number; mapPhaseTimeMs: number; reducePhaseTimeMs: number; maxConcurrency: number }
    ): void;
}

/**
 * Progress information during job execution
 */
export interface JobProgress {
    /** Current phase of execution */
    phase: 'splitting' | 'mapping' | 'reducing' | 'complete';
    /** Total number of work items */
    totalItems: number;
    /** Number of completed items */
    completedItems: number;
    /** Number of failed items */
    failedItems: number;
    /** Progress percentage (0-100) */
    percentage: number;
    /** Optional message for display */
    message?: string;
}
