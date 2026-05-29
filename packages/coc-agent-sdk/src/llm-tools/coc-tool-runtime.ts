/**
 * CocToolRuntime — provider-neutral CoC LLM-tool runtime.
 *
 * Adapts the existing Copilot SDK-native `Tool<any>[]` bundle (assembled by
 * `buildChatToolBundle()` / `applyLlmToolPreferences()` in the coc package) into
 * a provider-neutral internal shape so the same tools can be exposed to Codex
 * and Claude through MCP, not just to Copilot through native `SendMessageOptions.tools`.
 *
 * Design constraints (mirrors the CoC LLM-tool invariants):
 * - **Per-invocation:** Construct one runtime per AI call from that call's
 *   already-filtered tool bundle. The runtime never caches across requests.
 * - **Pre-bound context:** CoC tool factories bake workspace/commit/process
 *   context into their handler closures at creation time. The runtime invokes
 *   those exact closures, so calls automatically run with the correct
 *   workspace/process context — the runtime only supplies the per-call
 *   `ToolInvocation` envelope (session id, tool-call id, arguments).
 * - **Filtering is upstream:** The runtime exposes exactly the tools it is
 *   given. Enable/disable filtering already happened in the coc package via
 *   `applyLlmToolPreferences()`, so `listTools()` reflecting the input array is
 *   equivalent to "only enabled tools are exposed".
 * - **No event emission here:** Tool lifecycle events (`onToolEvent`) are
 *   emitted by each provider from its own message stream (Copilot natively,
 *   Codex from `mcp_tool_call` items, Claude from `tool_use` blocks). The
 *   runtime only *executes* handlers, so wiring it into a provider does not
 *   double-emit timeline/capture events.
 */

import * as crypto from 'crypto';
import type { Tool, ToolInvocation, ToolResultObject } from '../types';

// ============================================================================
// Public types
// ============================================================================

/**
 * Provider-neutral description of a single tool, suitable for an MCP
 * `tools/list` response or any other tool-advertisement surface.
 */
export interface RuntimeToolDescriptor {
    /** Tool name (e.g. `ask_user`). */
    name: string;
    /** Human-readable description shown to the model. */
    description: string;
    /** JSON Schema describing the tool's arguments (always an object schema). */
    inputSchema: Record<string, unknown>;
}

/** A single text content block in a normalized tool result. */
export interface RuntimeToolResultContent {
    type: 'text';
    text: string;
}

/**
 * Normalized tool-call result, shaped like an MCP `CallToolResult` so it can be
 * returned directly from an MCP bridge without further transformation.
 */
export interface RuntimeToolResult {
    content: RuntimeToolResultContent[];
    /** True when the tool failed (handler threw or returned a failure result). */
    isError: boolean;
}

/**
 * Per-invocation context propagated into each synthesized `ToolInvocation`.
 * All fields are optional; CoC tool handlers generally pre-bind the context
 * they need, so these are primarily for logging and the invocation envelope.
 */
export interface CocToolRuntimeContext {
    /** AI session id for this turn, if known. */
    sessionId?: string;
    /** Workspace id this turn is scoped to, if known. */
    workspaceId?: string;
    /** Process id (AIProcess) this turn belongs to, if known. */
    processId?: string;
}

// ============================================================================
// CocToolRuntime
// ============================================================================

/**
 * Provider-neutral runtime over a per-invocation CoC tool bundle.
 *
 * @example
 * ```ts
 * const runtime = new CocToolRuntime(ctx.tools, { sessionId, workspaceId, processId });
 * const descriptors = runtime.listTools();           // → MCP tools/list
 * const result = await runtime.callTool('ask_user', args); // → MCP tools/call
 * runtime.dispose();
 * ```
 */
export class CocToolRuntime {
    private readonly toolsByName = new Map<string, Tool<any>>();
    private readonly context: CocToolRuntimeContext;
    private disposed = false;

    constructor(tools: ReadonlyArray<Tool<any>>, context: CocToolRuntimeContext = {}) {
        this.context = context;
        for (const tool of tools) {
            if (!tool || typeof tool.name !== 'string' || !tool.name) continue;
            // Last definition wins on duplicate names, mirroring how the SDK
            // would resolve a duplicate tool registration.
            this.toolsByName.set(tool.name, tool);
        }
    }

    /** Number of tools exposed by this runtime. */
    public get size(): number {
        return this.toolsByName.size;
    }

    /** Returns true when a tool with the given name is exposed. */
    public hasTool(name: string): boolean {
        return this.toolsByName.has(name);
    }

    /**
     * Provider-neutral tool descriptors for advertisement (e.g. MCP tools/list).
     * Reflects exactly the (already-filtered) tools the runtime was constructed
     * with, so only enabled tools are ever exposed.
     */
    public listTools(): RuntimeToolDescriptor[] {
        return Array.from(this.toolsByName.values()).map(tool => ({
            name: tool.name,
            description: tool.description ?? '',
            inputSchema: resolveInputSchema(tool),
        }));
    }

    /**
     * Execute a tool by name with the given arguments, returning a normalized
     * MCP-style result. Never throws — handler errors are captured into an
     * `isError: true` result so an MCP bridge can relay them to the model.
     *
     * Blocking handlers (e.g. `ask_user`) are awaited as-is: because the runtime
     * runs the original in-process closure, the handler's Promise resolves when
     * the SPA submits an answer, exactly as on the native Copilot path.
     */
    public async callTool(name: string, args: unknown): Promise<RuntimeToolResult> {
        if (this.disposed) {
            return errorResult(`CocToolRuntime has been disposed; cannot call tool "${name}"`);
        }

        const tool = this.toolsByName.get(name);
        if (!tool) {
            return errorResult(`Unknown tool: ${name}`);
        }

        const invocation: ToolInvocation = {
            sessionId: this.context.sessionId ?? '',
            toolCallId: crypto.randomUUID(),
            toolName: name,
            arguments: args,
        };

        try {
            const raw = await tool.handler(args as never, invocation);
            return normalizeToolResult(raw);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return errorResult(message);
        }
    }

    /**
     * Release the runtime. After disposal `callTool` returns an error result and
     * `listTools` returns an empty list. Safe to call multiple times.
     */
    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.toolsByName.clear();
    }
}

// ============================================================================
// Helpers (exported for unit testing)
// ============================================================================

/**
 * Resolve a tool's `parameters` into a JSON Schema object suitable for MCP.
 *
 * Handles all three shapes allowed by the SDK `Tool` type:
 * - A Zod-like schema exposing `toJSONSchema()` → call it.
 * - A raw JSON Schema object → use as-is.
 * - Omitted → empty object schema.
 *
 * The result is always normalized to a top-level object schema so MCP clients
 * (which require `type: "object"`) accept it.
 */
export function resolveInputSchema(tool: Pick<Tool<any>, 'parameters'>): Record<string, unknown> {
    const params = tool.parameters as unknown;

    let schema: Record<string, unknown>;
    if (params && typeof params === 'object' && typeof (params as { toJSONSchema?: unknown }).toJSONSchema === 'function') {
        try {
            const generated = (params as { toJSONSchema: () => Record<string, unknown> }).toJSONSchema();
            schema = generated && typeof generated === 'object' ? { ...generated } : {};
        } catch {
            schema = {};
        }
    } else if (params && typeof params === 'object') {
        schema = { ...(params as Record<string, unknown>) };
    } else {
        schema = {};
    }

    // MCP requires an object schema at the top level.
    if (schema.type !== 'object') {
        schema.type = 'object';
    }
    if (typeof schema.properties !== 'object' || schema.properties === null) {
        schema.properties = {};
    }
    return schema;
}

/**
 * Normalize an arbitrary tool-handler return value into a `RuntimeToolResult`.
 *
 * - `string` → single text block.
 * - `ToolResultObject` (`{ textResultForLlm, resultType, error }`) → text from
 *   `textResultForLlm`, `isError` derived from `resultType`/`error`.
 * - `null` / `undefined` → empty success result.
 * - Anything else (objects, arrays — e.g. `ask_user`'s `AskUserResponse[]`) →
 *   JSON-stringified text block.
 */
export function normalizeToolResult(value: unknown): RuntimeToolResult {
    if (value === null || value === undefined) {
        return { content: [{ type: 'text', text: '' }], isError: false };
    }

    if (typeof value === 'string') {
        return { content: [{ type: 'text', text: value }], isError: false };
    }

    if (isToolResultObject(value)) {
        const isError = isErrorResultType(value.resultType) || typeof value.error === 'string';
        const text = value.textResultForLlm ?? value.error ?? '';
        return { content: [{ type: 'text', text }], isError };
    }

    return { content: [{ type: 'text', text: safeStringify(value) }], isError: false };
}

/** Build a failure result carrying a single error message. */
export function errorResult(message: string): RuntimeToolResult {
    return { content: [{ type: 'text', text: message }], isError: true };
}

function isToolResultObject(value: unknown): value is ToolResultObject {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as ToolResultObject).textResultForLlm === 'string' &&
        typeof (value as ToolResultObject).resultType === 'string'
    );
}

function isErrorResultType(resultType: string): boolean {
    return resultType === 'failure' || resultType === 'rejected' || resultType === 'denied' || resultType === 'timeout';
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}
