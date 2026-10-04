/**
 * Read-only access to files a language server names outside every workspace.
 *
 * clangd answers "go to definition" on `std::string_view` with a libstdc++
 * header. That file is real and worth reading, but it is not a workspace
 * document, and handing the browser its host path would turn a definition
 * result into a general file-reading endpoint.
 *
 * So the host keeps the path. A successful definition response mints an opaque
 * capability bound to the client, the workspace, the attachment that asked, and
 * the one canonical file the server named; the browser only ever sees that id.
 * Reading back through the capability re-canonicalizes before it opens
 * anything, so replacing the file with a symlink after issuance cannot redirect
 * the read.
 *
 * The same capability, presented on the same attachment, also buys semantic
 * tokens for that one file: the bridge opens it in the attachment's own
 * session just long enough to ask, then closes it.
 *
 * Capabilities expire, are bounded per client, and are revoked when the
 * attachment or the socket goes away.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Largest external source returned to the browser. */
export const EXTERNAL_SOURCE_MAX_BYTES = 2 * 1024 * 1024;

/** Bytes probed for a NUL before the content is accepted as text. */
const BINARY_PROBE_SIZE = 8192;

/** How long an issued capability stays usable. */
export const EXTERNAL_SOURCE_TTL_MS = 30 * 60_000;

/** Capabilities retained per socket; the oldest is evicted beyond this. */
export const MAX_EXTERNAL_SOURCES_PER_CLIENT = 128;

export interface ExternalSourceGrant {
    id: string;
    attachmentId: string;
    workspaceId: string;
    /** Canonical host path. Never leaves the host. */
    canonicalPath: string;
    /** Basename shown in the editor; carries no directory. */
    displayName: string;
    expiresAt: number;
}

export type ExternalSourceFailure =
    | 'unknown-resource'
    | 'expired'
    | 'moved'
    | 'not-a-file'
    | 'too-large'
    | 'binary'
    | 'read-failed'
    | 'cancelled';

/** Why semantic tokens for an external source could not be produced. */
export type ExternalSemanticTokensFailure =
    | ExternalSourceFailure
    | 'unsupported'
    | 'in-use'
    | 'failed';

export type ExternalSourceRead =
    | { ok: true; content: string; displayName: string; languageHint: string }
    | { ok: false; reason: ExternalSourceFailure };

/**
 * One socket's issued capabilities. Insertion-ordered, so the eviction bound
 * drops the least recently issued rather than an arbitrary entry.
 */
export class ExternalSourceRegistry {
    private readonly grants = new Map<string, ExternalSourceGrant>();
    /** `attachmentId\0canonicalPath` → grant id, so repeated locations reuse one. */
    private readonly byTarget = new Map<string, string>();
    private readonly now: () => number;
    private readonly ttlMs: number;
    private readonly limit: number;

    constructor(options?: { now?: () => number; ttlMs?: number; limit?: number }) {
        this.now = options?.now ?? Date.now;
        this.ttlMs = options?.ttlMs ?? EXTERNAL_SOURCE_TTL_MS;
        this.limit = options?.limit ?? MAX_EXTERNAL_SOURCES_PER_CLIENT;
    }

    get size(): number {
        return this.grants.size;
    }

    /**
     * Issue, or re-issue, a capability for one canonical file on one
     * attachment. Repeated locations in the same response share an id, and a
     * later response refreshes the expiry instead of growing the registry.
     */
    issue(params: {
        attachmentId: string;
        workspaceId: string;
        canonicalPath: string;
        displayName: string;
    }): ExternalSourceGrant {
        const targetKey = `${params.attachmentId}\0${canonicalKey(params.canonicalPath)}`;
        const existingId = this.byTarget.get(targetKey);
        const existing = existingId ? this.grants.get(existingId) : undefined;
        if (existing) {
            existing.expiresAt = this.now() + this.ttlMs;
            return existing;
        }
        const grant: ExternalSourceGrant = {
            id: crypto.randomBytes(24).toString('base64url'),
            attachmentId: params.attachmentId,
            workspaceId: params.workspaceId,
            canonicalPath: params.canonicalPath,
            displayName: params.displayName,
            expiresAt: this.now() + this.ttlMs,
        };
        this.grants.set(grant.id, grant);
        this.byTarget.set(targetKey, grant.id);
        while (this.grants.size > this.limit) {
            const oldest = this.grants.keys().next();
            if (oldest.done) break;
            this.revoke(oldest.value);
        }
        return grant;
    }

    /**
     * The grant for `id`, only when the caller owns it. A forged, expired,
     * cross-workspace or cross-attachment id resolves to nothing.
     */
    resolve(id: string, scope: { attachmentId: string; workspaceId: string }): ExternalSourceGrant | undefined {
        const grant = this.grants.get(id);
        if (!grant) {
            return undefined;
        }
        if (grant.expiresAt <= this.now()) {
            this.revoke(id);
            return undefined;
        }
        if (grant.attachmentId !== scope.attachmentId || grant.workspaceId !== scope.workspaceId) {
            return undefined;
        }
        return grant;
    }

    revoke(id: string): void {
        const grant = this.grants.get(id);
        if (!grant) {
            return;
        }
        this.grants.delete(id);
        this.byTarget.delete(`${grant.attachmentId}\0${canonicalKey(grant.canonicalPath)}`);
    }

    revokeAttachment(attachmentId: string): void {
        for (const [id, grant] of [...this.grants]) {
            if (grant.attachmentId === attachmentId) {
                this.revoke(id);
            }
        }
    }

    clear(): void {
        this.grants.clear();
        this.byTarget.clear();
    }
}

/** Case-folded on Windows, where two spellings name the same file. */
function canonicalKey(canonicalPath: string): string {
    return process.platform === 'win32' ? canonicalPath.toLowerCase() : canonicalPath;
}

/**
 * Canonical path for a host file, or undefined when it is not a readable
 * regular file. Resolving symlinks here is what binds a capability to a file
 * rather than to a name that can later point somewhere else.
 */
export async function canonicalizeExternalFile(absolutePath: string): Promise<string | undefined> {
    try {
        const resolved = await fs.promises.realpath(absolutePath);
        const stats = await fs.promises.stat(resolved);
        return stats.isFile() ? resolved : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Read the one file a grant authorizes. Identity is rechecked against the
 * filesystem first, so the read follows the capability rather than the path.
 */
export async function readExternalSource(
    grant: ExternalSourceGrant,
    signal?: AbortSignal,
): Promise<ExternalSourceRead> {
    if (signal?.aborted) {
        return { ok: false, reason: 'cancelled' };
    }
    const canonical = await canonicalizeExternalFile(grant.canonicalPath);
    if (!canonical) {
        return { ok: false, reason: 'not-a-file' };
    }
    if (canonicalKey(canonical) !== canonicalKey(grant.canonicalPath)) {
        // The path now resolves somewhere else — a replaced symlink. The
        // capability named a file, not a name, so this is a miss, not a read.
        return { ok: false, reason: 'moved' };
    }
    let buffer: Buffer;
    try {
        const stats = await fs.promises.stat(canonical);
        if (stats.size > EXTERNAL_SOURCE_MAX_BYTES) {
            return { ok: false, reason: 'too-large' };
        }
        buffer = await fs.promises.readFile(canonical, { signal });
    } catch (err) {
        if (signal?.aborted || (err as { name?: string })?.name === 'AbortError') {
            return { ok: false, reason: 'cancelled' };
        }
        return { ok: false, reason: 'read-failed' };
    }
    if (signal?.aborted) {
        return { ok: false, reason: 'cancelled' };
    }
    // Content, not extension, decides. A libstdc++ header such as
    // `<string_view>` has no extension at all, so a name-based classifier would
    // reject the very files this feature exists to open.
    const probe = Math.min(buffer.length, BINARY_PROBE_SIZE);
    for (let i = 0; i < probe; i++) {
        if (buffer[i] === 0) {
            return { ok: false, reason: 'binary' };
        }
    }
    return {
        ok: true,
        content: buffer.toString('utf-8'),
        displayName: grant.displayName,
        languageHint: path.extname(canonical).replace(/^\./, '').toLowerCase(),
    };
}

/**
 * The semantic-tokens request a session can answer for a whole external file:
 * `full` when advertised, otherwise `range` spanning every line. Read from the
 * `initialize` capabilities, then from a later dynamic registration. Undefined
 * when the server offers neither, so no request is made at all.
 */
export function externalSemanticTokensRequest(
    state: { capabilities?: Record<string, unknown>; dynamicRegistrations?: { method: string; registerOptions?: unknown }[] },
    content: string,
): { method: string; params: Record<string, unknown> } | undefined {
    const options = [
        state.capabilities?.semanticTokensProvider,
        ...(state.dynamicRegistrations ?? [])
            .filter((registration) => registration.method === 'textDocument/semanticTokens')
            .map((registration) => registration.registerOptions),
    ];
    const offered = (value: unknown) => value === true || (typeof value === 'object' && value !== null);
    let range = false;
    for (const option of options) {
        if (!option || typeof option !== 'object') {
            continue;
        }
        const { full, range: ranged } = option as { full?: unknown; range?: unknown };
        if (offered(full)) {
            return { method: 'textDocument/semanticTokens/full', params: {} };
        }
        range ||= offered(ranged);
    }
    if (!range) {
        return undefined;
    }
    const lines = content.split('\n');
    return {
        method: 'textDocument/semanticTokens/range',
        params: {
            range: {
                start: { line: 0, character: 0 },
                end: { line: lines.length - 1, character: lines[lines.length - 1].length },
            },
        },
    };
}

/** Why an external read failed, in words the editor can show. */
export function describeExternalSourceFailure(reason: ExternalSourceFailure): string {
    switch (reason) {
        case 'unknown-resource':
            return 'That definition source is no longer available.';
        case 'expired':
            return 'That definition source expired. Run Go to Definition again.';
        case 'moved':
            return 'That definition source moved or was replaced.';
        case 'not-a-file':
            return 'That definition source is missing.';
        case 'too-large':
            return 'That definition source is too large to display.';
        case 'binary':
            return 'That definition source is not a text file.';
        case 'cancelled':
            return 'Reading the definition source was cancelled.';
        default:
            return 'Failed to read the definition source.';
    }
}
