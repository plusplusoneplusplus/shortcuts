// A deterministic stdio LSP: deliberately reject Monaco's zero-based trigger kinds.
const documents = new Map();
let buffer = Buffer.alloc(0);

function reply(id, result, error) {
    const body = JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) });
    process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function handle(message) {
    const { id, method, params } = message;
    if (method === 'initialize') {
        reply(id, {
            capabilities: {
                textDocumentSync: 1,
                completionProvider: { triggerCharacters: ['.'] },
            },
        });
    } else if (method === 'textDocument/didOpen') {
        documents.set(params.textDocument.uri, params.textDocument.text);
    } else if (method === 'textDocument/didChange') {
        documents.set(params.textDocument.uri, params.contentChanges.at(-1).text);
    } else if (method === 'textDocument/didClose') {
        documents.delete(params.textDocument.uri);
    } else if (method === 'textDocument/completion') {
        const { triggerKind, triggerCharacter } = params.context ?? {};
        if (![1, 2, 3].includes(triggerKind) || (triggerCharacter && triggerKind !== 2)) {
            reply(id, null, { code: -32602, message: 'Invalid LSP completion trigger' });
            return;
        }
        const text = documents.get(params.textDocument.uri);
        if (typeof text !== 'string') {
            reply(id, null, { code: -32602, message: 'Document is not open' });
            return;
        }
        const { line, character } = params.position;
        const lineText = text.split('\n')[line] ?? '';
        const prefix = lineText.slice(0, character).match(/[\w$]*$/)[0];
        const suffix = lineText.slice(character).match(/^[\w$]*/)[0];
        reply(id, {
            isIncomplete: false,
            items: [{
                label: 'srvWidget',
                kind: 6,
                detail: 'Fake server completion',
                textEdit: {
                    newText: 'srvWidget',
                    insert: {
                        start: { line, character: character - prefix.length },
                        end: { line, character },
                    },
                    replace: {
                        start: { line, character: character - prefix.length },
                        end: { line, character: character + suffix.length },
                    },
                },
            }],
        });
    } else if (method === 'shutdown') {
        reply(id, null);
    } else if (method === 'exit') {
        process.exit(0);
    } else if (id !== undefined) {
        reply(id, null, { code: -32601, message: `Unsupported method: ${method}` });
    }
}

process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const length = Number(/^Content-Length:\s*(\d+)$/im.exec(header)?.[1]);
        if (!Number.isSafeInteger(length) || length < 0) {
            throw new Error('Invalid Content-Length');
        }
        const end = headerEnd + 4 + length;
        if (buffer.length < end) return;
        const message = JSON.parse(buffer.subarray(headerEnd + 4, end).toString('utf8'));
        buffer = buffer.subarray(end);
        handle(message);
    }
});
