/**
 * Content-Length framing: partial chunks, multi-byte splits, and bad headers.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    JSON_RPC_ERROR_CODES,
    LspMessageReader,
    encodeMessage,
    isNotification,
    isRequest,
    isResponse,
} from '../../../src/server/language-servers/jsonrpc';
import type { JsonRpcMessage, LspFramingError } from '../../../src/server/language-servers/jsonrpc';

function collect(options: { maxMessageBytes?: number } = {}) {
    const messages: JsonRpcMessage[] = [];
    const errors: LspFramingError[] = [];
    const reader = new LspMessageReader({
        onMessage: (message) => messages.push(message),
        onError: (error) => errors.push(error),
        maxMessageBytes: options.maxMessageBytes,
    });
    return { reader, messages, errors };
}

describe('encodeMessage', () => {
    it('declares the byte length, not the character length', () => {
        const frame = encodeMessage({ jsonrpc: '2.0', method: 'hi', params: { text: '文' } });
        const header = frame.subarray(0, frame.indexOf('\r\n\r\n')).toString('ascii');
        const body = frame.subarray(frame.indexOf('\r\n\r\n') + 4);
        expect(header).toBe(`Content-Length: ${body.length}`);
        expect(body.length).toBeGreaterThan(JSON.parse(body.toString('utf8')).params.text.length);
        expect(JSON.parse(body.toString('utf8')).params.text).toBe('文');
    });
});

describe('LspMessageReader', () => {
    it('reads a single framed message', () => {
        const { reader, messages } = collect();
        reader.append(encodeMessage({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
        expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, method: 'initialize' }]);
        expect(reader.bufferedBytes).toBe(0);
    });

    it('reads several messages arriving in one chunk', () => {
        const { reader, messages } = collect();
        reader.append(
            Buffer.concat([
                encodeMessage({ jsonrpc: '2.0', id: 1, result: 'a' }),
                encodeMessage({ jsonrpc: '2.0', id: 2, result: 'b' }),
                encodeMessage({ jsonrpc: '2.0', method: 'n' }),
            ]),
        );
        expect(messages).toHaveLength(3);
        expect(messages.map((m) => JSON.stringify(m))).toEqual([
            '{"jsonrpc":"2.0","id":1,"result":"a"}',
            '{"jsonrpc":"2.0","id":2,"result":"b"}',
            '{"jsonrpc":"2.0","method":"n"}',
        ]);
    });

    it('waits for the rest of a message split across chunks', () => {
        const { reader, messages } = collect();
        const frame = encodeMessage({ jsonrpc: '2.0', id: 7, result: { deep: [1, 2, 3] } });
        for (let i = 0; i < frame.length; i += 1) {
            reader.append(frame.subarray(i, i + 1));
        }
        expect(messages).toEqual([{ jsonrpc: '2.0', id: 7, result: { deep: [1, 2, 3] } }]);
    });

    it('decodes a multi-byte character split across two chunks', () => {
        const { reader, messages } = collect();
        const frame = encodeMessage({ jsonrpc: '2.0', id: 1, result: 'héllo — 文字 🎉' });
        const split = frame.length - 5;
        reader.append(frame.subarray(0, split));
        expect(messages).toHaveLength(0);
        reader.append(frame.subarray(split));
        expect((messages[0] as { result: string }).result).toBe('héllo — 文字 🎉');
    });

    it('ignores other headers and header casing', () => {
        const { reader, messages, errors } = collect();
        const body = Buffer.from('{"jsonrpc":"2.0","method":"ok"}', 'utf8');
        reader.append(
            Buffer.concat([
                Buffer.from(`Content-Type: application/vscode-jsonrpc; charset=utf-8\r\ncontent-length: ${body.length}\r\n\r\n`, 'ascii'),
                body,
            ]),
        );
        expect(errors).toHaveLength(0);
        expect(messages).toEqual([{ jsonrpc: '2.0', method: 'ok' }]);
    });

    it('reports a header without a usable Content-Length and resynchronizes', () => {
        const { reader, messages, errors } = collect();
        reader.append(Buffer.from('X-Nonsense: 1\r\n\r\n', 'ascii'));
        reader.append(encodeMessage({ jsonrpc: '2.0', method: 'after' }));
        expect(errors.map((e) => e.reason)).toEqual(['missing-content-length']);
        expect(messages).toEqual([{ jsonrpc: '2.0', method: 'after' }]);
    });

    it('reports a non-numeric Content-Length', () => {
        const { reader, errors } = collect();
        reader.append(Buffer.from('Content-Length: abc\r\n\r\n', 'ascii'));
        expect(errors.map((e) => e.reason)).toEqual(['invalid-content-length']);
    });

    it('refuses a message larger than the limit instead of buffering it', () => {
        const { reader, messages, errors } = collect({ maxMessageBytes: 32 });
        reader.append(encodeMessage({ jsonrpc: '2.0', method: 'big', params: { text: 'x'.repeat(200) } }));
        expect(messages).toHaveLength(0);
        expect(errors.map((e) => e.reason)).toEqual(['message-too-large']);
        expect(reader.bufferedBytes).toBe(0);
    });

    it('reports a body that is not JSON and keeps reading', () => {
        const { reader, messages, errors } = collect();
        const bad = Buffer.from('not json', 'utf8');
        reader.append(Buffer.concat([Buffer.from(`Content-Length: ${bad.length}\r\n\r\n`, 'ascii'), bad]));
        reader.append(encodeMessage({ jsonrpc: '2.0', method: 'after' }));
        expect(errors.map((e) => e.reason)).toEqual(['invalid-json']);
        expect(messages).toEqual([{ jsonrpc: '2.0', method: 'after' }]);
    });

    it('accepts string chunks and drops buffered bytes on reset', () => {
        const { reader, messages } = collect();
        const frame = encodeMessage({ jsonrpc: '2.0', method: 'partial' });
        reader.append(frame.subarray(0, 10).toString('ascii'));
        expect(reader.bufferedBytes).toBe(10);
        reader.reset();
        expect(reader.bufferedBytes).toBe(0);
        reader.append(frame.subarray(10));
        expect(messages).toHaveLength(0);
    });

    it('does not invoke the message callback when only a header has arrived', () => {
        const onMessage = vi.fn();
        const reader = new LspMessageReader({ onMessage });
        reader.append(Buffer.from('Content-Length: 40\r\n\r\n', 'ascii'));
        expect(onMessage).not.toHaveBeenCalled();
    });
});

describe('message classification', () => {
    it('separates requests, notifications, and responses', () => {
        const request = { jsonrpc: '2.0', id: 1, method: 'a' } as JsonRpcMessage;
        const notification = { jsonrpc: '2.0', method: 'a' } as JsonRpcMessage;
        const response = { jsonrpc: '2.0', id: 1, result: null } as JsonRpcMessage;
        expect([isRequest(request), isNotification(request), isResponse(request)]).toEqual([true, false, false]);
        expect([isRequest(notification), isNotification(notification), isResponse(notification)]).toEqual([false, true, false]);
        expect([isRequest(response), isNotification(response), isResponse(response)]).toEqual([false, false, true]);
    });

    it('exposes the LSP cancellation code', () => {
        expect(JSON_RPC_ERROR_CODES.requestCancelled).toBe(-32800);
        expect(JSON_RPC_ERROR_CODES.contentModified).toBe(-32801);
    });
});
