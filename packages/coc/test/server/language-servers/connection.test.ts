/**
 * Request correlation, cancellation, timeouts, and disposal for the
 * transport-neutral language-server connection.
 *
 * The stream-pair suite drives the connection directly; the stdio suite runs it
 * against a real non-TypeScript fixture server process, so nothing here depends
 * on TypeScript-specific behavior.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
    LanguageServerConnection,
    LanguageServerRequestError,
} from '../../../src/server/language-servers/connection';
import { LspMessageReader, encodeMessage } from '../../../src/server/language-servers/jsonrpc';
import type { JsonRpcMessage } from '../../../src/server/language-servers/jsonrpc';

const FIXTURE_SERVER = path.join(__dirname, 'fixtures', 'echo-language-server.mjs');

/** A connection wired to a fake server that records what the client wrote. */
function createPair(options: { requestTimeoutMs?: number } = {}) {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const sent: JsonRpcMessage[] = [];
    const errors: Error[] = [];
    const reader = new LspMessageReader({ onMessage: (message) => sent.push(message) });
    toServer.on('data', (chunk: Buffer) => reader.append(chunk));
    const connection = new LanguageServerConnection({
        input: toClient,
        output: toServer,
        requestTimeoutMs: options.requestTimeoutMs ?? 1000,
        onError: (error) => errors.push(error),
    });
    const reply = (message: unknown) => toClient.write(encodeMessage(message));
    return { connection, sent, errors, reply, toClient, toServer };
}

/** Lets queued stream data and microtasks settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('LanguageServerConnection over a stream pair', () => {
    it('sends a request with an incrementing id and resolves with the result', async () => {
        const { connection, sent, reply } = createPair();
        const first = connection.sendRequest('echo', { a: 1 });
        const second = connection.sendRequest('echo', { a: 2 });
        await flush();
        expect(sent).toEqual([
            { jsonrpc: '2.0', id: 1, method: 'echo', params: { a: 1 } },
            { jsonrpc: '2.0', id: 2, method: 'echo', params: { a: 2 } },
        ]);
        expect(connection.pendingRequestCount).toBe(2);
        reply({ jsonrpc: '2.0', id: 2, result: 'second' });
        reply({ jsonrpc: '2.0', id: 1, result: 'first' });
        await expect(first).resolves.toBe('first');
        await expect(second).resolves.toBe('second');
        expect(connection.pendingRequestCount).toBe(0);
        connection.dispose();
    });

    it('rejects with the server error body', async () => {
        const { connection, reply } = createPair();
        const pending = connection.sendRequest('fail');
        await flush();
        reply({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'boom', data: { detail: 'x' } } });
        await expect(pending).rejects.toMatchObject({
            failure: 'server-error',
            method: 'fail',
            message: 'boom',
            code: -32603,
            data: { detail: 'x' },
        });
        connection.dispose();
    });

    it('times out and asks the server to cancel', async () => {
        vi.useFakeTimers();
        try {
            const { connection, sent } = createPair({ requestTimeoutMs: 50 });
            const pending = connection.sendRequest('slow');
            const settled = pending.catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(60);
            const error = await settled;
            expect(error).toBeInstanceOf(LanguageServerRequestError);
            expect(error).toMatchObject({ failure: 'timeout', method: 'slow' });
            vi.useRealTimers();
            await flush();
            expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } });
            expect(connection.pendingRequestCount).toBe(0);
            connection.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('suspends normal request deadlines while the server is indexing', async () => {
        vi.useFakeTimers();
        try {
            const { connection, reply } = createPair({ requestTimeoutMs: 50 });
            const pending = connection.sendRequest('hover');
            await vi.advanceTimersByTimeAsync(20);
            connection.setRequestTimeoutsSuspended(true);
            await vi.advanceTimersByTimeAsync(100);
            expect(connection.pendingRequestCount).toBe(1);

            connection.setRequestTimeoutsSuspended(false);
            await vi.advanceTimersByTimeAsync(20);
            reply({ jsonrpc: '2.0', id: 1, result: 'hover result' });
            await expect(pending).resolves.toBe('hover result');
            connection.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps non-suspendable lifecycle request deadlines active', async () => {
        vi.useFakeTimers();
        try {
            const { connection } = createPair({ requestTimeoutMs: 50 });
            connection.setRequestTimeoutsSuspended(true);
            const pending = connection.sendRequest('shutdown', null, { suspendable: false });
            const settled = pending.catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(60);
            await expect(settled).resolves.toMatchObject({ failure: 'timeout', method: 'shutdown' });
            connection.dispose();
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels a superseded request through its abort signal', async () => {
        const { connection, sent } = createPair();
        const controller = new AbortController();
        const pending = connection.sendRequest('slow', undefined, { signal: controller.signal });
        await flush();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ failure: 'cancelled', method: 'slow' });
        await flush();
        expect(sent.at(-1)).toEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 1 } });
        connection.dispose();
    });

    it('rejects immediately when the signal is already aborted and sends nothing', async () => {
        const { connection, sent } = createPair();
        await expect(
            connection.sendRequest('echo', {}, { signal: AbortSignal.abort() }),
        ).rejects.toMatchObject({ failure: 'cancelled' });
        await flush();
        expect(sent).toEqual([]);
        connection.dispose();
    });

    it('drops a late reply that belongs to a settled request', async () => {
        const { connection, reply, errors } = createPair();
        const controller = new AbortController();
        const pending = connection.sendRequest('slow', undefined, { signal: controller.signal });
        await flush();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ failure: 'cancelled' });
        reply({ jsonrpc: '2.0', id: 1, result: 'stale' });
        await flush();
        expect(errors).toEqual([]);
        expect(connection.pendingRequestCount).toBe(0);
        connection.dispose();
    });

    it('routes notifications to every subscriber and stops after unsubscribe', async () => {
        const { connection, reply } = createPair();
        const first = vi.fn();
        const second = vi.fn();
        connection.onNotification('textDocument/publishDiagnostics', first);
        const unsubscribe = connection.onNotification('textDocument/publishDiagnostics', second);
        reply({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'a' } });
        await flush();
        expect(first).toHaveBeenCalledWith({ uri: 'a' });
        expect(second).toHaveBeenCalledWith({ uri: 'a' });
        unsubscribe();
        reply({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'b' } });
        await flush();
        expect(first).toHaveBeenCalledTimes(2);
        expect(second).toHaveBeenCalledTimes(1);
        connection.dispose();
    });

    it('keeps delivering notifications after one handler throws', async () => {
        const { connection, reply, errors } = createPair();
        const good = vi.fn();
        connection.onNotification('window/logMessage', () => {
            throw new Error('handler failed');
        });
        connection.onNotification('window/logMessage', good);
        reply({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'x' } });
        await flush();
        expect(good).toHaveBeenCalledWith({ message: 'x' });
        expect(errors.map((error) => error.message)).toEqual(['handler failed']);
        connection.dispose();
    });

    it('answers a server-to-client request', async () => {
        const { connection, sent, reply } = createPair();
        connection.onRequest('workspace/configuration', (params) => [{ received: params }]);
        reply({ jsonrpc: '2.0', id: 'srv-1', method: 'workspace/configuration', params: { items: [] } });
        await flush();
        expect(sent.at(-1)).toEqual({
            jsonrpc: '2.0',
            id: 'srv-1',
            result: [{ received: { items: [] } }],
        });
        connection.dispose();
    });

    it('reports method-not-found for an unhandled server request', async () => {
        const { connection, sent, reply } = createPair();
        reply({ jsonrpc: '2.0', id: 5, method: 'window/showMessageRequest' });
        await flush();
        expect(sent.at(-1)).toEqual({
            jsonrpc: '2.0',
            id: 5,
            error: { code: -32601, message: 'Unhandled request: window/showMessageRequest' },
        });
        connection.dispose();
    });

    it('turns a throwing handler into an internal-error response', async () => {
        const { connection, sent, reply } = createPair();
        connection.onRequest('workspace/applyEdit', () => {
            throw new Error('not allowed');
        });
        reply({ jsonrpc: '2.0', id: 9, method: 'workspace/applyEdit' });
        await flush();
        expect(sent.at(-1)).toEqual({
            jsonrpc: '2.0',
            id: 9,
            error: { code: -32603, message: 'not allowed' },
        });
        connection.dispose();
    });

    it('rejects everything in flight when disposed and refuses new requests', async () => {
        const { connection } = createPair();
        const pending = connection.sendRequest('slow');
        await flush();
        connection.dispose('workspace removed');
        await expect(pending).rejects.toMatchObject({ failure: 'closed', message: 'workspace removed' });
        expect(connection.isClosed).toBe(true);
        await expect(connection.sendRequest('echo')).rejects.toMatchObject({ failure: 'closed' });
        expect(connection.pendingRequestCount).toBe(0);
    });

    it('rejects pending requests when the server stream ends', async () => {
        const { connection, toClient } = createPair();
        const pending = connection.sendRequest('slow');
        await flush();
        toClient.end();
        await expect(pending).rejects.toMatchObject({ failure: 'closed' });
        expect(connection.isClosed).toBe(true);
    });

    it('returns false for a notification sent after disposal', () => {
        const { connection } = createPair();
        expect(connection.sendNotification('exit')).toBe(true);
        connection.dispose();
        expect(connection.sendNotification('exit')).toBe(false);
    });
});

describe('LanguageServerConnection over a real fixture server process', () => {
    const children: ChildProcessWithoutNullStreams[] = [];
    const connections: LanguageServerConnection[] = [];

    afterEach(() => {
        for (const connection of connections.splice(0)) {
            connection.dispose();
        }
        for (const child of children.splice(0)) {
            child.kill('SIGKILL');
        }
    });

    function startFixture(): LanguageServerConnection {
        const child = spawn(process.execPath, [FIXTURE_SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
        children.push(child);
        const connection = new LanguageServerConnection({ input: child.stdout, output: child.stdin });
        connections.push(connection);
        return connection;
    }

    it('completes an initialize handshake and reads back the negotiated capabilities', async () => {
        const connection = startFixture();
        const result = await connection.sendRequest<{
            capabilities: { hoverProvider: boolean };
            serverInfo: { name: string };
            receivedInitializationOptions: unknown;
        }>('initialize', {
            processId: process.pid,
            rootUri: 'file:///tmp/fixture',
            initializationOptions: { flavor: 'generic' },
            capabilities: {},
        });
        expect(result.capabilities.hoverProvider).toBe(true);
        expect(result.serverInfo.name).toBe('echo-language-server');
        expect(result.receivedInitializationOptions).toEqual({ flavor: 'generic' });
    });

    it('round-trips Unicode and CRLF content through real stdio framing', async () => {
        const connection = startFixture();
        const payload = { text: 'const s = "héllo 文字 🎉";\r\nexport default s;\r\n' };
        await expect(connection.sendRequest('echo', payload)).resolves.toEqual(payload);
    });

    it('receives a server notification for a document the fixture opened', async () => {
        const connection = startFixture();
        const received = new Promise<{ uri: string; diagnostics: { message: string }[] }>((resolve) => {
            connection.onNotification('textDocument/publishDiagnostics', (params) =>
                resolve(params as { uri: string; diagnostics: { message: string }[] }),
            );
        });
        connection.sendNotification('textDocument/didOpen', {
            textDocument: { uri: 'file:///tmp/fixture/a.demo', languageId: 'demo', version: 1, text: 'x' },
        });
        const params = await received;
        expect(params.uri).toBe('file:///tmp/fixture/a.demo');
        expect(params.diagnostics[0].message).toBe('opened file:///tmp/fixture/a.demo');
    });

    it('answers a request the fixture server sends back to the client', async () => {
        const connection = startFixture();
        connection.onRequest('window/showMessageRequest', (params) => ({ chose: (params as { pick: string }).pick }));
        await expect(connection.sendRequest('askClient', { pick: 'retry' })).resolves.toEqual({ chose: 'retry' });
    });

    it('cancels an in-flight request against the live server', async () => {
        const connection = startFixture();
        const controller = new AbortController();
        const pending = connection.sendRequest('slow', undefined, { signal: controller.signal });
        await flush();
        controller.abort();
        await expect(pending).rejects.toMatchObject({ failure: 'cancelled' });
        // The connection survives the cancellation and still serves requests.
        await expect(connection.sendRequest('echo', 'still here')).resolves.toBe('still here');
    });

    it('surfaces a server-reported error without closing the connection', async () => {
        const connection = startFixture();
        await expect(connection.sendRequest('fail')).rejects.toMatchObject({
            failure: 'server-error',
            message: 'echo server failed on purpose',
        });
        await expect(connection.sendRequest('echo', 1)).resolves.toBe(1);
    });

    it('closes when the server process exits', async () => {
        const connection = startFixture();
        await connection.sendRequest('shutdown');
        const pending = connection.sendRequest('slow');
        connection.sendNotification('exit');
        await expect(pending).rejects.toMatchObject({ failure: 'closed' });
        expect(connection.isClosed).toBe(true);
    });
});
