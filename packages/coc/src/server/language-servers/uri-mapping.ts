/**
 * Translation between browser document identity and host file URIs.
 *
 * The browser never learns a host filesystem path. It addresses a document as
 * `coc-file://<workspaceId>/<relative/path>`, and this module maps that onto
 * the owning host's `file://` URI on the way in and back again on the way out.
 * Anything the server reports from outside the workspace root keeps its own
 * URI, so the client can treat it as an external, read-only target instead of
 * mistaking it for a live repo document.
 *
 * The mapping is also the access check: a request whose URI does not resolve to
 * a file inside the client's own workspace is refused rather than forwarded, so
 * a language-server message can never reach an arbitrary path.
 */

import * as path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import { normalizeRelativePath } from './file-match';

/** Scheme used for every document the browser owns. */
export const BROWSER_URI_SCHEME = 'coc-file';

/** Why a document path or URI could not be mapped to a host file. */
export type UriMappingFailure = 'empty-path' | 'absolute-path' | 'escapes-workspace' | 'foreign-workspace' | 'unsupported-scheme';

export type ResolvedDocument = { ok: true; relativePath: string; absolutePath: string; uri: string };
export type DocumentResolution = ResolvedDocument | { ok: false; reason: UriMappingFailure };

/** JSON payload keys that carry a document URI in the LSP specification. */
const URI_KEYS = new Set(['uri', 'targetUri', 'newUri', 'oldUri', 'rootUri', 'documentUri', 'externalUri']);

/**
 * Browser-facing identity of a document. Workspace identity is part of the URI
 * so a response can never be applied to the same relative path in a different
 * workspace.
 */
export function browserDocumentUri(workspaceId: string, relativePath: string): string {
    const segments = normalizeRelativePath(relativePath)
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment));
    return `${BROWSER_URI_SCHEME}://${encodeURIComponent(workspaceId)}/${segments.join('/')}`;
}

/** Inverse of {@link browserDocumentUri}; undefined for any other URI. */
export function parseBrowserDocumentUri(uri: string): { workspaceId: string; relativePath: string } | undefined {
    const prefix = `${BROWSER_URI_SCHEME}://`;
    if (!uri.startsWith(prefix)) {
        return undefined;
    }
    const rest = uri.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) {
        return undefined;
    }
    let workspaceId: string;
    let relativePath: string;
    try {
        workspaceId = decodeURIComponent(rest.slice(0, slash));
        relativePath = rest
            .slice(slash + 1)
            .split('/')
            .map((segment) => decodeURIComponent(segment))
            .join('/');
    } catch {
        return undefined;
    }
    if (workspaceId.length === 0) {
        return undefined;
    }
    return { workspaceId, relativePath };
}

/**
 * Resolve a workspace-relative path against its root, refusing anything that
 * leaves the workspace. Returns the host `file://` URI to send to the server.
 */
export function resolveWorkspaceDocument(workspaceRoot: string, relativePath: string): DocumentResolution {
    const normalized = normalizeRelativePath(relativePath);
    if (normalized.length === 0) {
        return { ok: false, reason: 'empty-path' };
    }
    if (path.isAbsolute(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
        return { ok: false, reason: 'absolute-path' };
    }
    const absolutePath = path.resolve(workspaceRoot, normalized);
    if (!isInsideRoot(workspaceRoot, absolutePath)) {
        return { ok: false, reason: 'escapes-workspace' };
    }
    return { ok: true, relativePath: normalized, absolutePath, uri: pathToFileURL(absolutePath).href };
}

/** True when `candidate` is the root itself or lives beneath it. */
export function isInsideRoot(root: string, candidate: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    if (relative.length === 0) {
        return true;
    }
    if (path.isAbsolute(relative)) {
        return false;
    }
    return !relative.split(path.sep).includes('..');
}

/**
 * Host `file://` URI for a browser document URI, or the reason it is refused.
 * `workspaceId` and `workspaceRoot` describe the connection's own workspace, so
 * a URI naming any other workspace is rejected.
 */
export function toServerUri(
    uri: string,
    workspaceId: string,
    workspaceRoot: string,
): { ok: true; uri: string } | { ok: false; reason: UriMappingFailure } {
    const parsed = parseBrowserDocumentUri(uri);
    if (!parsed) {
        return { ok: false, reason: 'unsupported-scheme' };
    }
    if (parsed.workspaceId !== workspaceId) {
        return { ok: false, reason: 'foreign-workspace' };
    }
    const resolved = resolveWorkspaceDocument(workspaceRoot, parsed.relativePath);
    if (!resolved.ok) {
        return resolved;
    }
    return { ok: true, uri: resolved.uri };
}

/**
 * Browser URI for a host URI. A `file://` URI inside the workspace becomes a
 * `coc-file://` document; anything else — a dependency in another checkout, an
 * `untitled:` buffer, a custom scheme — is returned untouched.
 */
export function toBrowserUri(uri: string, workspaceId: string, workspaceRoot: string): string {
    if (!uri.startsWith('file:')) {
        return uri;
    }
    let absolutePath: string;
    try {
        absolutePath = fileURLToPath(uri);
    } catch {
        return uri;
    }
    if (!isInsideRoot(workspaceRoot, absolutePath)) {
        return uri;
    }
    const relative = path.relative(path.resolve(workspaceRoot), absolutePath);
    if (relative.length === 0) {
        return uri;
    }
    return browserDocumentUri(workspaceId, relative.split(path.sep).join('/'));
}

/**
 * Deep copy of an LSP payload with every URI field translated by `translate`.
 *
 * Returning `undefined` from `translate` rejects the whole payload, which is how
 * an inbound message naming a file outside the workspace is refused instead of
 * being forwarded with a partially translated body.
 */
export function translateUris(value: unknown, translate: (uri: string) => string | undefined): { ok: true; value: unknown } | { ok: false; uri: string } {
    let rejected: string | undefined;

    const walk = (input: unknown, insideUriKey: boolean): unknown => {
        if (rejected !== undefined) {
            return input;
        }
        if (typeof input === 'string') {
            if (!insideUriKey) {
                return input;
            }
            const mapped = translate(input);
            if (mapped === undefined) {
                rejected = input;
                return input;
            }
            return mapped;
        }
        if (Array.isArray(input)) {
            return input.map((entry) => walk(entry, insideUriKey));
        }
        if (input !== null && typeof input === 'object') {
            const output: Record<string, unknown> = {};
            for (const [key, entry] of Object.entries(input as Record<string, unknown>)) {
                output[key] = walk(entry, URI_KEYS.has(key));
            }
            return output;
        }
        return input;
    };

    const result = walk(value, false);
    if (rejected !== undefined) {
        return { ok: false, uri: rejected };
    }
    return { ok: true, value: result };
}
