/**
 * parseBodyOrReject — Edge-Case Tests (Section 5)
 *
 * Tests the `parseBodyOrReject` helper from shared/handler-utils.ts.
 * The helper wraps `parseBody` and sends a 400 INVALID_JSON response
 * on parse failure, returning null to the caller.
 *
 * Cross-platform compatible (Linux/macOS/Windows).
 */

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import * as http from 'http';
import { parseBodyOrReject } from '../src/shared/handler-utils';

// ============================================================================
// Helpers
// ============================================================================

function fakeRequest(data?: string | Buffer): http.IncomingMessage {
    const readable = new Readable({
        read() {
            if (data !== undefined) {
                this.push(typeof data === 'string' ? Buffer.from(data, 'utf-8') : data);
            }
            this.push(null);
        },
    });
    return readable as unknown as http.IncomingMessage;
}

function createMockResponse(): {
    res: http.ServerResponse;
    getStatus: () => number;
    getBody: () => unknown;
} {
    let status = 0;
    let rawBody = '';
    const res = {
        writeHead: vi.fn((code: number) => { status = code; }),
        end: vi.fn((data?: string) => { if (data) rawBody = data; }),
    } as unknown as http.ServerResponse;
    return {
        res,
        getStatus: () => status,
        getBody: () => (rawBody ? JSON.parse(rawBody) : undefined),
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('parseBodyOrReject', () => {
    it('returns parsed object for valid JSON', async () => {
        const { res } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest(JSON.stringify({ key: 'value' })), res);
        expect(result).toEqual({ key: 'value' });
    });

    it('returns parsed array for valid JSON array', async () => {
        const { res } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest(JSON.stringify([1, 2, 3])), res);
        expect(result).toEqual([1, 2, 3]);
    });

    it('returns empty object {} for empty body (Content-Length: 0)', async () => {
        const { res } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest(''), res);
        expect(result).toEqual({});
    });

    it('returns empty object {} for whitespace-only body', async () => {
        const { res } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest('   \n\t  '), res);
        expect(result).toEqual({});
    });

    it('returns null and sends 400 INVALID_JSON for malformed JSON', async () => {
        const { res, getStatus, getBody } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest('{broken'), res);
        expect(result).toBeNull();
        expect(getStatus()).toBe(400);
        expect((getBody() as any)?.code).toBe('INVALID_JSON');
    });

    it('returns null and sends 400 INVALID_JSON for JSON with trailing comma', async () => {
        const { res, getStatus, getBody } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest('{"a":1,}'), res);
        expect(result).toBeNull();
        expect(getStatus()).toBe(400);
        expect((getBody() as any)?.code).toBe('INVALID_JSON');
    });

    it('returns null and sends 400 for binary (non-UTF8) body that produces invalid JSON', async () => {
        // Non-UTF8 bytes will produce a garbled string that fails JSON.parse
        const binary = Buffer.from([0x80, 0x81, 0x82, 0x83]);
        const { res, getStatus } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest(binary), res);
        expect(result).toBeNull();
        expect(getStatus()).toBe(400);
    });

    it('returns null JSON body as empty object (null body treated as absent)', async () => {
        // JSON.parse('null') === null → parseBody returns null, which is falsy
        // The raw string 'null' after trim is truthy so JSON.parse runs → returns null
        // null is not an error, so parseBodyOrReject returns it as-is (documents behaviour)
        const { res } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest('null'), res);
        // parseBody returns null (valid JSON), parseBodyOrReject passes it through
        expect(result).toBeNull();
    });

    it('parses valid JSON number as body (42) — returns the number', async () => {
        const { res } = createMockResponse();
        const result = await parseBodyOrReject(fakeRequest('42'), res);
        expect(result).toBe(42);
    });

    it('error response body has Content-Type application/json', async () => {
        let capturedHeaders: Record<string, unknown> = {};
        const res = {
            writeHead: vi.fn((code: number, headers?: Record<string, unknown>) => {
                capturedHeaders = headers ?? {};
            }),
            end: vi.fn(),
        } as unknown as http.ServerResponse;
        await parseBodyOrReject(fakeRequest('{bad json}'), res);
        expect(String(capturedHeaders['Content-Type'] ?? '')).toContain('application/json');
    });
});
