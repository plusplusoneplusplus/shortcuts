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

import type { SendMessageOptions, SystemMessageConfig, TokenUsage } from './types';
import type { ToolEvent } from './types';
import { denyAllPermissions } from './types';
import type { ISDKService, IAvailabilityResult, IModelInfo, IInvocationResult, TransformOptions, TransformResult, PrewarmOptions, RewindResult, CompactResult } from './sdk-service-interface';
import { RewindUnsupportedError, CompactUnsupportedError } from './sdk-service-interface';
import type { IAccountQuotaResult, IAccountQuotaSnapshot } from './copilot-sdk-service';
import type { ToolCall } from './tool-call';
import { sdkServiceRegistry, CODEX_PROVIDER } from './sdk-service-registry';
import { WarmClientRegistry, makeWarmKey, WarmClientFactory } from './warm-client-registry';
import type { WarmStateChangeListener, WarmStatus } from './warm-client-registry';
import { WarmStatusBroadcaster } from './warm-status-broadcaster';
import { runWithWarmClient } from './warm-client-runner';
import { resolveWarmClientTtlMs } from './warm-client-config';
import { getSDKLogger } from './logger';
import { dynamicImportModule } from './sdk-esm-loader';
import { execFileAsync } from './internal/exec-utils';
import { CocToolRuntime } from './llm-tools/coc-tool-runtime';
import { cocToolBridgeServer } from './llm-tools/bridge-server';
import { buildCocLlmToolsMcpConfig, COC_LLM_TOOLS_MCP_SERVER_NAME } from './llm-tools/mcp-config';
import { isSupportedCodexImagePath } from './image-converter';
import { getModelContextWindow } from './model-registry';
import { resolveCodexExecutablePath } from './codex-exec-path';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import * as readline from 'readline';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

// ============================================================================
// Install mode detection
// ============================================================================

/**
 * Returns true when forge is running from a global npm install.
 * When installed globally, __dirname contains 'node_modules'.
 */
function isGlobalInstall(): boolean {
    return __dirname.includes('node_modules');
}

// ============================================================================
// Runtime module resolution
// ============================================================================

/**
 * Resolves optional runtime dependencies relative to this package instead of
 * the process entrypoint. This keeps globally installed CoC and workspace-linked
 * development installs from resolving against different node_modules trees.
 */
const runtimeRequire = createRequire(__filename);

/**
 * Per-server MCP tool-call timeout (seconds) for the CoC LLM-tools bridge under Codex.
 *
 * CoC exposes deliberately long-blocking tools (notably `ask_user`) whose bridge HTTP
 * transport sets no client-side timeout — it waits indefinitely for the human/SPA reply
 * (matching Claude Code, whose MCP client also waits forever). Codex CLI, however,
 * applies its own default `tool_timeout_sec` to MCP tool calls, so a slow human answer
 * gets aborted as "user cancelled MCP tool call". We therefore pin an effectively
 * unbounded timeout (365 days) on the `coc_llm_tools` server entry. A large finite value
 * is used instead of `0`/omission because codex's config does not document those as
 * "infinite". Verified against codex 0.133.0 (config key `tool_timeout_sec`).
 */
const CODEX_LLM_TOOLS_TIMEOUT_SEC = 31_536_000;
const CODEX_DIFF_TIMEOUT_MS = 5000;

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
type CodexUserInput = { type: 'text'; text: string } | { type: 'local_image'; path: string };
type CodexInput = string | CodexUserInput[];

interface CodexThread {
    /** Unique ID assigned by the Codex service after the first turn starts. */
    readonly id: string | null;
    /**
     * Run the thread with a prompt, resolving with the completed turn.
     */
    run(input: CodexInput, options?: CodexTurnOptions): Promise<CodexThreadResult>;
    /**
     * Run the thread with a prompt and stream structured events.
     */
    runStreamed(input: CodexInput, options?: CodexTurnOptions): Promise<{ events: AsyncGenerator<CodexThreadEvent> }>;
}

interface CodexTurnOptions {
    signal?: AbortSignal;
}

interface CodexThreadResult {
    finalResponse: string;
}

interface CodexThreadStartedEvent {
    type: 'thread.started';
    thread_id: string;
}

interface CodexTurnFailedEvent {
    type: 'turn.failed';
    error?: { message?: string };
}

/**
 * Per-turn token totals from a Codex `turn.completed` event — the ONLY usage
 * signal the `@openai/codex-sdk` exposes (index.d.ts `Usage`). Codex has no
 * native context-window signal (no max/limit, no running session total), so
 * `addCodexUsage` derives the context meter from two independent sources: the
 * static per-model `contextWindow` in `MODEL_REGISTRY` supplies `tokenLimit`,
 * and this event's own totals supply `currentTokens` as a latest-turn
 * occupancy snapshot (`input_tokens + output_tokens`; `cached_input_tokens` is
 * already a subset of `input_tokens`, and reasoning tokens are excluded because
 * they do not persist in context across turns). When the model id is unknown to
 * the registry, `tokenLimit` stays unset and the meter remains hidden.
 */
interface CodexUsage {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
}

interface CodexTurnCompletedEvent {
    type: 'turn.completed';
    usage?: CodexUsage;
}

interface CodexErrorEvent {
    type: 'error';
    message?: string;
}

interface CodexItemEvent {
    type: 'item.started' | 'item.updated' | 'item.completed';
    item?: {
        id?: string;
        type?: string;
        text?: string;
        command?: string;
        aggregated_output?: string;
        aggregatedOutput?: string | null;
        exit_code?: number;
        exitCode?: number | null;
        status?: string;
        changes?: Array<{ path?: string; kind?: string }>;
        server?: string;
        namespace?: string | null;
        tool?: string;
        arguments?: unknown;
        result?: unknown;
        error?: { message?: string } | string | null;
        query?: string;
        contentItems?: unknown[] | null;
        content_items?: unknown[] | null;
        success?: boolean | null;
        senderThreadId?: string;
        sender_thread_id?: string;
        receiverThreadIds?: string[];
        receiver_thread_ids?: string[];
        receiverThreadId?: string;
        receiver_thread_id?: string;
        newThreadId?: string;
        new_thread_id?: string;
        prompt?: string | null;
        model?: string | null;
        reasoningEffort?: string | null;
        reasoning_effort?: string | null;
        agentsStates?: Record<string, { status?: string; message?: string | null } | undefined>;
        agents_states?: Record<string, { status?: string; message?: string | null } | undefined>;
    };
}

type CodexThreadEvent = CodexThreadStartedEvent | CodexTurnCompletedEvent | CodexTurnFailedEvent | CodexErrorEvent | CodexItemEvent;
type CodexToolPhase = 'started' | 'updated' | 'completed';
interface NormalizedCodexToolItem {
    id: string;
    toolName: string;
    parameters: Record<string, unknown>;
    result?: string;
    error?: string;
}

interface CodexFileChange {
    path?: string;
    kind?: string;
}

interface CodexFileSnapshot {
    exists: boolean;
    content: string;
}

class CodexFileChangeDiffTracker {
    private readonly cwd: string | undefined;
    private initialized = false;
    private enabled = false;
    private root = '';
    private readonly dirtyStartSnapshots = new Map<string, CodexFileSnapshot>();
    private readonly lastSnapshots = new Map<string, CodexFileSnapshot>();

    public constructor(cwd: string | undefined) {
        this.cwd = cwd;
    }

    public async enrichParameters(changes: CodexFileChange[]): Promise<Record<string, unknown>> {
        const parameters: Record<string, unknown> = { changes };
        try {
            const diff = await this.captureDiff(changes);
            if (diff) {
                parameters.diff = diff;
            }
        } catch {
            // Codex file-change diffs are display metadata. Keep the tool event
            // itself successful even when local git or temp-file diffing fails.
        }
        return parameters;
    }

    public async initialize(): Promise<void> {
        await this.ensureInitialized();
    }

    private async captureDiff(changes: CodexFileChange[]): Promise<string | undefined> {
        const relPaths = changes
            .map(change => this.normalizeRelativePath(change.path))
            .filter((relPath): relPath is string => !!relPath);
        if (relPaths.length === 0) return undefined;

        await this.ensureInitialized();
        if (!this.enabled) return undefined;

        const parts: string[] = [];
        for (const relPath of relPaths) {
            const before = await this.resolveBaseline(relPath);
            const after = await this.readWorktreeSnapshot(relPath);
            const diff = await this.diffSnapshots(relPath, before, after);
            if (diff.trim()) {
                parts.push(diff.trimEnd());
            }
            this.lastSnapshots.set(relPath, after);
        }

        return parts.length > 0 ? `${parts.join('\n')}\n` : undefined;
    }

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        this.initialized = true;
        if (!this.cwd) return;

        try {
            const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
                cwd: this.cwd,
                timeout: CODEX_DIFF_TIMEOUT_MS,
            });
            this.root = stdout.trim();
            if (!this.root) return;
            this.enabled = true;
            await this.snapshotDirtyPaths();
        } catch {
            this.enabled = false;
        }
    }

    private async snapshotDirtyPaths(): Promise<void> {
        const { stdout } = await execFileAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
            cwd: this.root,
            timeout: CODEX_DIFF_TIMEOUT_MS,
        });
        const entries = stdout.split('\0').filter(Boolean);
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const status = entry.slice(0, 2);
            const relPath = this.normalizeRelativePath(entry.slice(3));
            if (!relPath) continue;
            this.dirtyStartSnapshots.set(relPath, await this.readWorktreeSnapshot(relPath));
            if (status[0] === 'R' || status[0] === 'C') {
                i++;
            }
        }
    }

    private async resolveBaseline(relPath: string): Promise<CodexFileSnapshot> {
        const last = this.lastSnapshots.get(relPath);
        if (last) return last;
        const dirty = this.dirtyStartSnapshots.get(relPath);
        if (dirty) return dirty;
        return this.readHeadSnapshot(relPath);
    }

    private async readHeadSnapshot(relPath: string): Promise<CodexFileSnapshot> {
        try {
            const { stdout } = await execFileAsync('git', ['show', `HEAD:${relPath}`], {
                cwd: this.root,
                timeout: CODEX_DIFF_TIMEOUT_MS,
                maxBuffer: 10 * 1024 * 1024,
            });
            return { exists: true, content: stdout };
        } catch {
            return { exists: false, content: '' };
        }
    }

    private async readWorktreeSnapshot(relPath: string): Promise<CodexFileSnapshot> {
        const fullPath = path.resolve(this.root, relPath);
        const rootWithSep = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;
        if (fullPath !== this.root && !fullPath.startsWith(rootWithSep)) {
            return { exists: false, content: '' };
        }
        try {
            return { exists: true, content: await fs.readFile(fullPath, 'utf8') };
        } catch {
            return { exists: false, content: '' };
        }
    }

    private async diffSnapshots(relPath: string, before: CodexFileSnapshot, after: CodexFileSnapshot): Promise<string> {
        if (before.exists === after.exists && before.content === after.content) return '';

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-file-diff-'));
        try {
            const beforePath = path.join(tempDir, 'before');
            const afterPath = path.join(tempDir, 'after');
            await fs.writeFile(beforePath, before.content, 'utf8');
            await fs.writeFile(afterPath, after.content, 'utf8');
            const rawDiff = await runGitDiffNoIndex([
                '--no-ext-diff',
                '--no-index',
                '--no-prefix',
                '--',
                beforePath,
                afterPath,
            ]);
            return rewriteNoIndexDiffHeaders(rawDiff, {
                beforeLabel: before.exists ? `a/${relPath}` : '/dev/null',
                afterLabel: after.exists ? `b/${relPath}` : '/dev/null',
            });
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    }

    private normalizeRelativePath(input: unknown): string | undefined {
        if (typeof input !== 'string' || !input.trim()) return undefined;
        const raw = input.replace(/\\/g, '/');
        if (path.isAbsolute(raw) || /^[a-zA-Z]:\//.test(raw)) return undefined;
        const normalized = path.posix.normalize(raw);
        if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized === '..') return undefined;
        return normalized;
    }
}

function rewriteNoIndexDiffHeaders(diff: string, labels: { beforeLabel: string; afterLabel: string }): string {
    let rewroteDiffHeader = false;
    let rewroteBeforeHeader = false;
    let rewroteAfterHeader = false;
    return diff.split(/\r?\n/).map(line => {
        if (!rewroteDiffHeader && line.startsWith('diff --git ')) {
            rewroteDiffHeader = true;
            return `diff --git ${labels.beforeLabel} ${labels.afterLabel}`;
        }
        if (!rewroteBeforeHeader && line.startsWith('--- ')) {
            rewroteBeforeHeader = true;
            return `--- ${labels.beforeLabel}`;
        }
        if (!rewroteAfterHeader && line.startsWith('+++ ')) {
            rewroteAfterHeader = true;
            return `+++ ${labels.afterLabel}`;
        }
        return line;
    }).join('\n');
}

function runGitDiffNoIndex(args: string[]): Promise<string> {
    const finalArgs = ['diff', ...args];
    return new Promise((resolve, reject) => {
        const child = spawn('git', finalArgs, {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error('git diff timed out'));
        }, CODEX_DIFF_TIMEOUT_MS);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr += chunk; });
        child.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', code => {
            clearTimeout(timer);
            if (code === 0 || code === 1) {
                resolve(stdout);
                return;
            }
            reject(new Error(stderr.trim() || `git diff exited with code ${code}`));
        });
    });
}

interface CodexClient {
    startThread(options?: CodexStartThreadOptions): CodexThread;
    resumeThread(threadId: string, options?: CodexStartThreadOptions): CodexThread;
}

/**
 * Constructor options accepted by the `Codex` client. Only `config` is used by
 * this adapter — to inject `mcp_servers` CLI overrides for the CoC LLM-tool
 * bridge. Mirrors `CodexOptions.config` (a JSON object flattened by the SDK into
 * `--config key=value` TOML overrides).
 */
interface CodexConstructorOptions {
    config?: Record<string, unknown>;
    /**
     * Absolute path to the native `codex` binary. Set for packaged desktop
     * builds so the SDK spawns the `app.asar.unpacked` copy instead of its own
     * resolution, which points inside `app.asar` and fails to spawn (`ENOTDIR`).
     */
    codexPathOverride?: string;
}

/** Constructs a Codex client. The published SDK accepts optional `CodexOptions`. */
type CodexClientCtor = new (options?: CodexConstructorOptions) => CodexClient;

/** Subset of the @openai/codex-sdk API used by this adapter. */
interface CodexSDKModule {
    Codex?: CodexClientCtor;
    default?: { Codex?: CodexClientCtor } | CodexClientCtor;
}

interface CodexStartThreadOptions {
    model?: string;
    workingDirectory?: string;
    additionalDirectories?: string[];
    skipGitRepoCheck?: boolean;
    sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
    networkAccessEnabled?: boolean;
    /** Reasoning level passed to the Codex backend (e.g. 'low', 'medium', 'high', 'xhigh'). */
    reasoningLevel?: string;
}

interface CodexCatalogModel {
    slug?: unknown;
    display_name?: unknown;
    visibility?: unknown;
    default_reasoning_level?: unknown;
    supported_reasoning_levels?: unknown;
}

interface CodexReasoningLevel {
    effort?: unknown;
}

// ============================================================================
// Codex app-server RPC response types
// ============================================================================

interface CodexRateLimitWindow {
    usedPercent: number;
    windowDurationMins: number;
    resetsAt: number;
}

interface CodexCredits {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string;
}

interface CodexRateLimitEntry {
    limitId: string;
    limitName: string | null;
    primary: CodexRateLimitWindow;
    secondary: CodexRateLimitWindow | null;
    credits: CodexCredits;
    planType: string;
    rateLimitReachedType: string | null;
}

interface CodexRateLimitsResult {
    rateLimits: CodexRateLimitEntry;
    rateLimitsByLimitId?: Record<string, CodexRateLimitEntry>;
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
    private sdk: CodexClient | null = null;
    /** Cached Codex constructor, used to build per-request clients carrying MCP config. */
    private codexCtor: CodexClientCtor | null = null;
    private disposed = false;
    private authChecker: CodexAuthChecker | null = null;
    /**
     * Memoized native-binary override for packaged desktop builds. `null` means
     * "not yet computed"; `undefined` is a computed "no override" (the SDK
     * resolves the binary itself). See {@link resolveCodexConstructorOptions}.
     */
    private codexPathOverride: string | undefined | null = null;

    /** sessionId → active session metadata */
    private readonly sessions = new Map<string, ActiveCodexSession>();

    /**
     * Warm-client keep-alive for chat turns (AC-02). Codex routes warm-eligible
     * turns through the same shared {@link runWithWarmClient} abstraction as
     * Copilot, keyed per `(provider, warmKey)`. The warm unit is the
     * base Codex client (built without per-turn MCP config); the per-turn
     * CoC LLM-tool MCP bridge stays per-invocation because Codex bakes
     * `mcp_servers`/`enabled_tools` into the client constructor and the tool set
     * can change per turn, so reusing an MCP-configured client across turns would
     * risk a stale allow-list. This keeps warming faithful to the "MCP is a
     * per-turn session option that does not force teardown" decision.
     */
    /**
     * Fan-out for warm-client state transitions to external observers (e.g. the
     * CoC SSE bridge). Declared before {@link warmRegistry} so its field
     * initializer runs first and `this.warmStatus.emit` is bound when the
     * registry is constructed below.
     */
    private readonly warmStatus = new WarmStatusBroadcaster();

    private readonly warmRegistry = new WarmClientRegistry({
        ttlMs: resolveWarmClientTtlMs(),
        logger: getSDKLogger(),
        onStateChange: this.warmStatus.emit,
    });

    // ── Auth checker injection (AC-08) ────────────────────────────────────────

    /**
     * Inject an auth checker. When set, `sendMessage` calls it before each
     * request and returns an auth-required error when not authenticated.
     *
     * Host applications can use this to block calls before the Codex SDK is
     * loaded. CoC itself does not inject a checker; Codex CLI/SDK auth is used.
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
            const mod = await dynamicImportModule('@openai/codex-sdk');
            const sdkModule = mod as CodexSDKModule;
            const CodexCtor = sdkModule.Codex
                ?? (typeof sdkModule.default === 'function' ? sdkModule.default : sdkModule.default?.Codex);
            if (!CodexCtor) {
                throw new Error('Codex SDK did not export Codex');
            }
            this.codexCtor = CodexCtor;
            this.sdk = new CodexCtor(this.resolveCodexConstructorOptions());
            this.availabilityCache = { available: true };
        } catch {
            const installCmd = isGlobalInstall()
                ? 'npm install -g @openai/codex-sdk'
                : 'npm install @openai/codex-sdk --no-save  # run from the repo root';
            this.availabilityCache = {
                available: false,
                error:
                    'Codex SDK not installed (~239 MB). To enable Codex, run:\n' +
                    `  ${installCmd}\n` +
                    'Then restart CoC.',
            };
        }
        return this.availabilityCache;
    }

    public clearAvailabilityCache(): void {
        this.availabilityCache = null;
        this.sdk = null;
        this.codexCtor = null;
    }

    /**
     * Resolve the Codex client to use for a single request.
     *
     * When the caller supplies CoC LLM tools, those are exposed to Codex through
     * an MCP bridge: a per-invocation {@link CocToolRuntime} is registered on the
     * loopback {@link cocToolBridgeServer}, and a fresh Codex client is built with
     * `config.mcp_servers` pointing at the bridge. The returned `cleanup` disposes
     * the runtime and unregisters the bridge route after the turn — no caching.
     *
     * With no tools (the common case) the shared `this.sdk` client is reused.
     */
    private async resolveRequestClient(
        options: SendMessageOptions,
        baseClient?: CodexClient,
    ): Promise<{ client: CodexClient; cleanup: () => void }> {
        const tools = options.tools;
        if (!tools || tools.length === 0 || !this.codexCtor) {
            // No tools: reuse the warm base client when one was acquired for this
            // turn, otherwise the shared singleton. Either carries no MCP config.
            return { client: baseClient ?? this.sdk!, cleanup: () => {} };
        }

        const runtime = new CocToolRuntime(tools, { sessionId: options.sessionId });
        const registration = await cocToolBridgeServer.register(runtime);
        const mcpConfig = buildCocLlmToolsMcpConfig({
            endpoint: registration.endpoint,
            token: registration.token,
            enabledTools: Array.from(new Set(tools.map(tool => tool.name).filter(Boolean))),
        });
        const serverConfig = {
            command: mcpConfig.command,
            args: mcpConfig.args,
            env: mcpConfig.env,
            tool_timeout_sec: CODEX_LLM_TOOLS_TIMEOUT_SEC,
            ...(mcpConfig.enabled_tools ? { enabled_tools: mcpConfig.enabled_tools } : {}),
        };
        const client = new this.codexCtor(
            this.resolveCodexConstructorOptions({
                config: {
                    mcp_servers: {
                        [COC_LLM_TOOLS_MCP_SERVER_NAME]: serverConfig,
                    },
                },
            }),
        );
        return {
            client,
            cleanup: () => {
                registration.unregister();
                runtime.dispose();
            },
        };
    }

    // ── Model discovery ───────────────────────────────────────────────────────

    public async listModels(): Promise<IModelInfo[]> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');
        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');
        return this.loadModelCatalog();
    }

    private async loadModelCatalog(): Promise<IModelInfo[]> {
        const { stdout } = await this.runCodexCli(['debug', 'models'], { timeout: 30_000 });
        const parsed = JSON.parse(stdout) as { models?: unknown };
        if (!Array.isArray(parsed.models)) return [];
        const models = parsed.models
            .map(model => this.mapCatalogModel(model as CodexCatalogModel))
            .filter((model): model is IModelInfo => model !== undefined);
        if (models.length > 0) return models;
        return [{ id: 'codex-default', name: 'Codex Provider Default' }];
    }

    private mapCatalogModel(model: CodexCatalogModel): IModelInfo | undefined {
        if (typeof model.slug !== 'string' || !model.slug) return undefined;
        if (model.visibility !== 'list') return undefined;
        const supportedReasoningEfforts = this.normalizeReasoningLevels(model.supported_reasoning_levels);
        const defaultReasoningEffort = typeof model.default_reasoning_level === 'string'
            && supportedReasoningEfforts.includes(model.default_reasoning_level)
            ? model.default_reasoning_level
            : undefined;
        return {
            id: model.slug,
            name: typeof model.display_name === 'string' && model.display_name ? model.display_name : model.slug,
            capabilities: {
                supports: {
                    vision: false,
                    reasoningEffort: supportedReasoningEfforts.length > 0,
                    reasoning_effort: supportedReasoningEfforts,
                },
                limits: { max_context_window_tokens: 0 },
            },
            supportedReasoningEfforts,
            ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
        } as IModelInfo;
    }

    private normalizeReasoningLevels(value: unknown): string[] {
        if (!Array.isArray(value)) return [];
        const efforts = new Set<string>();
        for (const level of value as CodexReasoningLevel[]) {
            if (typeof level.effort === 'string' && level.effort) {
                efforts.add(level.effort);
            }
        }
        return ['minimal', 'low', 'medium', 'high', 'xhigh'].filter(effort => efforts.has(effort));
    }

    // ── Account quota via codex app-server RPC ────────────────────────────────

    /**
     * Fetch Codex account quota by spawning `codex app-server` and reading
     * rate limits via JSON-RPC over stdin/stdout.
     */
    public async getAccountQuota(): Promise<IAccountQuotaResult> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');

        const codexBinPath = this.resolveCodexBinPath();
        const rpcResult = await this.fetchRateLimitsViaRpc(codexBinPath);
        return this.mapRateLimitsToQuota(rpcResult);
    }

    /**
     * Build the options for `new Codex(...)`, injecting `codexPathOverride` for
     * packaged desktop builds so the SDK spawns the unpacked native binary
     * rather than the `app.asar` path it would resolve itself (which fails to
     * spawn with `ENOTDIR`). A no-op for normal CLI / global installs, where the
     * override resolves to `undefined`. The override is computed once and cached.
     */
    private resolveCodexConstructorOptions(
        extra: CodexConstructorOptions = {},
    ): CodexConstructorOptions {
        if (this.codexPathOverride === null) {
            this.codexPathOverride = resolveCodexExecutablePath();
        }
        return this.codexPathOverride
            ? { codexPathOverride: this.codexPathOverride, ...extra }
            : { ...extra };
    }

    private resolveCodexBinPath(): string {
        try {
            return runtimeRequire.resolve('@openai/codex/bin/codex.js');
        } catch {
            // Older package layouts did not expose the bin file as a resolvable
            // subpath, but did allow resolving package.json.
        }

        try {
            const packageJsonPath = runtimeRequire.resolve('@openai/codex/package.json');
            return path.join(path.dirname(packageJsonPath), 'bin', 'codex.js');
        } catch {
            throw new Error('Codex CLI (@openai/codex) is not installed');
        }
    }

    /**
     * Run the bundled Codex CLI (`codex <args>`) as a child of the current Node
     * runtime, resolving with its captured stdio. Shared by the model-catalog
     * and quota RPCs so every Codex CLI invocation uses the same robust spawn
     * pattern (Node runtime + resolved `codex.js` path, rather than relying on a
     * `codex` binary on PATH).
     */
    private runCodexCli(args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }> {
        const codexBinPath = this.resolveCodexBinPath();
        return execFileAsync(process.execPath, [codexBinPath, ...args], {
            timeout: options.timeout,
            maxBuffer: 50 * 1024 * 1024,
        });
    }

    /**
     * Fetch Codex rate limits over JSON-RPC.
     *
     * In `@openai/codex` ≥ 0.133.0, `codex app-server` is a subcommand *group*:
     * the bare invocation exits immediately. Use the explicit stdio listener
     * instead of the daemon/proxy flow: daemon start requires the installer-
     * managed standalone Codex path, while stdio works with the SDK-bundled CLI
     * that CoC already resolves for protocol compatibility.
     */
    private async fetchRateLimitsViaRpc(codexBinPath: string): Promise<CodexRateLimitsResult> {
        return this.readRateLimitsViaStdioAppServer(codexBinPath);
    }

    /** Spawn `codex app-server --listen stdio://`, send RPC messages, and return rate limits. */
    private readRateLimitsViaStdioAppServer(codexBinPath: string): Promise<CodexRateLimitsResult> {
        return new Promise<CodexRateLimitsResult>((resolve, reject) => {
            const child = spawn(process.execPath, [codexBinPath, 'app-server', '--listen', 'stdio://'], {
                stdio: ['pipe', 'pipe', 'ignore'],
                windowsHide: true,
            });

            const rl = readline.createInterface({ input: child.stdout! });
            let settled = false;

            const cleanup = () => {
                if (settled) return;
                settled = true;
                rl.close();
                child.kill('SIGTERM');
            };

            const timer = setTimeout(() => {
                cleanup();
                reject(new Error('Codex app-server stdio RPC timed out'));
            }, 10_000);

            child.on('error', (err) => {
                clearTimeout(timer);
                cleanup();
                reject(err);
            });

            child.on('exit', () => {
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    reject(new Error('Codex app-server stdio exited before returning rate limits'));
                }
            });

            rl.on('line', (line) => {
                try {
                    const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
                    // Wait for the rateLimits response (id: 2)
                    if (msg.id === 2) {
                        clearTimeout(timer);
                        if (msg.error) {
                            cleanup();
                            reject(new Error(msg.error.message ?? 'Codex RPC error'));
                        } else {
                            cleanup();
                            resolve(msg.result as CodexRateLimitsResult);
                        }
                    }
                } catch {
                    // Ignore non-JSON lines
                }
            });

            // Every message carries the JSON-RPC 2.0 envelope so the daemon
            // accepts it (bare messages without `jsonrpc` are rejected).
            const send = (msg: Record<string, unknown>) => {
                child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
            };

            send({
                method: 'initialize',
                id: 0,
                params: {
                    clientInfo: { name: 'coc', title: 'Copilot of Copilot', version: '0.1.0' },
                },
            });
            send({ method: 'initialized', params: {} });
            send({ method: 'account/rateLimits/read', id: 2, params: {} });
        });
    }

    /** Map Codex rate limits response to the IAccountQuotaResult format. */
    private mapRateLimitsToQuota(result: CodexRateLimitsResult): IAccountQuotaResult {
        return mapCodexRateLimitsToQuota(result);
    }

    private buildCodexInput(options: SendMessageOptions): CodexInput {
        const text = this.applyCodexSystemMessage(options.prompt ?? '', options.systemMessage);
        const imagePaths = (options.attachments ?? [])
            .filter(attachment => attachment.type === 'file' && isSupportedCodexImagePath(attachment.path))
            .map(attachment => attachment.path);

        if (imagePaths.length === 0) return text;

        return [
            ...(text ? [{ type: 'text' as const, text }] : []),
            ...imagePaths.map(imagePath => ({ type: 'local_image' as const, path: imagePath })),
        ];
    }

    /**
     * Codex's `ThreadOptions` has no native system-prompt field, so honour
     * `SendMessageOptions.systemMessage` by prepending the content to the user
     * prompt. Both `append` and `replace` modes use the same prepend format.
     */
    private applyCodexSystemMessage(prompt: string, systemMessage?: SystemMessageConfig): string {
        if (!systemMessage?.content) return prompt;
        return `[System instructions]:\n${systemMessage.content}\n\n${prompt}`;
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
                    : 'Codex (ChatGPT) authentication required. Run the Codex executable sign-in flow.';
                return {
                    success: false,
                    error: authMsg,
                    sessionId: options.sessionId,
                };
            }
        }

        if (options.signal?.aborted) {
            return { success: false, error: 'Request aborted', sessionId: options.sessionId };
        }

        const avail = await this.isAvailable();
        if (!avail.available) {
            return { success: false, error: avail.error };
        }

        // Cold path: one-shot/transform turns (no keepWarm) or warming disabled
        // (TTL <= 0) run a fresh turn directly. Chat turns set keepWarm and route
        // through the shared warm-client abstraction so the base client is reused.
        if (!options.keepWarm || !this.warmRegistry.warmingEnabled) {
            return this.runTurn(options);
        }
        if (!options.warmKey) {
            getSDKLogger().warn(
                { provider: CODEX_PROVIDER, workingDirectory: options.workingDirectory },
                'Warm client requested without warmKey; running cold',
            );
            return this.runTurn(options);
        }
        return this.sendWarm(options);
    }

    /**
     * Run a warm-eligible Codex turn: reuse a parked base client for this
     * `(provider, warmKey)` when available, otherwise cold-start one and
     * park it for the next turn. A fresh thread is still started/resumed per turn,
     * so conversation continuity is unaffected. When the turn uses CoC LLM tools,
     * the per-turn MCP bridge is still built and torn down per invocation (the
     * base client carries no MCP config); the warm base client is reused for the
     * no-tools case and otherwise kept warm for the next turn and for prewarm.
     */
    private async sendWarm(options: SendMessageOptions): Promise<IInvocationResult> {
        const log = getSDKLogger();
        const key = makeWarmKey(CODEX_PROVIDER, options.warmKey);

        return runWithWarmClient<IInvocationResult>({
            registry: this.warmRegistry,
            key,
            factory: this.buildWarmFactory(),
            logger: log,
            coldFallback: () => this.runTurn(options),
            run: async (handle, warmHit) => {
                log.debug(
                    { key, provider: CODEX_PROVIDER, warmKey: options.warmKey, workingDirectory: options.workingDirectory, warmHit },
                    warmHit ? 'Warm client hit — reusing live process' : 'Warm client miss — cold start',
                );
                const result = await this.runTurn(options, handle.client as CodexClient);
                // Keep warm only on a clean, un-aborted success; abort/error tears
                // the entry down.
                const keepWarm = result.success === true && options.signal?.aborted !== true;
                return { result, keepWarm };
            },
        });
    }

    /**
     * Build the warm-client factory for Codex. Shared by {@link sendWarm}
     * (cold-miss path) and {@link prewarm} so both park an identical base client
     * under the same key. Codex's base client owns no child process of its own
     * (the codex CLI spawns per `thread.run()`), so `stop` is a no-op and the
     * working directory is not baked in here — it is a per-thread option, while
     * the warm key still namespaces by `(provider, warmKey)`.
     */
    private buildWarmFactory(): WarmClientFactory {
        return async () => {
            const ctor = this.codexCtor;
            if (!ctor) throw new Error('Codex client constructor unavailable');
            const client = new ctor();
            return { client, stop: async () => {} };
        };
    }

    /**
     * Pre-warm the Codex base client for the next turn without creating a
     * session (AC-04). Idempotent and best-effort: no-ops when warming is
     * disabled (TTL <= 0), when the Codex SDK is unavailable, or while a turn is
     * in flight on the same key (handled by the registry). The base client is
     * parked under `makeWarmKey(CODEX_PROVIDER, warmKey)` so the next
     * {@link sendMessage} reuses it for a no-tools turn (tools turns still build
     * a per-invocation MCP-configured client); a send arriving mid-warm attaches
     * to the in-flight warming.
     */
    public async prewarm(options: PrewarmOptions): Promise<void> {
        if (this.disposed || !this.warmRegistry.warmingEnabled) return;
        if (!options.warmKey) {
            getSDKLogger().warn(
                { provider: CODEX_PROVIDER, workingDirectory: options.workingDirectory },
                'Prewarm requested without warmKey; skipping',
            );
            return;
        }
        const avail = await this.isAvailable();
        if (!avail.available) return;
        const key = makeWarmKey(CODEX_PROVIDER, options.warmKey);
        await this.warmRegistry.prewarm(key, this.buildWarmFactory());
    }

    /**
     * Current warm {@link WarmStatus} for a conversation's `(codex, warmKey)` key —
     * the synchronous snapshot read used by the CoC SSE bridge to emit an initial
     * warm-status frame. Uses the same key as {@link prewarm}, so a freshly
     * subscribed stream sees the live state (`warm`/`active`/`warming`/`cold`).
     */
    public getWarmStatus(options: PrewarmOptions): WarmStatus {
        if (!options.warmKey) return 'cold';
        return this.warmRegistry.getStatus(makeWarmKey(CODEX_PROVIDER, options.warmKey));
    }

    /**
     * Subscribe to warm-client state transitions for this service's registry.
     * The listener receives `(key, status)` on every change, where `key` is
     * `makeWarmKey(CODEX_PROVIDER, warmKey)`. Used by the CoC SSE bridge
     * to push warm status to the SPA indicator. Returns an unsubscribe function.
     */
    public onWarmStatusChange(listener: WarmStateChangeListener): () => void {
        return this.warmStatus.subscribe(listener);
    }

    /**
     * Execute a single Codex turn. `baseClient`, when provided (warm path), is the
     * warm base client to run a no-tools turn on; tools turns always build a fresh
     * per-invocation MCP-configured client regardless.
     */
    private async runTurn(options: SendMessageOptions, baseClient?: CodexClient): Promise<IInvocationResult> {
        const abortController = new AbortController();

        // Propagate caller's AbortSignal into our internal controller so
        // abortSession() and the caller's signal both terminate the thread.
        let signalCleanup: (() => void) | undefined;
        if (options.signal) {
            const onAbort = () => abortController.abort();
            options.signal.addEventListener('abort', onAbort);
            signalCleanup = () => options.signal!.removeEventListener('abort', onAbort);
        }

        let threadId: string | undefined;
        let sessionCreatedNotified = false;
        const toolCalls = new Map<string, ToolCall>();
        const startedToolCalls = new Set<string>();
        const completedToolCalls = new Set<string>();
        const fileChangeDiffTracker = new CodexFileChangeDiffTracker(options.workingDirectory);
        // Releases the per-invocation CoC LLM-tool MCP bridge (no-op when no tools).
        let mcpCleanup: () => void = () => {};

        try {
            // Resolve the client for this request. With CoC LLM tools present this
            // builds a fresh client carrying the bridge's mcp_servers config.
            const effectiveModel = this.normalizeCodexModel(options.model);
            const { client: sdk, cleanup } = await this.resolveRequestClient(options, baseClient);
            mcpCleanup = cleanup;

            let thread: CodexThread;
            const threadOptions = this.buildThreadOptions(options);
            if (options.sessionId) {
                // options.sessionId is the Codex thread ID persisted from the previous
                // request via onSessionCreated — resume the existing conversation.
                thread = sdk.resumeThread(options.sessionId, threadOptions);
            } else {
                thread = sdk.startThread(threadOptions);
            }

            const notifySessionCreated = (id: string) => {
                if (sessionCreatedNotified) return;
                threadId = id;
                this.sessions.set(id, { threadId: id, abortController });
                options.onSessionCreated?.(id);
                sessionCreatedNotified = true;
            };

            if (thread.id) notifySessionCreated(thread.id);

            const chunks: string[] = [];
            let tokenUsage: TokenUsage | undefined;
            await fileChangeDiffTracker.initialize();
            const streamed = await thread.runStreamed(this.buildCodexInput(options), { signal: abortController.signal });

            for await (const event of streamed.events) {
                if (event.type === 'thread.started') {
                    notifySessionCreated(event.thread_id);
                    continue;
                }
                if (event.type === 'turn.completed') {
                    tokenUsage = addCodexUsage(tokenUsage, event.usage, effectiveModel);
                    continue;
                }
                if (event.type === 'turn.failed') {
                    throw new Error(event.error?.message ?? 'Codex turn failed');
                }
                if (event.type === 'error') {
                    throw new Error(event.message ?? 'Codex stream error');
                }
                if (event.type === 'item.started') {
                    await this.handleCodexToolItem(event.item, 'started', options, toolCalls, startedToolCalls, completedToolCalls, fileChangeDiffTracker);
                    continue;
                }
                if (event.type === 'item.updated') {
                    await this.handleCodexToolItem(event.item, 'updated', options, toolCalls, startedToolCalls, completedToolCalls, fileChangeDiffTracker);
                    continue;
                }
                if (event.type === 'item.completed') {
                    if ((event.item?.type === 'agent_message' || event.item?.type === 'agentMessage') && event.item.text) {
                        chunks.push(event.item.text);
                        options.onStreamingChunk?.(event.item.text);
                        continue;
                    }
                    await this.handleCodexToolItem(event.item, 'completed', options, toolCalls, startedToolCalls, completedToolCalls, fileChangeDiffTracker);
                    continue;
                }
            }

            if (!sessionCreatedNotified && thread.id) notifySessionCreated(thread.id);

            // Empty chunk signals end-of-stream to the executor's streaming consumer.
            options.onStreamingChunk?.('');

            return {
                success: true,
                response: chunks.join(''),
                sessionId: threadId,
                ...(tokenUsage ? { tokenUsage } : {}),
                effectiveModel,
                ...(toolCalls.size > 0 ? { toolCalls: Array.from(toolCalls.values()) } : {}),
            } as IInvocationResult;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, sessionId: options.sessionId ?? threadId, effectiveModel: this.normalizeCodexModel(options.model) };
        } finally {
            signalCleanup?.();
            mcpCleanup();
            if (threadId) this.sessions.delete(threadId);
        }
    }

    private async handleCodexToolItem(
        item: CodexItemEvent['item'] | undefined,
        phase: CodexToolPhase,
        options: SendMessageOptions,
        toolCalls: Map<string, ToolCall>,
        startedToolCalls: Set<string>,
        completedToolCalls: Set<string>,
        fileChangeDiffTracker: CodexFileChangeDiffTracker,
    ): Promise<void> {
        const effectivePhase = phase === 'updated' && this.isTerminalCodexToolItem(item) ? 'completed' : phase;
        const normalized = await this.normalizeCodexToolItem(item, effectivePhase, fileChangeDiffTracker);
        if (!normalized) return;

        if (effectivePhase !== 'completed') {
            if (startedToolCalls.has(normalized.id)) {
                const existing = toolCalls.get(normalized.id);
                if (existing) {
                    existing.args = normalized.parameters;
                }
                return;
            }
            startedToolCalls.add(normalized.id);
            const now = new Date();
            toolCalls.set(normalized.id, {
                id: normalized.id,
                name: normalized.toolName,
                status: 'running',
                startTime: now,
                args: normalized.parameters,
            });
            this.emitToolEvent(options, {
                type: 'tool-start',
                toolCallId: normalized.id,
                toolName: normalized.toolName,
                parameters: normalized.parameters,
            });
            return;
        }

        if (completedToolCalls.has(normalized.id)) return;
        if (!startedToolCalls.has(normalized.id)) {
            await this.handleCodexToolItem(item, 'started', options, toolCalls, startedToolCalls, completedToolCalls, fileChangeDiffTracker);
        }

        const existing = toolCalls.get(normalized.id);
        const endTime = new Date();
        if (existing) {
            existing.status = normalized.error ? 'failed' : 'completed';
            existing.endTime = endTime;
            existing.args = normalized.parameters;
            if (normalized.error) {
                existing.error = normalized.error;
            } else {
                existing.result = normalized.result;
            }
        }
        completedToolCalls.add(normalized.id);

        this.emitToolEvent(options, normalized.error
            ? {
                type: 'tool-failed',
                toolCallId: normalized.id,
                toolName: normalized.toolName,
                error: normalized.error,
            }
            : {
                type: 'tool-complete',
                toolCallId: normalized.id,
                toolName: normalized.toolName,
                parameters: normalized.parameters,
                result: normalized.result,
            });
    }

    private emitToolEvent(options: SendMessageOptions, event: ToolEvent): void {
        try {
            options.onToolEvent?.(event);
        } catch {
            // Tool events are observational; never fail the Codex turn because
            // a caller-side renderer/cache handler threw.
        }
    }

    private async normalizeCodexToolItem(
        item: CodexItemEvent['item'] | undefined,
        phase: CodexToolPhase,
        fileChangeDiffTracker: CodexFileChangeDiffTracker,
    ): Promise<NormalizedCodexToolItem | undefined> {
        if (!item?.type || !item.id) return undefined;
        switch (this.normalizeCodexItemType(item.type)) {
            case 'commandexecution': {
                const command = typeof item.command === 'string' ? item.command : '';
                const output = this.getStringField(item, 'aggregated_output', 'aggregatedOutput') ?? '';
                const exitCode = this.getNumberField(item, 'exit_code', 'exitCode');
                const failed = this.isFailedStatus(item.status);
                return {
                    id: item.id,
                    toolName: 'shell',
                    parameters: { command },
                    ...(failed ? { error: output || `Command failed${typeof exitCode === 'number' ? ` with exit code ${exitCode}` : ''}` } : { result: output }),
                };
            }
            case 'filechange': {
                const changes = Array.isArray(item.changes) ? item.changes : [];
                const failed = this.isFailedStatus(item.status);
                const parameters = phase === 'completed' && !failed
                    ? await fileChangeDiffTracker.enrichParameters(changes)
                    : { changes };
                return {
                    id: item.id,
                    toolName: 'apply_patch',
                    parameters,
                    ...(failed ? { error: 'File change failed' } : { result: this.summarizeFileChanges(changes) }),
                };
            }
            case 'mcptoolcall': {
                const tool = typeof item.tool === 'string' && item.tool ? item.tool : 'mcp_tool';
                const server = typeof item.server === 'string' ? item.server : undefined;
                const error = this.getCodexErrorMessage(item.error) ?? (this.isFailedStatus(item.status) ? `${tool} failed` : undefined);
                const toolArguments = (item.arguments && typeof item.arguments === 'object' && !Array.isArray(item.arguments))
                    ? item.arguments as Record<string, unknown>
                    : {};
                const parameters = server === COC_LLM_TOOLS_MCP_SERVER_NAME
                    ? toolArguments
                    : {
                        ...(server ? { server } : {}),
                        arguments: toolArguments,
                    };
                return {
                    id: item.id,
                    toolName: tool,
                    parameters,
                    ...(error ? { error } : { result: this.stringifyCodexResult(item.result) }),
                };
            }
            case 'websearch': {
                const query = typeof item.query === 'string' ? item.query : '';
                return {
                    id: item.id,
                    toolName: 'web_search',
                    parameters: { query },
                    result: query ? `Searched: ${query}` : 'Search completed',
                };
            }
            case 'dynamictoolcall':
                return this.normalizeCodexDynamicToolCall(item);
            case 'collabagenttoolcall':
            case 'collabtoolcall':
                return this.normalizeCodexCollabAgentToolCall(item);
            default:
                return undefined;
        }
    }

    private normalizeCodexDynamicToolCall(item: NonNullable<CodexItemEvent['item']>): NormalizedCodexToolItem | undefined {
        if (!item.id) return undefined;
        const rawToolName = this.getStringField(item, 'tool') ?? 'dynamic_tool';
        const toolKey = this.normalizeCodexItemType(rawToolName);
        const namespace = this.getStringField(item, 'namespace');
        const toolArguments = this.normalizeCodexArguments(item.arguments);
        const failed = this.isFailedStatus(item.status) || item.success === false;
        const output = this.stringifyDynamicContentItems(item.contentItems ?? item.content_items) ?? this.stringifyCodexResult(item.result);
        const error = this.getCodexErrorMessage(item.error) ?? (failed ? output ?? `${rawToolName} failed` : undefined);

        if (toolKey === 'spawnagent' || toolKey === 'task') {
            const parameters = this.normalizeAgentParameters(toolArguments);
            return {
                id: item.id,
                toolName: 'task',
                parameters: {
                    ...parameters,
                    agent_type: typeof parameters.agent_type === 'string' ? parameters.agent_type : 'codex',
                },
                ...(error ? { error } : { result: output ?? this.summarizeDynamicAgentResult('spawnAgent', parameters) }),
            };
        }

        if (toolKey === 'waitagent' || toolKey === 'readagent' || toolKey === 'wait') {
            const parameters = this.normalizeAgentParameters(toolArguments);
            return {
                id: item.id,
                toolName: 'read_agent',
                parameters: {
                    ...parameters,
                    wait: parameters.wait ?? true,
                },
                ...(error ? { error } : { result: output ?? this.summarizeDynamicAgentResult('wait', parameters) }),
            };
        }

        const parameters = namespace
            ? { namespace, arguments: toolArguments }
            : toolArguments;
        return {
            id: item.id,
            toolName: rawToolName,
            parameters,
            ...(error ? { error } : { result: output }),
        };
    }

    private normalizeCodexCollabAgentToolCall(item: NonNullable<CodexItemEvent['item']>): NormalizedCodexToolItem | undefined {
        if (!item.id) return undefined;
        const tool = this.getStringField(item, 'tool') ?? 'collabAgentToolCall';
        const toolKey = this.normalizeCodexItemType(tool);
        const receiverThreadIds = this.getReceiverThreadIds(item);
        const agentStates = this.getAgentStates(item);
        const prompt = this.getStringField(item, 'prompt');
        const baseParameters = this.buildCollabAgentParameters(item, receiverThreadIds, agentStates);
        const failed = this.isFailedStatus(item.status);
        const result = this.summarizeCollabAgentResult(tool, receiverThreadIds, agentStates);
        const error = this.getCodexErrorMessage(item.error) ?? (failed ? result ?? `${tool} failed` : undefined);

        if (toolKey === 'spawnagent') {
            return {
                id: item.id,
                toolName: 'task',
                parameters: {
                    agent_type: 'codex',
                    ...(prompt ? { description: prompt, prompt } : {}),
                    ...baseParameters,
                },
                ...(error ? { error } : { result: result ?? this.summarizeCollabAgentSpawn(receiverThreadIds) }),
            };
        }

        if (toolKey === 'wait') {
            return {
                id: item.id,
                toolName: 'read_agent',
                parameters: {
                    ...baseParameters,
                    wait: true,
                },
                ...(error ? { error } : { result: result ?? 'Agent wait completed' }),
            };
        }

        return {
            id: item.id,
            toolName: `codex_${this.toSnakeCase(tool)}`,
            parameters: {
                operation: tool,
                ...(prompt ? { prompt } : {}),
                ...baseParameters,
            },
            ...(error ? { error } : { result: result ?? `${tool} completed` }),
        };
    }

    private isTerminalCodexToolItem(item: CodexItemEvent['item'] | undefined): boolean {
        if (!item) return false;
        if (this.isCompletedStatus(item.status) || this.isFailedStatus(item.status)) return true;
        return typeof item.success === 'boolean';
    }

    private normalizeCodexItemType(type: string): string {
        return type.replace(/[_-]/g, '').toLowerCase();
    }

    private isCompletedStatus(status: unknown): boolean {
        return typeof status === 'string' && status.toLowerCase() === 'completed';
    }

    private isFailedStatus(status: unknown): boolean {
        if (typeof status !== 'string') return false;
        const normalized = status.toLowerCase();
        return normalized === 'failed' || normalized === 'errored';
    }

    private getStringField(value: unknown, ...keys: string[]): string | undefined {
        if (!this.isRecord(value)) return undefined;
        for (const key of keys) {
            const field = value[key];
            if (typeof field === 'string' && field.length > 0) return field;
        }
        return undefined;
    }

    private getNumberField(value: unknown, ...keys: string[]): number | undefined {
        if (!this.isRecord(value)) return undefined;
        for (const key of keys) {
            const field = value[key];
            if (typeof field === 'number') return field;
        }
        return undefined;
    }

    private normalizeCodexArguments(value: unknown): Record<string, unknown> {
        if (this.isRecord(value)) return { ...value };
        return value === undefined ? {} : { arguments: value };
    }

    private normalizeAgentParameters(parameters: Record<string, unknown>): Record<string, unknown> {
        const normalized = { ...parameters };
        if (typeof normalized.agent_id !== 'string') {
            for (const key of ['agentId', 'threadId', 'thread_id', 'receiverThreadId', 'receiver_thread_id']) {
                if (typeof normalized[key] === 'string') {
                    normalized.agent_id = normalized[key];
                    break;
                }
            }
        }
        return normalized;
    }

    private getCodexErrorMessage(error: unknown): string | undefined {
        if (typeof error === 'string' && error.length > 0) return error;
        if (this.isRecord(error) && typeof error.message === 'string' && error.message.length > 0) {
            return error.message;
        }
        return undefined;
    }

    private getReceiverThreadIds(item: NonNullable<CodexItemEvent['item']>): string[] {
        const ids = this.getStringArrayField(item, 'receiverThreadIds', 'receiver_thread_ids');
        for (const key of ['receiverThreadId', 'receiver_thread_id', 'newThreadId', 'new_thread_id']) {
            const id = this.getStringField(item, key);
            if (id && !ids.includes(id)) ids.push(id);
        }
        return ids;
    }

    private getStringArrayField(value: unknown, ...keys: string[]): string[] {
        if (!this.isRecord(value)) return [];
        for (const key of keys) {
            const field = value[key];
            if (Array.isArray(field)) {
                return field.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
            }
        }
        return [];
    }

    private getAgentStates(item: NonNullable<CodexItemEvent['item']>): Record<string, { status?: string; message?: string | null }> {
        const raw = this.isRecord(item.agentsStates) ? item.agentsStates : item.agents_states;
        if (!this.isRecord(raw)) return {};
        const states: Record<string, { status?: string; message?: string | null }> = {};
        for (const [id, state] of Object.entries(raw)) {
            if (!this.isRecord(state)) continue;
            states[id] = {
                ...(typeof state.status === 'string' ? { status: state.status } : {}),
                ...(typeof state.message === 'string' || state.message === null ? { message: state.message } : {}),
            };
        }
        return states;
    }

    private buildCollabAgentParameters(
        item: NonNullable<CodexItemEvent['item']>,
        receiverThreadIds: string[],
        agentStates: Record<string, { status?: string; message?: string | null }>,
    ): Record<string, unknown> {
        const firstAgentId = receiverThreadIds[0];
        const firstAgentState = firstAgentId ? agentStates[firstAgentId] : undefined;
        const senderThreadId = this.getStringField(item, 'senderThreadId', 'sender_thread_id');
        const model = this.getStringField(item, 'model');
        const reasoningEffort = this.getStringField(item, 'reasoningEffort', 'reasoning_effort');
        return {
            ...(firstAgentId ? { agent_id: firstAgentId } : {}),
            ...(receiverThreadIds.length > 0 ? { agent_ids: receiverThreadIds } : {}),
            ...(senderThreadId ? { sender_thread_id: senderThreadId } : {}),
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            ...(Object.keys(agentStates).length > 0 ? { agents_states: agentStates } : {}),
            ...(firstAgentState?.status ? { agent_status: firstAgentState.status } : {}),
            ...(firstAgentState?.message ? { agent_message: firstAgentState.message } : {}),
        };
    }

    private summarizeCollabAgentSpawn(receiverThreadIds: string[]): string {
        return receiverThreadIds.length > 0
            ? `Agent started with agent_id: ${receiverThreadIds.join(', ')}`
            : 'Agent started';
    }

    private summarizeCollabAgentResult(
        tool: string,
        receiverThreadIds: string[],
        agentStates: Record<string, { status?: string; message?: string | null }>,
    ): string | undefined {
        const stateSummary = this.summarizeAgentStates(receiverThreadIds, agentStates);
        if (stateSummary) return stateSummary;
        if (this.normalizeCodexItemType(tool) === 'spawnagent') return this.summarizeCollabAgentSpawn(receiverThreadIds);
        if (receiverThreadIds.length > 0) return `${tool} completed for ${receiverThreadIds.join(', ')}`;
        return undefined;
    }

    private summarizeAgentStates(
        receiverThreadIds: string[],
        agentStates: Record<string, { status?: string; message?: string | null }>,
    ): string | undefined {
        const ids = receiverThreadIds.length > 0 ? receiverThreadIds : Object.keys(agentStates);
        const lines = ids
            .map(id => {
                const state = agentStates[id];
                if (!state) return undefined;
                const status = state.status ?? 'unknown';
                return `${id} ${status}${state.message ? `: ${state.message}` : ''}`;
            })
            .filter((line): line is string => !!line);
        return lines.length > 0 ? lines.join('\n') : undefined;
    }

    private summarizeDynamicAgentResult(tool: 'spawnAgent' | 'wait', parameters: Record<string, unknown>): string {
        const agentId = typeof parameters.agent_id === 'string' ? parameters.agent_id : undefined;
        if (tool === 'spawnAgent') {
            return agentId ? `Agent started with agent_id: ${agentId}` : 'Agent started';
        }
        return agentId ? `Agent ${agentId} completed` : 'Agent wait completed';
    }

    private stringifyDynamicContentItems(contentItems: unknown): string | undefined {
        if (!Array.isArray(contentItems)) return undefined;
        const parts = contentItems
            .map(item => this.isRecord(item) && typeof item.text === 'string' ? item.text : undefined)
            .filter((text): text is string => !!text);
        return parts.length > 0 ? parts.join('\n') : undefined;
    }

    private toSnakeCase(value: string): string {
        return value
            .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
            .replace(/[-\s]+/g, '_')
            .toLowerCase();
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    private summarizeFileChanges(changes: Array<{ path?: string; kind?: string }>): string {
        if (changes.length === 0) return 'File changes applied';
        const byKind = new Map<string, string[]>();
        for (const change of changes) {
            const kind = typeof change.kind === 'string' ? change.kind : 'update';
            const filePath = typeof change.path === 'string' ? change.path : '(unknown)';
            byKind.set(kind, [...(byKind.get(kind) ?? []), filePath]);
        }
        return Array.from(byKind.entries())
            .map(([kind, paths]) => `${kind}: ${paths.join(', ')}`)
            .join('\n');
    }

    private stringifyCodexResult(result: unknown): string | undefined {
        if (result == null) return undefined;
        if (typeof result === 'string') return result;
        if (typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)) {
            const parts = ((result as { content: Array<{ type?: string; text?: string }> }).content)
                .map(block => typeof block.text === 'string' ? block.text : undefined)
                .filter((text): text is string => !!text);
            if (parts.length > 0) return parts.join('\n');
        }
        try {
            return JSON.stringify(result);
        } catch {
            return String(result);
        }
    }

    private buildThreadOptions(options: SendMessageOptions): CodexStartThreadOptions {
        const model = this.normalizeCodexModel(options.model);
        const additionalDirectories = this.resolveCodexAdditionalDirectories(options);
        return {
            ...(model ? { model } : {}),
            ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
            ...(additionalDirectories.length ? { additionalDirectories } : {}),
            ...(options.reasoningEffort ? { reasoningLevel: options.reasoningEffort } : {}),
            skipGitRepoCheck: true,
            ...this.resolveCodexModeOptions(),
        };
    }

    /**
     * Builds the list of directories Codex may access beyond its working
     * directory. Always includes `~/.coc` (CoC's data/skills dir) so out-of-repo
     * skill and data files are reachable, plus any caller-provided skill or
     * additional directories. Caller-provided paths are preserved verbatim;
     * `~/.coc` is only appended when not already present (compared
     * case-insensitively on Windows).
     */
    private resolveCodexAdditionalDirectories(options: SendMessageOptions): string[] {
        const dirs = [
            ...(options.skillDirectories ?? []),
            ...(options.additionalDirectories ?? []),
        ].filter((dir): dir is string => !!dir);

        const cocDir = path.join(os.homedir(), '.coc');
        const sameDir = (a: string, b: string): boolean => {
            const ra = path.resolve(a);
            const rb = path.resolve(b);
            return process.platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
        };
        if (!dirs.some(dir => sameDir(dir, cocDir))) {
            dirs.push(cocDir);
        }
        return dirs;
    }

    private resolveCodexModeOptions(): Pick<CodexStartThreadOptions, 'approvalPolicy' | 'sandboxMode' | 'networkAccessEnabled'> {
        // Ask-mode constraints are enforced by READ_ONLY_SYSTEM_MESSAGE. Codex
        // still needs a full-access sandbox so skill file reads work on hosts
        // that block workspace-write sandbox initialization.
        return {
            approvalPolicy: 'never',
            sandboxMode: 'danger-full-access',
            networkAccessEnabled: true,
        };
    }

    private normalizeCodexModel(model: string | undefined): string | undefined {
        if (!model) return undefined;
        const normalized = model.toLowerCase();
        if (normalized === 'codex-default' || normalized === 'provider-default') {
            return undefined;
        }
        // CoC per-repo defaults are shared with Copilot. Do not pass provider-
        // specific Copilot model IDs through to Codex, because ChatGPT-backed
        // Codex accounts reject them before the turn starts.
        if (normalized.startsWith('claude') || normalized.startsWith('gemini')) {
            return undefined;
        }
        return model;
    }

    public async transform(
        input: string,
        options?: TransformOptions,
    ): Promise<TransformResult> {
        const result = await this.sendMessage({
            prompt: input,
            model: options?.model,
            workingDirectory: options?.cwd,
            timeoutMs: options?.timeoutMs,
            signal: options?.signal,
            loadDefaultMcpConfig: options?.loadDefaultMcpConfig ?? false,
            onPermissionRequest: options?.onPermissionRequest ?? denyAllPermissions,
        });
        if (!result.success) {
            return {
                success: false,
                text: '',
                error: result.error ?? 'Codex transform failed',
                effectiveModel: result.effectiveModel,
                tokenUsage: result.tokenUsage,
            };
        }
        return {
            success: true,
            text: result.response ?? '',
            effectiveModel: result.effectiveModel,
            tokenUsage: result.tokenUsage,
        };
    }

    // ── Session management ────────────────────────────────────────────────────

    public async forkSession(sessionId: string): Promise<string> {
        if (this.disposed) throw new Error('CodexSDKService has been disposed');

        const avail = await this.isAvailable();
        if (!avail.available) throw new Error(avail.error ?? 'Codex SDK is not available');

        const sdk = this.sdk!;
        // sessionId IS the Codex thread ID (persisted from a previous sendMessage
        // via onSessionCreated). The Codex SDK does not expose fork semantics,
        // so return a resumable thread handle for the same persisted thread.
        const forkedThread = sdk.resumeThread(sessionId, { skipGitRepoCheck: true });
        const newThreadId = forkedThread.id ?? sessionId;
        this.sessions.set(newThreadId, {
            threadId: newThreadId,
            abortController: new AbortController(),
        });
        return newThreadId;
    }

    /**
     * History rewind/truncation is not supported by the Codex SDK (AC-02).
     * Throws the typed {@link RewindUnsupportedError} so the backend can surface
     * a "rewind unsupported" rejection to the user.
     */
    public async rewindSession(_sessionId: string, _eventId: string): Promise<RewindResult> {
        throw new RewindUnsupportedError(CODEX_PROVIDER);
    }

    /**
     * History compaction is not supported by the Codex SDK (AC-03). Throws the
     * typed {@link CompactUnsupportedError} so the backend can surface a
     * "compaction unsupported" rejection to the user, mirroring
     * {@link rewindSession}.
     */
    public async compactSession(_sessionId: string, _customInstructions?: string): Promise<CompactResult> {
        throw new CompactUnsupportedError(CODEX_PROVIDER);
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
        // Stop every warm client so no provider client outlives the service.
        await this.warmRegistry.evictAll();
        // Drop warm-status subscribers so no bridge holds a stale service reference.
        this.warmStatus.clear();
        this.availabilityCache = null;
        this.sdk = null;
        this.codexCtor = null;
    }

    public dispose(): void {
        this.disposed = true;
        this.cleanup().catch(() => {});
    }
}

// ============================================================================
// Mapping helpers (testable without spawning a process)
// ============================================================================

function emptyCodexTokenUsage(): TokenUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        turnCount: 0,
    };
}

function codexUsageNumber(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Accumulate a Codex per-turn `Usage` into the shared `TokenUsage` envelope.
 *
 * The per-turn totals (input/output/cache/total) accumulate across turns. The
 * context meter is derived instead of accumulated:
 *   - `tokenLimit` = the model's static `contextWindow` from `MODEL_REGISTRY`
 *     (via `getModelContextWindow`). Left unset for models the registry does not
 *     know, so the indicator stays hidden rather than guessing a default.
 *   - `currentTokens` = a latest-turn occupancy snapshot, `input_tokens +
 *     output_tokens` of THIS turn (not a cumulative sum). `cached_input_tokens`
 *     is already a subset of `input_tokens`, so it is not added again; reasoning
 *     tokens are excluded because they do not persist in context across turns.
 *     Overwriting each turn means the newest snapshot wins, and Codex
 *     auto-compaction is handled naturally (the post-compaction turn reports the
 *     smaller context).
 *
 * `currentTokens`/`tokenLimit` are only set together, and only when the model is
 * known — an unknown model leaves the whole context meter unset. The breakdown
 * fields (`systemTokens`, `toolDefinitionsTokens`, `conversationTokens`) are
 * never populated: Codex provides no breakdown and none is fabricated.
 */
function addCodexUsage(
    current: TokenUsage | undefined,
    usage: CodexUsage | undefined,
    modelId?: string,
): TokenUsage | undefined {
    if (!usage) return current;

    const result = current ? { ...current } : emptyCodexTokenUsage();
    result.inputTokens += codexUsageNumber(usage.input_tokens);
    result.outputTokens += codexUsageNumber(usage.output_tokens);
    result.cacheReadTokens += codexUsageNumber(usage.cached_input_tokens);
    result.totalTokens = result.inputTokens + result.outputTokens;
    result.turnCount += 1;

    const tokenLimit = modelId ? getModelContextWindow(modelId) : undefined;
    if (tokenLimit != null) {
        result.tokenLimit = tokenLimit;
        result.currentTokens = codexUsageNumber(usage.input_tokens) + codexUsageNumber(usage.output_tokens);
    }
    return result;
}

/**
 * Map a Codex rate limits RPC response to the IAccountQuotaResult format.
 *
 * Each Codex limit entry carries two rolling windows: `primary` (the ~5-hour
 * window) and `secondary` (the weekly window). Both are surfaced as separate
 * snapshots keyed `five_hour` / `seven_day` so the dashboard renders them with
 * the same "5h" / "Weekly" labels as Claude. When usage is broken out across
 * multiple limit ids the window keys are prefixed with the limit id to keep
 * them distinct. A window is skipped when the upstream omits it (Codex may
 * return a `null` secondary).
 */
export function mapCodexRateLimitsToQuota(result: CodexRateLimitsResult): IAccountQuotaResult {
    const snapshots: Record<string, IAccountQuotaSnapshot> = {};
    const entries = result.rateLimitsByLimitId
        ? Object.entries(result.rateLimitsByLimitId)
        : [[result.rateLimits.limitId || 'codex', result.rateLimits] as const];

    const prefixWithLimitId = entries.length > 1;

    for (const [limitId, entry] of entries) {
        const prefix = prefixWithLimitId ? `${limitId}_` : '';
        addCodexWindowSnapshot(snapshots, `${prefix}five_hour`, entry, entry.primary);
        addCodexWindowSnapshot(snapshots, `${prefix}seven_day`, entry, entry.secondary);
    }

    return { quotaSnapshots: snapshots };
}

/**
 * Add one quota snapshot for a single Codex rate-limit window. No-ops when the
 * window is absent or carries a non-numeric `usedPercent`, so a missing weekly
 * window simply yields no `seven_day` snapshot rather than a bogus full bar.
 */
function addCodexWindowSnapshot(
    snapshots: Record<string, IAccountQuotaSnapshot>,
    key: string,
    entry: CodexRateLimitEntry,
    window: CodexRateLimitWindow | null | undefined,
): void {
    if (!window || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent)) {
        return;
    }

    const remaining = Math.max(0, Math.min(1, (100 - window.usedPercent) / 100));
    const resetDate = window.resetsAt
        ? new Date(window.resetsAt * 1000).toISOString()
        : undefined;

    snapshots[key] = {
        isUnlimitedEntitlement: entry.credits?.unlimited ?? false,
        entitlementRequests: 100,
        usedRequests: window.usedPercent,
        remainingPercentage: remaining,
        usageAllowedWithExhaustedQuota: entry.credits?.hasCredits ?? false,
        overage: 0,
        ...(resetDate ? { resetDate } : {}),
    };
}

// ============================================================================
// Registration helper
// ============================================================================

/**
 * Register a new `CodexSDKService` instance under `'codex'` in the module-
 * level `sdkServiceRegistry`. CoC registers this at server startup so live
 * config can enable Codex without recreating server infrastructure.
 *
 * @param authChecker Optional host-provided auth checker. When provided,
 *   sendMessage gates on auth status before loading the Codex SDK.
 * @returns The newly created service instance.
 */
export function registerCodexSDKService(authChecker?: CodexAuthChecker): CodexSDKService {
    const svc = new CodexSDKService();
    if (authChecker) svc.setAuthChecker(authChecker);
    sdkServiceRegistry.register(CODEX_PROVIDER, svc);
    return svc;
}
