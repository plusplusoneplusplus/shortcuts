/**
 * ISDKService — Provider-agnostic SDK service interface for forge.
 *
 * Defines the contract that any AI SDK service provider must satisfy.
 * `CopilotSDKService` is the current sole implementation; this interface
 * enables future Codex SDK and Claude SDK adapters without changing callers.
 *
 * Provider-agnostic primitive types are defined here so adapters can translate
 * provider-specific responses at their own boundaries.
 */

import type { SendMessageOptions } from './types';

// ============================================================================
// Provider-Agnostic Primitive Types
// ============================================================================

/**
 * Minimal model descriptor that every SDK provider must supply.
 * Forge-specific `ModelInfo` satisfies this interface structurally.
 */
export interface IModelInfo {
    /** Unique model identifier (e.g. 'gpt-4.1', 'claude-sonnet-4.6') */
    id: string;
    /** Human-readable model name */
    name: string;
    /**
     * Reasoning-effort levels this model supports, when the provider advertises
     * them (e.g. `['low', 'medium', 'high', 'xhigh']`). Omitted or empty means
     * the model exposes no selectable effort levels, so effort is left to the
     * provider default. Surfaced by the admin model/effort-tier UIs.
     */
    supportedReasoningEfforts?: string[];
}

/**
 * Availability check result returned by any SDK provider.
 * Forge-specific `SDKAvailabilityResult` satisfies this interface structurally.
 */
export interface IAvailabilityResult {
    /** Whether the provider is available and ready */
    available: boolean;
    /** Human-readable error message when not available */
    error?: string;
}

/**
 * Invocation result returned by any SDK provider's sendMessage call.
 * Forge-specific `SDKInvocationResult` satisfies this interface structurally.
 */
export interface IInvocationResult {
    /** Whether the invocation completed without error */
    success: boolean;
    /** Response text from the AI (populated on success) */
    response?: string;
    /** Error message (populated on failure) */
    error?: string;
    /** Session ID used for this request, if a session was created */
    sessionId?: string;
}

// ============================================================================
// ISDKService — Main Interface
// ============================================================================

/**
 * Provider-agnostic interface for an AI SDK service.
 *
 * Method signatures deliberately mirror `CopilotSDKService`'s public API so
 * that class satisfies this interface via TypeScript structural typing with
 * zero changes to its return types.
 *
 * Auxiliary services (model metadata store, MCP config loader, image converter)
 * are intentionally excluded — they are implementation details of the Copilot
 * provider and not part of the common contract.
 */
export interface ISDKService {
    // ------------------------------------------------------------------
    // Availability
    // ------------------------------------------------------------------

    /** Check whether the underlying SDK is installed and loadable. */
    isAvailable(): Promise<IAvailabilityResult>;

    /** Discard the cached availability result and re-check on next call. */
    clearAvailabilityCache(): void;

    // ------------------------------------------------------------------
    // Model discovery
    // ------------------------------------------------------------------

    /** Return the list of models supported by this provider. */
    listModels(): Promise<IModelInfo[]>;

    // ------------------------------------------------------------------
    // Message dispatch
    // ------------------------------------------------------------------

    /**
     * Send a message to the AI, optionally streaming the response.
     * The callback-based pattern in `SendMessageOptions` is preserved
     * (`onStreamingChunk`, `onToolEvent`, etc.) so existing callers need
     * no changes.
     */
    sendMessage(options: SendMessageOptions): Promise<IInvocationResult>;

    /**
     * Run a one-shot transformation prompt and return the parsed result.
     * Equivalent to a non-streaming `sendMessage` focused on text extraction.
     */
    transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
    ): Promise<T>;

    // ------------------------------------------------------------------
    // Session management
    // ------------------------------------------------------------------

    /**
     * Fork an existing session, creating a new session pre-loaded with its
     * conversation history. Returns the new session ID.
     */
    forkSession(sessionId: string): Promise<string>;

    /** Hard-abort a session — terminates in-flight work immediately. */
    abortSession(sessionId: string): Promise<boolean>;

    /**
     * Soft-abort a session (Esc-equivalent) — stops in-flight work while
     * keeping the session alive for potential reuse.
     */
    softAbortSession(sessionId: string): Promise<boolean>;

    /**
     * Inject an immediate steering message into a running session.
     * Returns `true` when the session was found and the message was sent.
     */
    steerSession(sessionId: string, prompt: string): Promise<boolean>;

    /** Returns `true` when a session with the given ID is currently active. */
    hasActiveSession(sessionId: string): boolean;

    /** Returns the number of currently active sessions. */
    getActiveSessionCount(): number;

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    /** Abort all active sessions and release SDK resources. */
    cleanup(): Promise<void>;

    /** Permanently dispose the service; further calls will throw or no-op. */
    dispose(): void;
}
