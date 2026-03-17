import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// vi.mock must be at the top level so Vitest can hoist it
vi.mock('https', () => ({ request: vi.fn() }));
vi.mock('http', () => ({ request: vi.fn() }));

import * as https from 'https';
import { httpGet, httpDownload, httpGetJson } from '../../src/utils/http-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeResponse = EventEmitter & {
    statusCode: number;
    headers: Record<string, string>;
    setEncoding: () => void;
};

type FakeRequest = EventEmitter & { end: () => void; destroy: () => void };

/** Build a fake IncomingMessage. Events are NOT auto-emitted; caller controls timing. */
function buildFakeResponse(
    statusCode: number,
    headers: Record<string, string> = {},
): FakeResponse {
    const res = new EventEmitter() as FakeResponse;
    res.statusCode = statusCode;
    res.headers = headers;
    res.setEncoding = () => { /* no-op */ };
    return res;
}

function buildFakeRequest(): FakeRequest {
    const req = new EventEmitter() as FakeRequest;
    req.end = () => { /* no-op */ };
    req.destroy = () => req.emit('error', new Error('Request timed out'));
    return req;
}

type MockImpl = (opts: unknown, cb: (res: FakeResponse) => void) => FakeRequest;

/**
 * Set up the https.request mock to call `cb` synchronously with a FakeResponse,
 * then emit `body` data + 'end' via process.nextTick (after listeners are attached).
 */
function mockHttp(statusCode: number, body: string, headers: Record<string, string> = {}): FakeRequest {
    const fakeRes = buildFakeResponse(statusCode, headers);
    const fakeReq = buildFakeRequest();
    vi.mocked(https.request).mockImplementation(((_opts: unknown, cb: (res: FakeResponse) => void) => {
        setImmediate(() => {
            cb(fakeRes);
            // Emit after the callback has attached its 'data'/'end' listeners
            process.nextTick(() => {
                fakeRes.emit('data', body);
                fakeRes.emit('end');
            });
        });
        return fakeReq;
    }) as unknown as typeof https.request);
    return fakeReq;
}

beforeEach(() => {
    vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// httpGet
// ---------------------------------------------------------------------------

describe('httpGet', () => {
    it('returns body and statusCode for a successful 200 response', async () => {
        mockHttp(200, 'hello world');
        const result = await httpGet('https://example.com/');
        expect(result.statusCode).toBe(200);
        expect(result.body).toBe('hello world');
    });

    it('returns non-200 status codes without throwing', async () => {
        mockHttp(404, 'Not Found');
        const result = await httpGet('https://example.com/missing');
        expect(result.statusCode).toBe(404);
    });

    it('rejects when the request emits an error', async () => {
        const fakeReq = buildFakeRequest();
        vi.mocked(https.request).mockImplementation(((_opts: unknown, _cb: unknown) => {
            setImmediate(() => fakeReq.emit('error', new Error('ECONNREFUSED')));
            return fakeReq;
        }) as unknown as typeof https.request);

        await expect(httpGet('https://example.com/')).rejects.toThrow('ECONNREFUSED');
    });
});

// ---------------------------------------------------------------------------
// httpDownload
// ---------------------------------------------------------------------------

describe('httpDownload', () => {
    it('returns body for a 200 response', async () => {
        mockHttp(200, 'file contents');
        const result = await httpDownload('https://example.com/file.txt');
        expect(result).toBe('file contents');
    });

    it('follows a single redirect and returns the final body', async () => {
        let callCount = 0;
        vi.mocked(https.request).mockImplementation(((_opts: unknown, cb: (res: FakeResponse) => void) => {
            const fakeReq = buildFakeRequest();
            setImmediate(() => {
                if (callCount === 0) {
                    callCount++;
                    const res = buildFakeResponse(302, { location: 'https://example.com/final' });
                    cb(res);
                    process.nextTick(() => { res.emit('data', ''); res.emit('end'); });
                } else {
                    const res = buildFakeResponse(200);
                    cb(res);
                    process.nextTick(() => { res.emit('data', 'redirected body'); res.emit('end'); });
                }
            });
            return fakeReq;
        }) as unknown as typeof https.request);

        const result = await httpDownload('https://example.com/redirect');
        expect(result).toBe('redirected body');
    });

    it('throws when status code is not 2xx or redirect', async () => {
        mockHttp(500, 'Internal Server Error');
        await expect(httpDownload('https://example.com/')).rejects.toThrow('HTTP 500');
    });

    it('throws when max redirects exceeded', async () => {
        vi.mocked(https.request).mockImplementation(((_opts: unknown, cb: (res: FakeResponse) => void) => {
            const fakeReq = buildFakeRequest();
            setImmediate(() => {
                const res = buildFakeResponse(302, { location: 'https://example.com/loop' });
                cb(res);
                process.nextTick(() => { res.emit('data', ''); res.emit('end'); });
            });
            return fakeReq;
        }) as unknown as typeof https.request);

        await expect(httpDownload('https://example.com/loop', { maxRedirects: 2 }))
            .rejects.toThrow('Too many redirects');
    });
});

// ---------------------------------------------------------------------------
// httpGetJson
// ---------------------------------------------------------------------------

describe('httpGetJson', () => {
    it('parses and returns a JSON body', async () => {
        mockHttp(200, JSON.stringify({ key: 'value' }));
        const result = await httpGetJson<{ key: string }>('https://example.com/data');
        expect(result).toEqual({ key: 'value' });
    });

    it('throws on non-2xx status code', async () => {
        mockHttp(403, 'Forbidden');
        await expect(httpGetJson('https://example.com/')).rejects.toThrow('HTTP 403');
    });

    it('uses JSON error message from response body when available', async () => {
        mockHttp(401, JSON.stringify({ message: 'Access denied' }));
        await expect(httpGetJson('https://example.com/')).rejects.toThrow('Access denied');
    });
});
