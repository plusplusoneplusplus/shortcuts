/**
 * Test helpers for memory route tests.
 *
 * Provides a lightweight test router that can exercise Route handlers
 * without starting a full HTTP server.
 */

import * as http from 'http';
import { Readable } from 'stream';
import type { Route } from '../../../src/server/types';

interface TestResponse {
    status: number;
    body: string;
    json(): any;
}

/**
 * Create a minimal mock http.ServerResponse that captures written data.
 */
function createMockResponse(): { res: http.ServerResponse; getResult: () => { status: number; body: string } } {
    let statusCode = 200;
    const chunks: string[] = [];

    const res = {
        writeHead(code: number, hdrs?: Record<string, string | number>) {
            statusCode = code;
            return res;
        },
        setHeader(_name: string, _value: string) { /* no-op */ },
        write(chunk: string | Buffer) {
            chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
            return true;
        },
        end(data?: string | Buffer) {
            if (data != null) {
                chunks.push(typeof data === 'string' ? data : data.toString());
            }
        },
        get statusCode() { return statusCode; },
        set statusCode(v: number) { statusCode = v; },
    } as unknown as http.ServerResponse;

    return {
        res,
        getResult: () => ({ status: statusCode, body: chunks.join('') }),
    };
}

/**
 * Create a test router from an array of Route objects.
 * Routes are matched in order by method + pattern.
 */
export function createTestRouter(routes: Route[]) {
    async function dispatch(
        method: string,
        urlPath: string,
        body?: any,
    ): Promise<TestResponse> {
        const { res, getResult } = createMockResponse();

        // Create mock request as a Readable stream
        const bodyStr = body != null ? JSON.stringify(body) : '';
        const readable = new Readable();
        readable.push(bodyStr);
        readable.push(null);
        const req = Object.assign(readable, {
            method,
            url: urlPath,
            headers: {
                'content-type': 'application/json',
                'content-length': String(Buffer.byteLength(bodyStr)),
            },
        }) as unknown as http.IncomingMessage;

        // Find matching route
        for (const route of routes) {
            if (route.method !== method) continue;

            let match: RegExpExecArray | null = null;
            if (typeof route.pattern === 'string') {
                const pathOnly = urlPath.split('?')[0];
                if (pathOnly === route.pattern) {
                    match = [pathOnly] as unknown as RegExpExecArray;
                }
            } else {
                const pathOnly = urlPath.split('?')[0];
                match = route.pattern.exec(pathOnly);
            }

            if (match) {
                await route.handler(req, res, match);
                break;
            }
        }

        const result = getResult();
        return {
            status: result.status,
            body: result.body,
            json() {
                return JSON.parse(result.body);
            },
        };
    }

    return {
        get: (url: string) => dispatch('GET', url),
        put: (url: string, body?: any) => dispatch('PUT', url, body),
        post: (url: string, body?: any) => dispatch('POST', url, body),
        delete: (url: string, body?: any) => dispatch('DELETE', url, body),
        patch: (url: string, body?: any) => dispatch('PATCH', url, body),
    };
}
