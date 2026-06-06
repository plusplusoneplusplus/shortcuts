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

import type { SendMessageOptions, TokenUsage, PermissionHandler } from './types';

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
    /** Model that the provider actually used. Omitted means provider default. */
    effectiveModel?: string;
    /** Aggregated token usage / provider diagnostics, when the provider reports them. */
    tokenUsage?: TokenUsage;
}

/**
 * Options for a one-shot {@link ISDKService.transform} call.
 *
 * The transform primitive is deliberately minimal: it runs a single isolated
 * provider request with safe defaults (no MCP/tools, denied permissions) so it
 * can be reused for arbitrary text transformations without leaking caller
 * state. Every field is optional; product policy (model choice, prompt,
 * sanitization) is owned by the caller, not the SDK.
 */
export interface TransformOptions {
    /** Model id to use. Omitted means the provider default — the SDK owns no model default for transforms. */
    model?: string;
    /** Per-call timeout in milliseconds. */
    timeoutMs?: number;
    /** Working directory for the isolated request. */
    cwd?: string;
    /** Abort signal to cancel the in-flight request. */
    signal?: AbortSignal;
    /**
     * Whether to load the ambient default MCP configuration. Defaults to
     * `false`, so the transform runs with no MCP servers/tools unless a caller
     * explicitly opts in.
     */
    loadDefaultMcpConfig?: boolean;
    /**
     * Permission handler for the request. Defaults to denying every permission
     * request, so a transform performs no side effects unless a caller
     * explicitly overrides this.
     */
    onPermissionRequest?: PermissionHandler;
}

/**
 * Structured result of a one-shot {@link ISDKService.transform} call.
 *
 * Mirrors {@link IInvocationResult} but is scoped to the transform primitive:
 * it always reports success/error and surfaces execution metadata so callers
 * can verify the effective model and inspect provider diagnostics.
 */
export interface TransformResult {
    /** Whether the transform completed without error. */
    success: boolean;
    /** Transformed text. Empty string when the transform failed. */
    text: string;
    /** Error message, populated when `success` is false. */
    error?: string;
    /** Model the provider actually used, when reported. Omitted means provider default. */
    effectiveModel?: string;
    /** Token usage / provider diagnostics, when the provider reports them. */
    tokenUsage?: TokenUsage;
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
     * Run a one-shot, isolated text transformation and return a structured
     * result.
     *
     * The call is fresh and isolated: it never resumes a session, exposes no
     * reusable thread/session handle, and performs no follow-up. By default it
     * runs with no MCP servers/tools and denies all permission requests; pass
     * {@link TransformOptions} to override. The SDK owns no model default — the
     * caller supplies the model (or accepts the provider default).
     */
    transform(input: string, options?: TransformOptions): Promise<TransformResult>;

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
