/**
 * route-utils unit tests
 *
 * Covers: asString, asInt, asBool, and the createRoute() wrapper.
 */

import { describe, it, expect, vi } from 'vitest';
import * as http from 'http';
import { asString, asInt, asBool, createRoute } from '../../src/server/routes/route-utils';

// ============================================================================
// asString
// ============================================================================

describe('asString', () => {
    it('returns the string value when given a string', () => {
        expect(asString('hello')).toBe('hello');
    });

    it('returns the first element when given a string array', () => {
        expect(asString(['a', 'b'])).toBe('a');
    });

    it('returns undefined when given undefined and no fallback', () => {
        expect(asString(undefined)).toBeUndefined();
    });

    it('returns fallback when given undefined', () => {
        expect(asString(undefined, 'default')).toBe('default');
    });

    it('returns fallback when given an empty array', () => {
        // empty array: Array.isArray is true, v[0] is undefined
        expect(asString([], 'default')).toBe('default');
    });

    it('returns the string even when a fallback is provided', () => {
        expect(asString('value', 'fallback')).toBe('value');
    });
});

// ============================================================================
// asInt
// ============================================================================

describe('asInt', () => {
    it('parses a valid integer string', () => {
        expect(asInt('42', 0)).toBe(42);
    });

    it('returns fallback when given undefined', () => {
        expect(asInt(undefined, 99)).toBe(99);
    });

    it('returns fallback when the string is NaN', () => {
        expect(asInt('not-a-number', 5)).toBe(5);
    });

    it('applies max cap when provided', () => {
        expect(asInt('1000', 100, 500)).toBe(500);
    });

    it('does not cap when value is below max', () => {
        expect(asInt('200', 100, 500)).toBe(200);
    });

    it('returns undefined (no overload) when value is absent and no fallback given', () => {
        expect(asInt(undefined)).toBeUndefined();
    });

    it('uses the first element of an array', () => {
        expect(asInt(['7', '99'], 0)).toBe(7);
    });

    it('returns fallback when array is empty', () => {
        expect(asInt([], 3)).toBe(3);
    });

    it('handles negative integers', () => {
        expect(asInt('-5', 0)).toBe(-5);
    });
});

// ============================================================================
// asBool
// ============================================================================

describe('asBool', () => {
    it("returns true for 'true'", () => {
        expect(asBool('true')).toBe(true);
    });

    it("returns false for 'false'", () => {
        expect(asBool('false')).toBe(false);
    });

    it('returns the fallback (default false) for undefined', () => {
        expect(asBool(undefined)).toBe(false);
    });

    it('returns custom fallback for undefined', () => {
        expect(asBool(undefined, true)).toBe(true);
    });

    it('returns the fallback for an unrecognised string', () => {
        expect(asBool('yes')).toBe(false);
        expect(asBool('1')).toBe(false);
    });

    it('uses the first element of an array', () => {
        expect(asBool(['true', 'false'])).toBe(true);
    });
});

// ============================================================================
// createRoute — helpers
// ============================================================================

/** Build a minimal fake IncomingMessage with the given url. */
function fakeReq(url: string): http.IncomingMessage {
    return { url } as unknown as http.IncomingMessage;
}

interface ResponseCapture {
    statusCode: number | undefined;
    body: string | undefined;
    headers: Record<string, string | number>;
    ended: boolean;
}

/** Build a fake ServerResponse that captures writes. */
function fakeRes(): { res: http.ServerResponse; capture: ResponseCapture } {
    const capture: ResponseCapture = {
        statusCode: undefined,
        body: undefined,
        headers: {},
        ended: false,
    };
    const res = {
        headersSent: false,
        writeHead(code: number, hdrs?: Record<string, string | number>) {
            capture.statusCode = code;
            if (hdrs) Object.assign(capture.headers, hdrs);
            (this as any).headersSent = true;
        },
        end(data?: string | Buffer) {
            if (data !== undefined) {
                capture.body = typeof data === 'string' ? data : data.toString('utf-8');
            }
            capture.ended = true;
        },
        write() {},
        // attach req so gzip logic works
        req: fakeReq('/'),
    } as unknown as http.ServerResponse;
    return { res, capture };
}

// ============================================================================
// createRoute — behaviour tests
// ============================================================================

describe('createRoute', () => {
    it('sends a JSON 200 response when handler returns a value', async () => {
        const route = createRoute({
            method: 'GET',
            pattern: '/api/test',
            handler: async () => ({ ok: true }),
        });

        const { res, capture } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/test'), res, undefined);

        expect(capture.statusCode).toBe(200);
        expect(JSON.parse(capture.body!)).toEqual({ ok: true });
    });

    it('uses the provided statusCode', async () => {
        const route = createRoute({
            method: 'POST',
            pattern: '/api/jobs',
            statusCode: 202,
            handler: async () => ({ jobId: 'j1' }),
        });

        const { res, capture } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/jobs'), res, undefined);

        expect(capture.statusCode).toBe(202);
        expect(JSON.parse(capture.body!)).toEqual({ jobId: 'j1' });
    });

    it('does not send a response when handler returns void', async () => {
        const route = createRoute({
            method: 'GET',
            pattern: '/api/void',
            handler: async ({ res }) => {
                // manually send the response
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end('{"manual":true}');
            },
        });

        const { res, capture } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/void'), res, undefined);

        // The wrapper must not overwrite the manually-sent response
        expect(capture.statusCode).toBe(200);
        expect(JSON.parse(capture.body!)).toEqual({ manual: true });
    });

    it('calls handleAPIError when the handler throws an Error', async () => {
        const route = createRoute({
            method: 'GET',
            pattern: '/api/throw',
            handler: async () => {
                throw new Error('something went wrong');
            },
        });

        const { res, capture } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/throw'), res, undefined);

        expect(capture.statusCode).toBe(500);
        const body = JSON.parse(capture.body!);
        expect(body).toHaveProperty('error');
    });

    it('returns the API error statusCode when the handler throws an APIError', async () => {
        // Dynamically import to get the real APIError class
        const { APIError } = await import('../../src/server/errors');

        const route = createRoute({
            method: 'GET',
            pattern: '/api/missing',
            handler: async () => {
                throw new APIError(404, 'Resource not found', 'NOT_FOUND');
            },
        });

        const { res, capture } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/missing'), res, undefined);

        expect(capture.statusCode).toBe(404);
        const body = JSON.parse(capture.body!);
        expect(body.error).toBe('Resource not found');
        expect(body.code).toBe('NOT_FOUND');
    });

    it('passes typed query params from parseQuery to the handler', async () => {
        let received: { limit: number; search: string | undefined } | undefined;

        const route = createRoute({
            method: 'GET',
            pattern: '/api/items',
            parseQuery: (q) => ({
                limit: asInt(q.limit, 10, 100),
                search: asString(q.search),
            }),
            handler: async ({ query }) => {
                received = query;
                return { ok: true };
            },
        });

        const { res } = fakeRes();
        await (route.handler as Function)(
            fakeReq('/api/items?limit=50&search=hello'),
            res,
            undefined,
        );

        expect(received?.limit).toBe(50);
        expect(received?.search).toBe('hello');
    });

    it('caps the integer via asInt max when provided', async () => {
        let received: { limit: number } | undefined;

        const route = createRoute({
            method: 'GET',
            pattern: '/api/items',
            parseQuery: (q) => ({ limit: asInt(q.limit, 10, 100) }),
            handler: async ({ query }) => {
                received = query;
                return {};
            },
        });

        const { res } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/items?limit=9999'), res, undefined);

        expect(received?.limit).toBe(100);
    });

    it('passes the match array to the handler', async () => {
        let capturedMatch: RegExpMatchArray | undefined;

        const route = createRoute({
            pattern: /^\/api\/items\/([^/]+)$/,
            handler: async ({ match }) => {
                capturedMatch = match;
                return { id: match[1] };
            },
        });

        const match = '/api/items/abc123'.match(/^\/api\/items\/([^/]+)$/)!;
        const { res } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/items/abc123'), res, match);

        expect(capturedMatch![1]).toBe('abc123');
    });

    it('does not double-send when headersSent is already true', async () => {
        const writeSpy = vi.fn();

        const route = createRoute({
            method: 'GET',
            pattern: '/api/test',
            handler: async ({ res }) => {
                res.writeHead(200, {});
                res.end('{"first":true}');
                return { second: true }; // should be ignored
            },
        });

        const { res, capture } = fakeRes();
        await (route.handler as Function)(fakeReq('/api/test'), res, undefined);

        // writeHead was called once (manually); the wrapper must not call it again
        expect(capture.statusCode).toBe(200);
        expect(capture.body).toBe('{"first":true}');
    });
});
