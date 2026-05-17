/**
 * HTTP proxy utilities for communicating with remote CoC agents.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

export interface ProxyResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: unknown;
}

/**
 * Make an HTTP request to a CoC agent and return parsed JSON.
 */
export async function proxyRequest(
    agentAddress: string,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
): Promise<unknown> {
    const url = new URL(path, agentAddress);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const requestBody = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    ...(requestBody ? { 'Content-Length': Buffer.byteLength(requestBody) } : {}),
                    ...headers,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf8');
                    try {
                        resolve(JSON.parse(rawBody));
                    } catch {
                        resolve(rawBody);
                    }
                });
            }
        );

        req.on('error', reject);
        req.setTimeout(30_000, () => {
            req.destroy(new Error(`Request to ${agentAddress}${path} timed out`));
        });

        if (requestBody) {
            req.write(requestBody);
        }
        req.end();
    });
}

/**
 * Raw proxy: pipe an incoming request to an agent and stream response back.
 * Used by the server to transparently proxy dashboard API calls.
 * Detects auth-required responses (401/403/302-to-login) and returns a
 * structured JSON error so the client can prompt for authentication.
 */
export function pipeRequest(
    agentAddress: string,
    incomingReq: http.IncomingMessage,
    outgoingRes: http.ServerResponse,
    targetPath: string,
): void {
    const url = new URL(targetPath, agentAddress);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const proxyReq = transport.request(
        {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: incomingReq.method,
            headers: {
                ...incomingReq.headers,
                host: url.host,
            },
        },
        (proxyRes) => {
            const status = proxyRes.statusCode ?? 502;
            // Detect auth-required: 401, 403, or redirect to a login page
            if (status === 401 || status === 403) {
                outgoingRes.writeHead(status, { 'Content-Type': 'application/json' });
                outgoingRes.end(JSON.stringify({
                    error: 'Authentication required',
                    authUrl: agentAddress,
                    status,
                }));
                proxyRes.resume(); // drain
                return;
            }
            if (status >= 300 && status < 400) {
                const location = proxyRes.headers['location'] || '';
                // Only treat cross-domain redirects as auth (e.g., redirect to login.microsoftonline.com)
                try {
                    const redirectHost = new URL(location, agentAddress).hostname;
                    const agentHost = new URL(agentAddress).hostname;
                    if (redirectHost !== agentHost) {
                        outgoingRes.writeHead(401, { 'Content-Type': 'application/json' });
                        outgoingRes.end(JSON.stringify({
                            error: 'Authentication required (redirect)',
                            authUrl: location || agentAddress,
                            status: 401,
                        }));
                        proxyRes.resume();
                        return;
                    }
                } catch { /* invalid URL, fall through to normal pipe */ }
                // Same-domain redirect — pass through normally
                outgoingRes.writeHead(status, proxyRes.headers);
                proxyRes.pipe(outgoingRes);
                return;
            }
            outgoingRes.writeHead(status, proxyRes.headers);
            proxyRes.pipe(outgoingRes);
        }
    );

    proxyReq.on('error', () => {
        if (!outgoingRes.headersSent) {
            outgoingRes.writeHead(502, { 'Content-Type': 'application/json' });
            outgoingRes.end(JSON.stringify({ error: 'Agent unavailable' }));
        }
    });

    incomingReq.pipe(proxyReq);
}
