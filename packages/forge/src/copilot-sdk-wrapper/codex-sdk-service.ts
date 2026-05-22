/**
 * Codex SDK Service
 *
 * Implements ISDKService backed by the optional `@openai/codex-sdk` package.
 * When the package is not installed the service reports itself as unavailable
 * and all method calls return appropriate error results rather than throwing.
 *
 * Thread ↔ session mapping
 * ─────────────────────────
 * Every CoC session ID maps to exactly one Codex thread ID. The mapping is
 * created on the first `sendMessage` call for a session and removed when the
 * session is aborted or the service is disposed.
 *
 * Optional peer dependency
 * ─────────────────────────
 * `@openai/codex-sdk` is declared as an optional peer dependency of forge.
 * The module is loaded lazily with a try/catch so forge works fine without it.
 */

import type { SendMessageOptions } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult } from './sdk-service-interface';
import { sdkServiceRegistry, CODEX_PROVIDER } from './sdk-service-registry';

// ============================================================================
// Auth checker injection (AC-08)
// ============================================================================

/**
 * Result returned by the injected auth checker.
 * When `authenticated` is false, `sendMessage` immediately returns an error
 * that includes `authUrl` so the caller can surface a sign-in link.
 */
export interface CodexAuthCheckResult {
    authenticated: boolean;
    /** URL the user should open to authenticate (populated when not authenticated). */
    authUrl?: string;
}

/** Injectable callback used by `CodexSDKService.sendMessage` to gate requests. */
export type CodexAuthChecker = () => CodexAuthCheckResult;

// ============================================================================
// @openai/codex-sdk type stubs
// These mirror the thread-based agent API described in the integration spec.
// They are kept here rather than imported so the file compiles without the
// optional peer dependency being installed.
// ============================================================================

/** A running Codex thread that can be used to send messages and stream output. */
interface CodexThread {
    /** Unique ID assigned by the Codex service. */
    readonly id: string;
    /**
     * Run the thread with a prompt, streaming chunks via `onChunk`.
     * Resolves with the full response text when complete.
     */
    run(options: CodexThreadRunOptions): Promise<CodexThreadResult>;
    /** Terminate the thread immediately. */
    abort(): void;
}

interface CodexThreadRunOptions {
    prompt: string;
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
}

interface CodexThreadResult {
    text: string;
}

/** Subset of the @openai/codex-sdk API used by this adapter. */
interface CodexSDKModule {
    /** Start a new conversation thread. */
    startThread(options?: CodexStartThreadOptions): Promise<CodexThread>;
    /** Resume an existing thread by its ID. */
    resumeThread(threadId: string): Promise<CodexThread>;
}

interface CodexStartThreadOptions {
    systemPrompt?: string;
    model?: string;
    /** Fork from an existing thread — the new thread inherits its history. */
    forkFromThreadId?: string;
}

// ============================================================================
// Internal active-session record
// ============================================================================

interface ActiveCodexSession {
    threadId: string;
    abortController: AbortController;
}

// ============================================================================
// CodexSDKService
// ============================================================================

/**
 * Provider for the optional `@openai/codex-sdk` package.
 * Registered under the `'codex'` key in `SDKServiceRegistry`.
 *
 * Construction is cheap — no SDK is loaded until the first call to
 * `isAvailable()` or `sendMessage()`.
 */
export class CodexSDKService implements ISDKService {
    private availabilityCache: IAvailabilityResult | null = null;
    private sdk: CodexSDKModule | null = null;
    private disposed = false;
    private authChecker: CodexAuthChecker | null = null;

    /** sessionId → active session metadata */
    private readonly sessions = new Map<string, ActiveCodexSession>();

    // ── Auth checker injection (AC-08) ────────────────────────────────────────

    /**
     * Inject an auth checker. When set, `sendMessage` calls it before each
     * request and returns an auth-required error when not authenticated.
     *
     * Called once during server startup by the codex-auth infrastructure
     * when `codex.enabled` is true.
     */
    public setAuthChecker(checker: CodexAuthChecker): void {
        this.authChecker = checker;
    }

    public clearAuthChecker(): void {
        this.authChecker = null;
    }

    // ── Availability ─────────────────────────────────────────────────────────

    public async isAvailable(): Promise<IAvailabilityResult> {
        if (this.disposed) return { available: false, error: 'CodexSDKService has been disposed' };
        if (this.availabilityCache) return this.availabilityCache;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const mod = await import('@openai/codex-sdk' as string);
            this.sdk = (mod.default ?? mod) as CodexSDKModule;
            this.availabilityCache = { available: true };
        } catch {
            this.availabilityCache = {
                available: false,
                error:
                    'Codex SDK not found. Install the optional peer dependency: ' +
                    'npm install @openai/codex-sdk',
            };
        }
        return this.availabilityCache;
    }

    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
        this.sdk = null;
    }

    // ── Model discovery ───────────────────────────────────────────────────────

    public async listModels(): Promise<IModelInfo[]> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');
        // Codex model list is static for now; extend when the SDK exposes an endpoint.
        return [
            { id: 'codex-davinci-002', name: 'Codex Davinci 002' },
            { id: 'code-cushman-001', name: 'Code Cushman 001' },
        ];
    }

    // ── Message dispatch ──────────────────────────────────────────────────────

    public async sendMessage(options: SendMessageOptions): Promise<IInvocationResult> {
        if (this.disposed) return { success: false, error: 'CodexSDKService has been disposed' };

        // AC-08: Check authentication before proceeding. When the auth checker
        // reports unauthenticated, return a structured error with an authUrl so
        // the caller can surface a sign-in link — no silent fallback to Copilot.
        if (this.authChecker) {
            const authResult = this.authChecker();
            if (!authResult.authenticated) {
                const authMsg = authResult.authUrl
                    ? `Codex (ChatGPT) authentication required. Sign in at: ${authResult.authUrl}`
                    : 'Codex (ChatGPT) authentication required. Use POST /api/codex-auth/start to sign in.';
                return {
                    success: false,
                    error: authMsg,
                    sessionId: options.sessionId,
                };
            }
        }

        const avail = await this.isAvailable();
        if (!avail.available) {
            return { success: false, error: avail.error };
        }

        const sdk = this.sdk!;
        const sessionId = options.sessionId ?? `codex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const existing = this.sessions.get(sessionId);
        const abortController = new AbortController();

        try {
            let thread: CodexThread;
            if (existing) {
                thread = await sdk.resumeThread(existing.threadId);
            } else {
                thread = await sdk.startThread({ model: options.model });
            }

            // Store/update active session record
            this.sessions.set(sessionId, { threadId: thread.id, abortController });

            const chunks: string[] = [];
            const result = await thread.run({
                prompt: options.prompt ?? '',
                signal: abortController.signal,
                onChunk: (chunk) => {
                    chunks.push(chunk);
                    options.onStreamingChunk?.(chunk);
                },
            });

            // Signal end of streaming (empty chunk signals completion — callers that care
            // about done-signalling should check for empty string + resolve settling)
            options.onStreamingChunk?.('');

            return { success: true, response: result.text, sessionId };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, sessionId };
        } finally {
            this.sessions.delete(sessionId);
        }
    }

    public async transform<T = string>(
        prompt: string,
        parse?: (raw: string) => T,
        options?: { model?: string; timeoutMs?: number; cwd?: string },
    ): Promise<T> {
        const result = await this.sendMessage({ prompt, model: options?.model });
        if (!result.success) throw new Error(result.error ?? 'Codex transform failed');
        const raw = result.response ?? '';
        return (parse ? parse(raw) : raw) as T;
    }

    // ── Session management ────────────────────────────────────────────────────

    public async forkSession(sessionId: string): Promise<string> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');

        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');

        const existing = this.sessions.get(sessionId);
        const sdk = this.sdk!;
        const forkedThread = await sdk.startThread({
            forkFromThreadId: existing?.threadId,
        });
        const newSessionId = `codex-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        this.sessions.set(newSessionId, {
            threadId: forkedThread.id,
            abortController: new AbortController(),
        });
        return newSessionId;
    }

    public async abortSession(sessionId: string): Promise<boolean> {
        const session = this.sessions.get(sessionId);
        if (!session) return false;
        session.abortController.abort();
        this.sessions.delete(sessionId);
        return true;
    }

    public async softAbortSession(sessionId: string): Promise<boolean> {
        // Codex threads do not distinguish soft from hard abort; use the same path.
        return this.abortSession(sessionId);
    }

    public async steerSession(_sessionId: string, _prompt: string): Promise<boolean> {
        // Thread steering is not exposed by the Codex SDK; no-op.
        return false;
    }

    public hasActiveSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    public getActiveSessionCount(): number {
        return this.sessions.size;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public async cleanup(): Promise<void> {
        for (const [, session] of this.sessions) {
            session.abortController.abort();
        }
        this.sessions.clear();
        this.availabilityCache = null;
        this.sdk = null;
    }

    public dispose(): void {
        this.disposed = true;
        this.cleanup().catch(() => {});
    }
}

// ============================================================================
// Registration helper
// ============================================================================

/**
 * Register a new `CodexSDKService` instance under `'codex'` in the module-
 * level `sdkServiceRegistry`. Call this once during server startup when the
 * `codex.enabled` feature flag is true.
 *
 * @param authChecker Optional auth checker injected by the codex-auth
 *   infrastructure (AC-08). When provided, sendMessage gates on auth status.
 * @returns The newly created service instance.
 */
export function registerCodexSDKService(authChecker?: CodexAuthChecker): CodexSDKService {
    const svc = new CodexSDKService();
    if (authChecker) svc.setAuthChecker(authChecker);
    sdkServiceRegistry.register(CODEX_PROVIDER, svc);
    return svc;
}
