#!/usr/bin/env node
/**
 * Deterministic non-TypeScript language server used by the runtime tests.
 *
 * It speaks plain LSP framing over stdio and knows nothing about TypeScript,
 * so any test that passes against it proves the runtime carries no
 * language-specific routing. Behavior is fixed, never touches the network, and
 * exits on `exit`.
 *
 * Supported requests:
 *   initialize            -> capabilities, plus the received initializationOptions
 *   echo                  -> returns the params unchanged
 *   getInit               -> the received initialize params plus process.cwd()
 *   slow                  -> never replies, for timeout and cancellation tests
 *   fail                  -> replies with a JSON-RPC error
 *   askClient             -> sends a server-to-client request and returns its result
 *   shutdown              -> null
 * Notifications:
 *   textDocument/didOpen  -> publishes one diagnostic naming the document
 *   $/cancelRequest       -> replies to the cancelled `slow` request with -32800
 *   exit                  -> terminates the process
 *   crash                 -> dies with a non-zero code, for restart tests
 */

import process from 'node:process';

const SEPARATOR = '\r\n\r\n';
let buffer = Buffer.alloc(0);
let nextServerRequestId = 1;
let lastInitializeParams = null;
const cancellable = new Map();
const clientReplies = new Map();

function send(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    process.stdout.write(`Content-Length: ${body.length}${SEPARATOR}`);
    process.stdout.write(body);
}

function handle(message) {
    const { id, method, params } = message;
    if (method === undefined) {
        const pending = clientReplies.get(message.id);
        if (pending) {
            clientReplies.delete(message.id);
            pending(message.result ?? null);
        }
        return;
    }
    switch (method) {
        case 'initialize':
            lastInitializeParams = params ?? null;
            send({
                jsonrpc: '2.0',
                id,
                result: {
                    capabilities: {
                        textDocumentSync: 1,
                        hoverProvider: true,
                        completionProvider: { triggerCharacters: ['.'] },
                    },
                    serverInfo: { name: 'echo-language-server', version: '1.0.0' },
                    receivedInitializationOptions: params?.initializationOptions ?? null,
                    receivedRootUri: params?.rootUri ?? null,
                },
            });
            return;
        case 'initialized':
        case 'workspace/didChangeConfiguration':
            return;
        case 'getInit':
            // Lets a test inspect exactly what the client sent in `initialize`,
            // plus the working directory the process was spawned in.
            send({ jsonrpc: '2.0', id, result: { params: lastInitializeParams, cwd: process.cwd() } });
            return;
        case 'echo':
            send({ jsonrpc: '2.0', id, result: params ?? null });
            return;
        case 'slow':
            cancellable.set(id, true);
            return;
        case 'fail':
            send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'echo server failed on purpose' } });
            return;
        case 'askClient': {
            const requestId = `s${nextServerRequestId++}`;
            clientReplies.set(requestId, (result) => send({ jsonrpc: '2.0', id, result }));
            send({ jsonrpc: '2.0', id: requestId, method: 'window/showMessageRequest', params: params ?? null });
            return;
        }
        case 'shutdown':
            send({ jsonrpc: '2.0', id, result: null });
            return;
        case 'exit':
            process.exit(0);
            return;
        case 'crash':
            // Simulates an unexpected death, for restart-backoff tests.
            process.exit(3);
            return;
        case '$/cancelRequest': {
            const target = params?.id;
            if (cancellable.delete(target)) {
                send({ jsonrpc: '2.0', id: target, error: { code: -32800, message: 'cancelled' } });
            }
            return;
        }
        case 'textDocument/didOpen':
            send({
                jsonrpc: '2.0',
                method: 'textDocument/publishDiagnostics',
                params: {
                    uri: params?.textDocument?.uri ?? null,
                    diagnostics: [
                        {
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                            severity: 2,
                            source: 'echo',
                            message: `opened ${params?.textDocument?.uri ?? 'unknown'}`,
                        },
                    ],
                },
            });
            return;
        default:
            if (id !== undefined) {
                send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } });
            }
    }
}

process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        const separator = buffer.indexOf(SEPARATOR);
        if (separator < 0) {
            return;
        }
        const header = buffer.subarray(0, separator).toString('ascii');
        const match = /content-length:\s*(\d+)/i.exec(header);
        if (!match) {
            buffer = buffer.subarray(separator + SEPARATOR.length);
            continue;
        }
        const length = Number.parseInt(match[1], 10);
        const start = separator + SEPARATOR.length;
        if (buffer.length < start + length) {
            return;
        }
        const body = buffer.subarray(start, start + length).toString('utf8');
        buffer = buffer.subarray(start + length);
        handle(JSON.parse(body));
    }
});

process.stdin.on('end', () => process.exit(0));
