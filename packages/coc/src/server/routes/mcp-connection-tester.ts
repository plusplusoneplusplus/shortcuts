/**
 * MCP Connection Tester
 *
 * Spawns a temporary MCP server process (stdio) or checks HTTP/SSE reachability,
 * sends a JSON-RPC `initialize` handshake, and returns success/error.
 *
 * Timeout: 10 seconds. Process is always killed after the test.
 */

import { spawn } from 'child_process';
import * as http from 'http';
import * as https from 'https';

// ============================================================================
// Types
// ============================================================================

export interface McpTestRequest {
    type: 'stdio' | 'http' | 'sse';
    command?: string;
    url?: string;
    args?: string[];
    env?: Record<string, string>;
    /** Optional HTTP headers for http/sse transports (e.g. auth). */
    headers?: Record<string, string>;
}

export interface McpTestResult {
    success: boolean;
    message: string;
    /** Server's declared protocolVersion, if returned (stdio only). */
    protocolVersion?: string;
    /** Server's declared name, if returned (stdio only). */
    serverName?: string;
}

/** A single tool as reported by an MCP server's `tools/list`. */
export interface McpToolInfo {
    name: string;
    description?: string;
    /** JSON Schema describing the tool's input (display-only). */
    inputSchema?: unknown;
}

/** Result of a live `tools/list` discovery against one MCP server. */
export interface McpListToolsResult {
    success: boolean;
    message: string;
    tools: McpToolInfo[];
    /** Server's declared protocolVersion, if returned. */
    protocolVersion?: string;
    /** Server's declared name, if returned. */
    serverName?: string;
}

// ============================================================================
// Public entry point
// ============================================================================

const TEST_TIMEOUT_MS = 10_000;

/**
 * Test connectivity to an MCP server.
 * - stdio: spawns the process, sends `initialize`, awaits response
 * - http/sse: sends an HTTP GET to the URL
 */
export async function testMcpConnection(req: McpTestRequest): Promise<McpTestResult> {
    if (req.type === 'stdio') {
        return testStdioMcpServer(req);
    }
    return testHttpMcpServer(req);
}

// ============================================================================
// stdio transport
// ============================================================================

function testStdioMcpServer(req: McpTestRequest): Promise<McpTestResult> {
    return new Promise((resolve) => {
        const command = req.command;
        if (!command) {
            resolve({ success: false, message: '`command` is required for stdio transport' });
            return;
        }

        const args = req.args ?? [];
        const mergedEnv = { ...process.env, ...(req.env ?? {}) };

        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(command, args, {
                env: mergedEnv,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            resolve({ success: false, message: `Failed to spawn process: ${msg}` });
            return;
        }

        let settled = false;
        let stdout = '';

        const done = (result: McpTestResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            resolve(result);
        };

        const timer = setTimeout(() => {
            done({ success: false, message: 'Timed out waiting for MCP initialize response (10 s)' });
        }, TEST_TIMEOUT_MS);

        child.on('error', (err) => {
            done({ success: false, message: `Process error: ${err.message}` });
        });

        child.on('close', (code) => {
            if (!settled) {
                done({ success: false, message: `Process exited with code ${code} before responding` });
            }
        });

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
            // Each MCP message is a JSON object on its own line (newline-delimited JSON-RPC)
            const lines = stdout.split('\n');
            // Keep the last incomplete line in the buffer
            stdout = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                tryParseRpcResponse(trimmed, done);
            }
        });

        // Send JSON-RPC `initialize`
        const initMsg = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'coc-test', version: '1.0.0' },
            },
        }) + '\n';

        try {
            child.stdin?.write(initMsg);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            done({ success: false, message: `Failed to write to process stdin: ${msg}` });
        }
    });
}

function tryParseRpcResponse(
    line: string,
    done: (result: McpTestResult) => void,
): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(line);
    } catch {
        // Not JSON — ignore
        return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;

    const obj = parsed as Record<string, unknown>;
    // Must be a JSON-RPC 2.0 response to our request id=1
    if (obj.jsonrpc !== '2.0' || obj.id !== 1) return;

    if ('error' in obj) {
        const errObj = obj.error as Record<string, unknown> | null | undefined;
        const errMsg = typeof errObj?.message === 'string' ? errObj.message : JSON.stringify(errObj);
        done({ success: false, message: `MCP server returned error: ${errMsg}` });
        return;
    }

    if ('result' in obj) {
        const result = obj.result as Record<string, unknown> | null | undefined;
        const protoVersion = typeof result?.protocolVersion === 'string' ? result.protocolVersion : undefined;
        const serverInfo = result?.serverInfo as Record<string, unknown> | undefined;
        const serverName = typeof serverInfo?.name === 'string' ? serverInfo.name : undefined;
        done({
            success: true,
            message: 'MCP server responded successfully',
            ...(protoVersion ? { protocolVersion: protoVersion } : {}),
            ...(serverName ? { serverName } : {}),
        });
    }
}

// ============================================================================
// HTTP / SSE transport
// ============================================================================

function testHttpMcpServer(req: McpTestRequest): Promise<McpTestResult> {
    return new Promise((resolve) => {
        const rawUrl = req.url;
        if (!rawUrl) {
            resolve({ success: false, message: '`url` is required for http/sse transport' });
            return;
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(rawUrl);
        } catch {
            resolve({ success: false, message: `Invalid URL: ${rawUrl}` });
            return;
        }

        const transport = parsedUrl.protocol === 'https:' ? https : http;
        let settled = false;

        const done = (result: McpTestResult) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };

        const timer = setTimeout(() => {
            done({ success: false, message: 'HTTP connection timed out (10 s)' });
        }, TEST_TIMEOUT_MS);

        const options: http.RequestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'GET',
            headers: { 'Accept': 'application/json, text/event-stream' },
            timeout: TEST_TIMEOUT_MS,
        };

        const clientReq = transport.request(options, (incomingRes) => {
            // Accept any 2xx or 4xx (reachable but may require auth)
            clearTimeout(timer);
            const status = incomingRes.statusCode ?? 0;
            if (status >= 200 && status < 500) {
                done({
                    success: true,
                    message: `Server responded with HTTP ${status}`,
                });
            } else {
                done({
                    success: false,
                    message: `Server responded with HTTP ${status}`,
                });
            }
            incomingRes.resume(); // drain
        });

        clientReq.on('error', (err) => {
            clearTimeout(timer);
            done({ success: false, message: `Connection failed: ${err.message}` });
        });

        clientReq.on('timeout', () => {
            clientReq.destroy();
            done({ success: false, message: 'HTTP connection timed out (10 s)' });
        });

        clientReq.end();
    });
}

// ============================================================================
// Live tool discovery (`tools/list`)
// ============================================================================

/** Default per-server timeout for a full `initialize` + `tools/list` handshake. */
const LIST_TOOLS_TIMEOUT_MS = 10_000;

/**
 * Connect to an MCP server and list its tools.
 * - stdio: spawns the process, performs the `initialize` handshake, sends the
 *   `notifications/initialized` notification, then issues `tools/list`.
 * - http/sse: performs the same JSON-RPC handshake over Streamable HTTP POSTs,
 *   honoring any `Mcp-Session-Id` the server assigns at initialize time.
 *
 * The process (stdio) is always killed after the call. Errors are returned as
 * `{ success: false, message, tools: [] }` rather than thrown so callers can
 * isolate per-server failures.
 */
export async function listMcpTools(
    req: McpTestRequest,
    timeoutMs: number = LIST_TOOLS_TIMEOUT_MS,
): Promise<McpListToolsResult> {
    if (req.type === 'stdio') {
        return listStdioMcpTools(req, timeoutMs);
    }
    return listHttpMcpTools(req, timeoutMs);
}

/** Normalize a raw MCP tool object into `McpToolInfo`, or `null` if invalid. */
function normalizeToolEntry(raw: unknown): McpToolInfo | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name !== 'string' || !obj.name) return null;
    const tool: McpToolInfo = { name: obj.name };
    if (typeof obj.description === 'string') tool.description = obj.description;
    if (obj.inputSchema !== undefined) tool.inputSchema = obj.inputSchema;
    return tool;
}

const INITIALIZE_PARAMS = {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'coc-discovery', version: '1.0.0' },
};

// ----------------------------------------------------------------------------
// stdio transport
// ----------------------------------------------------------------------------

function listStdioMcpTools(req: McpTestRequest, timeoutMs: number): Promise<McpListToolsResult> {
    return new Promise((resolve) => {
        const command = req.command;
        if (!command) {
            resolve({ success: false, message: '`command` is required for stdio transport', tools: [] });
            return;
        }

        const args = req.args ?? [];
        const mergedEnv = { ...process.env, ...(req.env ?? {}) };

        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(command, args, {
                env: mergedEnv,
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: false,
            });
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            resolve({ success: false, message: `Failed to spawn process: ${msg}`, tools: [] });
            return;
        }

        let settled = false;
        let stdout = '';
        let protocolVersion: string | undefined;
        let serverName: string | undefined;

        const done = (result: McpListToolsResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { child.kill('SIGKILL'); } catch { /* ignore */ }
            resolve(result);
        };
        const fail = (message: string) => done({ success: false, message, tools: [] });

        const timer = setTimeout(() => {
            fail(`Timed out waiting for MCP tools/list response (${Math.round(timeoutMs / 1000)} s)`);
        }, timeoutMs);

        const send = (obj: unknown) => {
            try {
                child.stdin?.write(JSON.stringify(obj) + '\n');
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                fail(`Failed to write to process stdin: ${msg}`);
            }
        };

        child.on('error', (err) => fail(`Process error: ${err.message}`));
        child.on('close', (code) => {
            if (!settled) fail(`Process exited with code ${code} before responding`);
        });

        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString('utf-8');
            const lines = stdout.split('\n');
            stdout = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let parsed: unknown;
                try { parsed = JSON.parse(trimmed); } catch { continue; }
                if (typeof parsed !== 'object' || parsed === null) continue;
                const obj = parsed as Record<string, unknown>;
                if (obj.jsonrpc !== '2.0') continue;

                if (obj.id === 1) {
                    if ('error' in obj) {
                        fail(`MCP server returned error during initialize: ${describeRpcError(obj.error)}`);
                        return;
                    }
                    const result = obj.result as Record<string, unknown> | undefined;
                    if (typeof result?.protocolVersion === 'string') protocolVersion = result.protocolVersion;
                    const serverInfo = result?.serverInfo as Record<string, unknown> | undefined;
                    if (typeof serverInfo?.name === 'string') serverName = serverInfo.name;
                    // Complete the handshake, then ask for the tool list.
                    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
                    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
                } else if (obj.id === 2) {
                    if ('error' in obj) {
                        fail(`MCP server returned error listing tools: ${describeRpcError(obj.error)}`);
                        return;
                    }
                    const result = obj.result as Record<string, unknown> | undefined;
                    const rawTools = Array.isArray(result?.tools) ? result.tools : [];
                    const tools = rawTools.map(normalizeToolEntry).filter((t): t is McpToolInfo => t !== null);
                    done({
                        success: true,
                        message: `Discovered ${tools.length} tool(s)`,
                        tools,
                        ...(protocolVersion ? { protocolVersion } : {}),
                        ...(serverName ? { serverName } : {}),
                    });
                }
            }
        });

        send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: INITIALIZE_PARAMS });
    });
}

function describeRpcError(error: unknown): string {
    const errObj = error as Record<string, unknown> | null | undefined;
    return typeof errObj?.message === 'string' ? errObj.message : JSON.stringify(errObj);
}

// ----------------------------------------------------------------------------
// HTTP / SSE transport (Streamable HTTP)
// ----------------------------------------------------------------------------

interface JsonRpcPostResult {
    statusCode: number;
    sessionId?: string;
    messages: Array<Record<string, unknown>>;
}

/** Parse newline/blank-delimited SSE `data:` lines into JSON-RPC message objects. */
function parseSseMessages(raw: string): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];
    const blocks = raw.split(/\r?\n\r?\n/);
    for (const block of blocks) {
        const dataLines = block
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).replace(/^ /, ''));
        if (dataLines.length === 0) continue;
        try {
            const parsed = JSON.parse(dataLines.join('\n'));
            if (Array.isArray(parsed)) {
                for (const m of parsed) if (m && typeof m === 'object') messages.push(m as Record<string, unknown>);
            } else if (parsed && typeof parsed === 'object') {
                messages.push(parsed as Record<string, unknown>);
            }
        } catch { /* ignore malformed event */ }
    }
    return messages;
}

function postMcpJsonRpc(
    parsedUrl: URL,
    transport: typeof http | typeof https,
    body: unknown,
    extraHeaders: Record<string, string>,
    timeoutMs: number,
): Promise<JsonRpcPostResult> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const options: http.RequestOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? '443' : '80'),
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Content-Length': Buffer.byteLength(payload),
                ...extraHeaders,
            },
            timeout: timeoutMs,
        };

        const clientReq = transport.request(options, (incomingRes) => {
            let data = '';
            incomingRes.on('data', (chunk: Buffer) => { data += chunk.toString('utf-8'); });
            incomingRes.on('end', () => {
                const contentType = String(incomingRes.headers['content-type'] ?? '');
                const sessionHeader = incomingRes.headers['mcp-session-id'];
                let messages: Array<Record<string, unknown>> = [];
                if (contentType.includes('text/event-stream')) {
                    messages = parseSseMessages(data);
                } else if (data.trim()) {
                    try {
                        const parsed = JSON.parse(data);
                        if (Array.isArray(parsed)) {
                            messages = parsed.filter((m) => m && typeof m === 'object');
                        } else if (parsed && typeof parsed === 'object') {
                            messages = [parsed];
                        }
                    } catch { /* ignore non-JSON body */ }
                }
                resolve({
                    statusCode: incomingRes.statusCode ?? 0,
                    sessionId: typeof sessionHeader === 'string' ? sessionHeader : undefined,
                    messages,
                });
            });
        });

        clientReq.on('error', (err) => reject(err));
        clientReq.on('timeout', () => {
            clientReq.destroy();
            reject(new Error(`HTTP connection timed out (${Math.round(timeoutMs / 1000)} s)`));
        });
        clientReq.write(payload);
        clientReq.end();
    });
}

async function listHttpMcpTools(req: McpTestRequest, timeoutMs: number): Promise<McpListToolsResult> {
    const rawUrl = req.url;
    if (!rawUrl) {
        return { success: false, message: '`url` is required for http/sse transport', tools: [] };
    }
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(rawUrl);
    } catch {
        return { success: false, message: `Invalid URL: ${rawUrl}`, tools: [] };
    }

    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const baseHeaders = req.headers ?? {};

    try {
        const initRes = await postMcpJsonRpc(
            parsedUrl,
            transport,
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: INITIALIZE_PARAMS },
            baseHeaders,
            timeoutMs,
        );
        if (initRes.statusCode >= 400) {
            return { success: false, message: `Server responded with HTTP ${initRes.statusCode} during initialize`, tools: [] };
        }
        const initMsg = initRes.messages.find((m) => m.id === 1);
        if (initMsg && 'error' in initMsg) {
            return { success: false, message: `MCP server returned error during initialize: ${describeRpcError(initMsg.error)}`, tools: [] };
        }
        const initResult = initMsg?.result as Record<string, unknown> | undefined;
        const protocolVersion = typeof initResult?.protocolVersion === 'string' ? initResult.protocolVersion : undefined;
        const serverInfo = initResult?.serverInfo as Record<string, unknown> | undefined;
        const serverName = typeof serverInfo?.name === 'string' ? serverInfo.name : undefined;

        const sessionHeaders = initRes.sessionId
            ? { ...baseHeaders, 'Mcp-Session-Id': initRes.sessionId }
            : baseHeaders;

        // Best-effort handshake completion; some servers require it before tools/list.
        try {
            await postMcpJsonRpc(
                parsedUrl,
                transport,
                { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
                sessionHeaders,
                timeoutMs,
            );
        } catch { /* notification failures are non-fatal */ }

        const toolsRes = await postMcpJsonRpc(
            parsedUrl,
            transport,
            { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
            sessionHeaders,
            timeoutMs,
        );
        if (toolsRes.statusCode >= 400) {
            return { success: false, message: `Server responded with HTTP ${toolsRes.statusCode} during tools/list`, tools: [] };
        }
        const toolsMsg = toolsRes.messages.find((m) => m.id === 2);
        if (!toolsMsg) {
            return { success: false, message: 'No tools/list response received from server', tools: [] };
        }
        if ('error' in toolsMsg) {
            return { success: false, message: `MCP server returned error listing tools: ${describeRpcError(toolsMsg.error)}`, tools: [] };
        }
        const result = toolsMsg.result as Record<string, unknown> | undefined;
        const rawTools = Array.isArray(result?.tools) ? result.tools : [];
        const tools = rawTools.map(normalizeToolEntry).filter((t): t is McpToolInfo => t !== null);
        return {
            success: true,
            message: `Discovered ${tools.length} tool(s)`,
            tools,
            ...(protocolVersion ? { protocolVersion } : {}),
            ...(serverName ? { serverName } : {}),
        };
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, message: `Connection failed: ${msg}`, tools: [] };
    }
}
