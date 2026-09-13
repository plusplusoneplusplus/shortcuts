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
 *   getDocument           -> returns the open text for one document URI
 *   slow                  -> never replies, for timeout and cancellation tests
 *   indexing              -> reports work progress around a delayed reply
 *   fail                  -> replies with a JSON-RPC error
 *   askClient             -> sends a server-to-client request and returns its result
 *   ask                   -> sends `params.method` to the client and returns its result
 *   shutdown              -> null
 * Notifications:
 *   textDocument/didOpen  -> publishes one diagnostic naming the document
 *   $/cancelRequest       -> replies to the cancelled `slow` request with -32800
 *   exit                  -> terminates the process
 *   crash                 -> dies with a non-zero code, for restart tests
 *
 * Arguments:
 *   --pid-file <path>     -> writes this process's pid there at startup
 *   --stubborn            -> ignores `exit`, a closed stdin, and SIGTERM
 */

import process from 'node:process';
import { writeFileSync } from 'node:fs';

// `--stubborn` makes the process refuse every polite way of stopping it: the
// `exit` notification, a closed stdin, and SIGTERM. Teardown tests use it to
// prove a server that will not leave is killed anyway.
const STUBBORN = process.argv.includes('--stubborn');
// `--pid-file <path>` lets a test watch the real process disappear, including
// through a composed server where it never holds the child handle.
const pidFileIndex = process.argv.indexOf('--pid-file');
if (pidFileIndex >= 0 && process.argv[pidFileIndex + 1]) {
    writeFileSync(process.argv[pidFileIndex + 1], String(process.pid), 'utf8');
}
if (STUBBORN) {
    process.on('SIGTERM', () => {});
    process.on('SIGINT', () => {});
    // Holds the event loop, so the process stays up even after stdin ends.
    setInterval(() => {}, 1_000);
}

const SEPARATOR = '\r\n\r\n';
let buffer = Buffer.alloc(0);
let nextServerRequestId = 1;
let lastInitializeParams = null;
const cancellable = new Map();
const clientReplies = new Map();
const openDocuments = new Map();

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
            pending(message);
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
        case 'getDocument':
            send({
                jsonrpc: '2.0',
                id,
                result: openDocuments.get(params?.textDocument?.uri) ?? null,
            });
            return;
        case 'echo':
            send({ jsonrpc: '2.0', id, result: params ?? null });
            return;
        case 'slow':
            cancellable.set(id, true);
            return;
        case 'indexing': {
            const token = params?.token ?? 'indexing';
            const delayMs = params?.delayMs ?? 100;
            send({
                jsonrpc: '2.0',
                method: '$/progress',
                params: { token, value: { kind: 'begin', title: 'Indexing workspace' } },
            });
            setTimeout(() => {
                send({ jsonrpc: '2.0', method: '$/progress', params: { token, value: { kind: 'end' } } });
                send({ jsonrpc: '2.0', id, result: { indexed: true } });
            }, delayMs);
            return;
        }
        case 'fail':
            send({ jsonrpc: '2.0', id, error: { code: -32603, message: 'echo server failed on purpose' } });
            return;
        case 'ask': {
            // Generic server-to-client request, so a test can drive any client
            // method (workspace/configuration, client/registerCapability, ...)
            // through a real process instead of a stub connection.
            const requestId = `s${nextServerRequestId++}`;
            clientReplies.set(requestId, (reply) =>
                send({ jsonrpc: '2.0', id, result: { value: reply.result ?? null, error: reply.error ?? null } }),
            );
            send({ jsonrpc: '2.0', id: requestId, method: params?.method ?? 'unknown', params: params?.params ?? null });
            return;
        }
        case 'askClient': {
            const requestId = `s${nextServerRequestId++}`;
            clientReplies.set(requestId, (reply) => send({ jsonrpc: '2.0', id, result: reply.result ?? null }));
            send({ jsonrpc: '2.0', id: requestId, method: 'window/showMessageRequest', params: params ?? null });
            return;
        }
        case 'shutdown':
            send({ jsonrpc: '2.0', id, result: null });
            return;
        case 'exit':
            if (STUBBORN) {
                return;
            }
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
            openDocuments.set(params?.textDocument?.uri, params?.textDocument?.text ?? '');
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
        case 'textDocument/didChange': {
            const uri = params?.textDocument?.uri;
            const text = params?.contentChanges?.at(-1)?.text;
            if (uri && typeof text === 'string') {
                openDocuments.set(uri, text);
            }
            return;
        }
        case 'textDocument/didClose':
            openDocuments.delete(params?.textDocument?.uri);
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

process.stdin.on('end', () => {
    if (!STUBBORN) {
        process.exit(0);
    }
});
