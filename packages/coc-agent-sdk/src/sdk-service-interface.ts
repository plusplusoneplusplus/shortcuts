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
import type { WarmStateChangeListener, WarmStatus } from './warm-client-registry';

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
     * Provider-supplied model description (e.g. Claude CLI's
     * "Sonnet 4.6 · Best for everyday tasks"). Used for alias/family matching
     * when a configured model id is not an exact catalog id.
     */
    description?: string;
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
    /**
     * Copilot-SDK `user.message` event id that began this turn, captured from
     * the live event stream. Durable anchor for history rewind/truncation
     * (AC-01); persisted onto the user turn's `sdkEventId`. Only the copilot
     * provider populates this; undefined elsewhere (turn is not rewindable).
     */
    userMessageEventId?: string;
}

/**
 * Result of a successful {@link ISDKService.rewindSession} call (AC-02).
 *
 * Reports how many provider events the truncation dropped and echoes the anchor
 * event id it truncated to (that event and everything after it are removed).
 */
export interface RewindResult {
    /** Number of provider events removed by the truncation. */
    eventsRemoved: number;
    /** The anchor event id truncated to — this event and all later ones are gone. */
    upToEventId: string;
}

/**
 * Error thrown by {@link ISDKService.rewindSession} when the provider does not
 * support history rewind/truncation (currently every provider except Copilot).
 *
 * Carries a stable `code` so callers can recognize it across module/build
 * boundaries where `instanceof` is unreliable (dual ESM/CJS). The backend rewind
 * endpoint (AC-03) maps this to a typed "rewind unsupported" rejection surfaced
 * to the user as an error toast. Prefer {@link isRewindUnsupportedError} over a
 * bare `instanceof` check at call sites.
 */
export class RewindUnsupportedError extends Error {
    /** Stable discriminator that survives serialization / cross-bundle checks. */
    public readonly code = 'REWIND_UNSUPPORTED' as const;
    /** The provider that rejected the rewind (e.g. `claude`, `codex`). */
    public readonly provider: string;

    constructor(provider: string, message?: string) {
        super(message ?? `Rewind is not supported for provider '${provider}'.`);
        this.name = 'RewindUnsupportedError';
        this.provider = provider;
        // Restore the prototype chain so `instanceof` works under transpiled
        // (ES5/CommonJS) targets where extending built-ins otherwise breaks it.
        Object.setPrototypeOf(this, RewindUnsupportedError.prototype);
    }
}

/**
 * Type guard for {@link RewindUnsupportedError} that is robust to duplicate
 * class identities across bundles: it accepts either a true `instanceof` match
 * or any error carrying the stable `REWIND_UNSUPPORTED` code.
 */
export function isRewindUnsupportedError(err: unknown): err is RewindUnsupportedError {
    return (
        err instanceof RewindUnsupportedError ||
        (typeof err === 'object' &&
            err !== null &&
            (err as { code?: unknown }).code === 'REWIND_UNSUPPORTED')
    );
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

/**
 * Options for a {@link ISDKService.prewarm} call.
 *
 * Prewarm spins up (or keeps alive) the provider client process for the next
 * turn without creating a session. `warmKey` is a provider-neutral scope key:
 * together with the provider it forms the warm-client key, so a prewarm and the
 * follow-up send for the same conversation reuse one client.
 */
export interface PrewarmOptions {
    /**
     * Provider-neutral warm scope key. CoC supplies the conversation process id.
     */
    warmKey: string;
    /**
     * Working directory for the warm client process and per-turn execution
     * context. This is not part of the warm-client key.
     */
    workingDirectory?: string;
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

    /**
     * Pre-warm the provider client process for the next turn — without creating
     * a session (AC-04).
     *
     * Optional: providers that cannot stay warm (e.g. Claude, whose `query()`
     * spawns per turn) omit this method, and callers fall back transparently
     * with no warm client. Implementations must be:
     *   - idempotent — repeated calls do not duplicate the client;
     *   - a no-op while a turn is in flight on the same key;
     *   - a no-op when warming is disabled (idle TTL `<= 0`);
     *   - best-effort — a warm-start failure resolves quietly, never throws, and
     *     never blocks or fails a later real send.
     *
     * A real send arriving mid-warm attaches to the same in-flight warming via
     * the warm-client registry, so the prewarmed process is reused rather than
     * duplicated.
     */
    prewarm?(options: PrewarmOptions): Promise<void>;

    /**
     * Read the current warm-client {@link WarmStatus} for a `(provider,
     * warmKey)` key — the synchronous snapshot side of warm state that
     * complements the push-based {@link onWarmStatusChange}. Used by the CoC SSE
     * bridge to send an initial warm-status frame when a warm-only stream opens,
     * so a chat that is already warm before the browser subscribes shows the dot
     * without waiting for the next transition.
     *
     * Optional and synchronous (it only reads in-memory registry state): providers
     * that cannot stay warm (e.g. Claude) omit it, and callers treat a missing
     * method as `cold`. Pairs with {@link prewarm}/{@link onWarmStatusChange} — a
     * provider that implements those implements this.
     */
    getWarmStatus?(options: PrewarmOptions): WarmStatus;

    /**
     * Subscribe to warm-client state transitions for this provider — pushing the
     * registry's `(key, status)` changes (cold → warming → warm → active → cold)
     * to external observers such as the CoC SSE bridge that drives the SPA warm
     * indicator. `key` is `makeWarmKey(provider, warmKey)`. Returns an
     * unsubscribe function.
     *
     * Optional: providers that never stay warm (e.g. Claude) omit this method, so
     * their conversations simply never receive a warm transition and the
     * indicator stays cold/invisible. Pairs with {@link prewarm} — a provider
     * that implements one implements the other.
     */
    onWarmStatusChange?(listener: WarmStateChangeListener): () => void;

    /**
     * Evict (tear down) the warm client parked for a `(provider, warmKey)` key,
     * if any. Used after a destructive history rewind (AC-03): the rewound
     * session no longer matches the warm client's in-memory view, so the next
     * send must resume the freshly-truncated session from a cold client rather
     * than reuse a stale warm one.
     *
     * Optional and best-effort — providers that never stay warm (e.g. Claude)
     * omit it, and callers treat a missing method as a no-op. Idempotent: evicting
     * a key with no warm client resolves quietly.
     */
    evictWarm?(options: PrewarmOptions): Promise<void>;

    // ------------------------------------------------------------------
    // Session management
    // ------------------------------------------------------------------

    /**
     * Fork an existing session, creating a new session pre-loaded with its
     * conversation history. Returns the new session ID.
     */
    forkSession(sessionId: string): Promise<string>;

    /**
     * Rewind (destructively truncate) a session's persisted history to a given
     * event id: that event and every event after it are permanently removed, and
     * the session remains usable, resuming from the truncated state (AC-02).
     *
     * Copilot resumes the session and calls `rpc.history.truncate({ eventId })`.
     * Providers that cannot truncate history (Claude, Codex) throw
     * {@link RewindUnsupportedError}; the backend maps that to a user-facing
     * "rewind unsupported" error. A missing/unresumable session surfaces as a
     * thrown error — the implementation never silently creates a new empty
     * session in its place.
     */
    rewindSession(sessionId: string, eventId: string): Promise<RewindResult>;

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
