/**
 * coc-llm-tools-mcp — standalone stdio MCP bridge for CoC LLM tools.
 *
 * Spawned as a child process by a provider's MCP client (Codex CLI, Claude Code).
 * Speaks the MCP stdio protocol (newline-delimited JSON-RPC 2.0 on stdin/stdout,
 * logs on stderr) and proxies `tools/list` / `tools/call` to the parent CoC
 * process's {@link CocToolBridgeServer} loopback endpoint identified by env vars
 * `COC_LLM_TOOLS_ENDPOINT` and `COC_LLM_TOOLS_TOKEN`.
 *
 * The handler logic ({@link createBridgeHandlers}) is decoupled from stdio/HTTP so
 * it can be unit-tested with an injected transport. `tools/call` is awaited with no
 * client-side timeout, so blocking tools (`ask_user`) resolve only when the parent
 * runtime resolves.
 */

import * as http from 'http';
import { COC_LLM_TOOLS_ENDPOINT_ENV, COC_LLM_TOOLS_TOKEN_ENV } from './mcp-config';

const BRIDGE_NAME = 'coc-llm-tools';
const BRIDGE_VERSION = '0.1.0';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

// ── JSON-RPC message shapes ──────────────────────────────────────────────────

interface JsonRpcMessage {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: Record<string, unknown>;
    [key: string]: unknown;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number | null;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

/** POSTs a JSON payload to the parent and resolves the parsed JSON response. */
export type BridgeTransport = (path: '/list' | '/call', body: unknown) => Promise<unknown>;

export interface BridgeHandlerOptions {
    transport: BridgeTransport;
    name?: string;
    version?: string;
}

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/**
 * Build the JSON-RPC message handler for the bridge.
 *
 * `handleMessage` returns the JSON-RPC response to write back, or `null` for
 * notifications (messages without an `id`) which must not be answered.
 */
export function createBridgeHandlers(options: BridgeHandlerOptions) {
    const name = options.name ?? BRIDGE_NAME;
    const version = options.version ?? BRIDGE_VERSION;

    async function handleMessage(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
        const id = message.id ?? null;
        const isNotification = message.id === undefined || message.id === null;
        const method = message.method;

        // Notifications (no id) are acknowledged by silence.
        if (isNotification) {
            return null;
        }

        try {
            switch (method) {
                case 'initialize': {
                    const requested = typeof message.params?.protocolVersion === 'string'
                        ? message.params.protocolVersion
                        : DEFAULT_PROTOCOL_VERSION;
                    return ok(id, {
                        protocolVersion: requested,
                        capabilities: { tools: {} },
                        serverInfo: { name, version },
                    });
                }
                case 'ping':
                    return ok(id, {});
                case 'tools/list': {
                    const response = await options.transport('/list', {}) as { tools?: unknown };
                    return ok(id, { tools: Array.isArray(response?.tools) ? response.tools : [] });
                }
                case 'tools/call': {
                    const toolName = typeof message.params?.name === 'string' ? message.params.name : '';
                    if (!toolName) {
                        return fail(id, INTERNAL_ERROR, 'tools/call missing tool name');
                    }
                    const args = (message.params?.arguments && typeof message.params.arguments === 'object')
                        ? message.params.arguments
                        : {};
                    const result = await options.transport('/call', { name: toolName, arguments: args });
                    return ok(id, normalizeCallResult(result));
                }
                default:
                    return fail(id, METHOD_NOT_FOUND, `Method not found: ${method ?? '(none)'}`);
            }
        } catch (err) {
            const messageText = err instanceof Error ? err.message : String(err);
            // For tool calls, surface transport failures to the model as an error
            // result rather than a protocol error so the turn can continue.
            if (method === 'tools/call') {
                return ok(id, {
                    content: [{ type: 'text', text: `coc-llm-tools bridge error: ${messageText}` }],
                    isError: true,
                });
            }
            return fail(id, INTERNAL_ERROR, messageText);
        }
    }

    return { handleMessage };
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number | null, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Coerce a parent `/call` response into a valid MCP CallToolResult. */
function normalizeCallResult(result: unknown): { content: unknown[]; isError: boolean } {
    if (result && typeof result === 'object' && Array.isArray((result as { content?: unknown }).content)) {
        const r = result as { content: unknown[]; isError?: unknown };
        return { content: r.content, isError: r.isError === true };
    }
    return {
        content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result ?? '') }],
        isError: false,
    };
}

// ============================================================================
// Real HTTP transport (parent loopback)
// ============================================================================

/** Build the HTTP transport that talks to the parent {@link CocToolBridgeServer}. */
export function createHttpTransport(endpoint: string, token: string): BridgeTransport {
    const base = new URL(endpoint);
    return (path, body) => new Promise<unknown>((resolve, reject) => {
        const payload = Buffer.from(JSON.stringify(body ?? {}), 'utf8');
        const req = http.request(
            {
                hostname: base.hostname,
                port: base.port,
                path,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': payload.length,
                    authorization: `Bearer ${token}`,
                },
                // No timeout: blocking tools (ask_user) may take arbitrarily long.
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    if ((res.statusCode ?? 0) >= 400) {
                        reject(new Error(`Bridge endpoint ${path} returned ${res.statusCode}: ${text}`));
                        return;
                    }
                    try {
                        resolve(text ? JSON.parse(text) : {});
                    } catch (err) {
                        reject(err instanceof Error ? err : new Error(String(err)));
                    }
                });
            },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

// ============================================================================
// stdio main loop
// ============================================================================

/**
 * Run the bridge against the given stdin/stdout streams. Reads newline-delimited
 * JSON-RPC messages, dispatches them concurrently (so a blocking `tools/call`
 * never stalls other messages), and writes each response as a single line.
 */
export function runBridge(options: {
    transport: BridgeTransport;
    stdin: NodeJS.ReadableStream;
    stdout: NodeJS.WritableStream;
    onError?: (err: unknown) => void;
}): void {
    const { handleMessage } = createBridgeHandlers({ transport: options.transport });
    let buffer = '';

    const writeResponse = (response: JsonRpcResponse | null) => {
        if (!response) return;
        options.stdout.write(JSON.stringify(response) + '\n');
    };

    const dispatchLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        let message: JsonRpcMessage;
        try {
            message = JSON.parse(trimmed) as JsonRpcMessage;
        } catch (err) {
            options.onError?.(err);
            return;
        }
        handleMessage(message).then(writeResponse).catch((err) => options.onError?.(err));
    };

    options.stdin.setEncoding('utf8');
    options.stdin.on('data', (chunk: string) => {
        buffer += chunk;
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            dispatchLine(line);
            newlineIndex = buffer.indexOf('\n');
        }
    });
    options.stdin.on('end', () => {
        if (buffer.trim()) dispatchLine(buffer);
    });
}

/** Entry point when run as a child process. */
function main(): void {
    const endpoint = process.env[COC_LLM_TOOLS_ENDPOINT_ENV];
    const token = process.env[COC_LLM_TOOLS_TOKEN_ENV];
    if (!endpoint || !token) {
        process.stderr.write(
            `[coc-llm-tools] missing ${COC_LLM_TOOLS_ENDPOINT_ENV}/${COC_LLM_TOOLS_TOKEN_ENV}; exiting\n`,
        );
        process.exit(1);
        return;
    }
    runBridge({
        transport: createHttpTransport(endpoint, token),
        stdin: process.stdin,
        stdout: process.stdout,
        onError: (err) => {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[coc-llm-tools] ${message}\n`);
        },
    });
}

// Only run the stdio loop when executed directly (not when imported by tests).
if (require.main === module) {
    main();
}
