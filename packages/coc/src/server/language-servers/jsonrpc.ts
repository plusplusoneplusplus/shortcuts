/**
 * JSON-RPC message framing for the Language Server Protocol.
 *
 * LSP frames every message as `Content-Length: <bytes>\r\n\r\n<utf8 json>`.
 * Nothing here knows about a particular language or transport: the reader takes
 * byte chunks from any stream and the writer produces bytes for any stream.
 */

/** A JSON value as it appears in a JSON-RPC payload. */
export type JsonRpcValue = string | number | boolean | null | JsonRpcValue[] | { [key: string]: JsonRpcValue };

/** Request and response correlation ids may be numbers or strings. */
export type JsonRpcId = number | string;

export interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: JsonRpcId;
    method: string;
    params?: unknown;
}

export interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params?: unknown;
}

export interface JsonRpcErrorBody {
    code: number;
    message: string;
    data?: unknown;
}

export interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: JsonRpcId | null;
    result?: unknown;
    error?: JsonRpcErrorBody;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

/** Error codes defined by JSON-RPC 2.0 and reused by LSP. */
export const JSON_RPC_ERROR_CODES = {
    parseError: -32700,
    invalidRequest: -32600,
    methodNotFound: -32601,
    invalidParams: -32602,
    internalError: -32603,
    /** LSP: the server or client cancelled the request. */
    requestCancelled: -32800,
    /** LSP: the request's content became stale. */
    contentModified: -32801,
} as const;

/** Frames a message for the wire. Header bytes are ASCII, the body is UTF-8. */
export function encodeMessage(message: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
    return Buffer.concat([header, body]);
}

export function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
    return 'method' in message && 'id' in message && (message as JsonRpcRequest).id !== undefined;
}

export function isNotification(message: JsonRpcMessage): message is JsonRpcNotification {
    return 'method' in message && !('id' in message);
}

export function isResponse(message: JsonRpcMessage): message is JsonRpcResponse {
    return !('method' in message) && 'id' in message;
}

/** Why a chunk could not be turned into a message. */
export type LspFramingErrorReason = 'missing-content-length' | 'invalid-content-length' | 'message-too-large' | 'invalid-json';

export class LspFramingError extends Error {
    readonly reason: LspFramingErrorReason;

    constructor(reason: LspFramingErrorReason, message: string) {
        super(message);
        this.name = 'LspFramingError';
        this.reason = reason;
    }
}

export interface LspMessageReaderOptions {
    /** Called once per complete message, in arrival order. */
    onMessage: (message: JsonRpcMessage) => void;
    /** Called when a frame cannot be decoded. The reader keeps going when it can. */
    onError?: (error: LspFramingError) => void;
    /**
     * Largest accepted body in bytes. A larger declared length is refused
     * instead of buffered, so a bad server cannot exhaust memory.
     */
    maxMessageBytes?: number;
}

const DEFAULT_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const HEADER_SEPARATOR = Buffer.from('\r\n\r\n', 'ascii');

/**
 * Incremental reader for `Content-Length` framed messages.
 *
 * Buffers bytes rather than strings so a multi-byte character split across two
 * chunks decodes correctly, and so the declared length is compared against the
 * byte count the protocol actually specifies.
 */
export class LspMessageReader {
    private buffer: Buffer = Buffer.alloc(0);
    private readonly onMessage: (message: JsonRpcMessage) => void;
    private readonly onError?: (error: LspFramingError) => void;
    private readonly maxMessageBytes: number;

    constructor(options: LspMessageReaderOptions) {
        this.onMessage = options.onMessage;
        this.onError = options.onError;
        this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    }

    /** Feeds bytes from the stream and emits every message they complete. */
    append(chunk: Buffer | string): void {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        this.buffer = this.buffer.length === 0 ? bytes : Buffer.concat([this.buffer, bytes]);
        this.drain();
    }

    /** Drops buffered bytes, for a reconnect that starts a fresh stream. */
    reset(): void {
        this.buffer = Buffer.alloc(0);
    }

    /** Bytes held back waiting for the rest of a frame. Used by tests. */
    get bufferedBytes(): number {
        return this.buffer.length;
    }

    private drain(): void {
        for (;;) {
            const separator = this.buffer.indexOf(HEADER_SEPARATOR);
            if (separator < 0) {
                return;
            }
            const headerText = this.buffer.subarray(0, separator).toString('ascii');
            const contentLength = parseContentLength(headerText);
            if (contentLength === undefined) {
                // The header block is unusable; drop it and resynchronize on the
                // next frame rather than stalling on bytes that never parse.
                this.buffer = this.buffer.subarray(separator + HEADER_SEPARATOR.length);
                this.report(
                    new LspFramingError(
                        headerText.toLowerCase().includes('content-length')
                            ? 'invalid-content-length'
                            : 'missing-content-length',
                        `Unusable message header: ${JSON.stringify(headerText)}`,
                    ),
                );
                continue;
            }
            if (contentLength > this.maxMessageBytes) {
                this.buffer = Buffer.alloc(0);
                this.report(
                    new LspFramingError(
                        'message-too-large',
                        `Message of ${contentLength} bytes exceeds the ${this.maxMessageBytes} byte limit`,
                    ),
                );
                return;
            }
            const bodyStart = separator + HEADER_SEPARATOR.length;
            const bodyEnd = bodyStart + contentLength;
            if (this.buffer.length < bodyEnd) {
                return;
            }
            const body = this.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
            this.buffer = this.buffer.subarray(bodyEnd);
            let message: JsonRpcMessage;
            try {
                message = JSON.parse(body) as JsonRpcMessage;
            } catch (error) {
                this.report(new LspFramingError('invalid-json', `Message body is not JSON: ${String(error)}`));
                continue;
            }
            this.onMessage(message);
        }
    }

    private report(error: LspFramingError): void {
        if (this.onError) {
            this.onError(error);
        }
    }
}

/** Reads `Content-Length` from a header block, ignoring other headers. */
function parseContentLength(headerText: string): number | undefined {
    for (const line of headerText.split('\r\n')) {
        const colon = line.indexOf(':');
        if (colon < 0) {
            continue;
        }
        if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') {
            continue;
        }
        const raw = line.slice(colon + 1).trim();
        if (!/^\d+$/.test(raw)) {
            return undefined;
        }
        return Number.parseInt(raw, 10);
    }
    return undefined;
}
