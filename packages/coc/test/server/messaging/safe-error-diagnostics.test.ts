import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { safeErrorDiagnostics } from '../../../src/server/messaging/safe-error-diagnostics';

const SECRET = 'private chat text from 15551234567 at someone@s.whatsapp.net in /home/private/repo with tok_secret';

describe('safeErrorDiagnostics', () => {
    it('keeps only the class of an error, never its message, stack or arbitrary properties', () => {
        const error = Object.assign(new Error(SECRET), { details: SECRET, payload: { text: SECRET } });
        const result = safeErrorDiagnostics(error);
        expect(result).toEqual({ errorClass: 'Error' });
        expect(inspect(result, { depth: 10 })).not.toMatch(/private|15551234567|whatsapp\.net|\/home|tok_secret/);
    });

    it('reports a custom class, a differing identifier name, symbolic codes and HTTP-like statuses', () => {
        class StoreFailure extends Error {
            code = 'SQLITE_BUSY';
            statusCode = 503;
        }
        const named = Object.assign(new StoreFailure(SECRET), { name: 'NativeStoreError' });
        expect(safeErrorDiagnostics(named)).toEqual({
            errorClass: 'StoreFailure', errorName: 'NativeStoreError', errorCode: 'SQLITE_BUSY', statusCode: 503,
        });
        expect(safeErrorDiagnostics(Object.assign(new Error(SECRET), { status: 429, code: 42 })))
            .toEqual({ errorClass: 'Error', errorCode: 42, statusCode: 429 });
        // Baileys/Boom transport errors carry their status under `output`.
        class Boom extends Error { output = { statusCode: 408, payload: { message: SECRET } }; }
        expect(safeErrorDiagnostics(new Boom(SECRET))).toEqual({ errorClass: 'Boom', statusCode: 408 });
    });

    it('drops codes, names and statuses that could carry personal data or free text', () => {
        for (const code of ['15551234567', 'someone@s.whatsapp.net', 'has spaces', '/home/private', 'x'.repeat(65), 15551234567, 1.5]) {
            expect(safeErrorDiagnostics(Object.assign(new Error(SECRET), { code }))).toEqual({ errorClass: 'Error' });
        }
        expect(safeErrorDiagnostics(Object.assign(new Error(SECRET), { name: `Error: ${SECRET}` }))).toEqual({ errorClass: 'Error' });
        for (const statusCode of [99, 600, 15551234567, '500']) {
            expect(safeErrorDiagnostics(Object.assign(new Error(SECRET), { statusCode }))).toEqual({ errorClass: 'Error' });
        }
    });

    it('describes non-error throwables by type only', () => {
        expect(safeErrorDiagnostics(SECRET)).toEqual({ errorClass: 'string' });
        expect(safeErrorDiagnostics(15551234567)).toEqual({ errorClass: 'number' });
        expect(safeErrorDiagnostics(undefined)).toEqual({ errorClass: 'undefined' });
        expect(safeErrorDiagnostics(null)).toEqual({ errorClass: 'null' });
        expect(safeErrorDiagnostics({ message: SECRET, code: 'EPIPE' })).toEqual({ errorClass: 'Object', errorCode: 'EPIPE' });
        expect(safeErrorDiagnostics(Object.create(null))).toEqual({ errorClass: 'object' });
    });

    it('describes one level of cause with the same rules', () => {
        const root = Object.assign(new Error(SECRET), { code: 'ECONNRESET' });
        const middle = Object.assign(new TypeError(SECRET), { code: 'ERR_QUEUE', cause: root });
        const outer = Object.assign(new Error(SECRET), { cause: middle });
        expect(safeErrorDiagnostics(outer)).toEqual({
            errorClass: 'Error', cause: { errorClass: 'TypeError', errorCode: 'ERR_QUEUE' },
        });
        expect(safeErrorDiagnostics(Object.assign(new Error(SECRET), { cause: SECRET })))
            .toEqual({ errorClass: 'Error', cause: { errorClass: 'string' } });
    });

    it('never throws on hostile error objects', () => {
        const hostile = new Proxy(new Error(SECRET), {
            get(target, prop) {
                if (prop === 'code') throw new Error(SECRET);
                return Reflect.get(target, prop);
            },
        });
        expect(safeErrorDiagnostics(hostile)).toEqual({ errorClass: 'unknown' });
    });
});
