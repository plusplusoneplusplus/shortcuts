/**
 * Shared file-path utilities for the SPA dashboard.
 *
 * - `shortenFilePath` — trims common home-directory prefixes for display.
 * - `FILE_PATH_RE` — regex matching absolute file paths (Unix + Windows).
 * - `linkifyFilePaths` — post-processes HTML to wrap paths in interactive
 *   `.file-path-link` spans (used by the global hover/click delegation in
 *   `file-path-preview.ts`).
 */

import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';

// ── Image file detection ───────────────────────────────────────────────

const IMAGE_MIME_TYPES: Record<string, string> = {
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
};

/** Check whether a file path points to a known image type by extension. */
export function isImageFile(filePath: string): boolean {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return ext in IMAGE_MIME_TYPES;
}

/** Return the MIME type for a known image extension, or `null`. */
export function getImageMimeType(filePath: string): string | null {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    return IMAGE_MIME_TYPES[ext] ?? null;
}

/** Shorten common prefixes for display. */
export function shortenFilePath(p: string): string {
    if (!p) return '';
    return p
        .replace(/^\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^\/Users\/[^/]+\//, '~/')
        .replace(/^\/home\/[^/]+\//, '~/')
        .replace(/^[A-Za-z]:\/Users\/[^/]+\/Documents\/Projects\//, '')
        .replace(/^[A-Za-z]:\/Users\/[^/]+\//, '~/');
}

/**
 * Regex matching absolute file paths — any Unix absolute path with at least
 * two components (`/foo/bar`) and Windows drive-letter paths (`C:\…`).
 *
 * The negative lookbehind `(?<![:/\w])` prevents matching path tails inside
 * URLs (e.g. `https://example.com/api`) and other slash-delimited tokens.
 */
export const FILE_PATH_RE =
    /(?:(?<![:/\w])\/[a-zA-Z][a-zA-Z0-9_.-]*(?:\/[^\s&"'<>()]+)+|(?<![/\w])[A-Za-z]:[/\\][\w./@\\-]+(?::\d+(?:-\d+)?)?)/g;

/**
 * A parsed file-path reference: the bare path plus an optional `:line` /
 * `:startLine-endLine` suffix the model may emit to point at specific lines.
 */
export interface FilePathRef {
    /** The bare path with any trailing `:line`/`:start-end` suffix removed. */
    path: string;
    /** The (start) line number, when a `:line` suffix is present. */
    line?: number;
    /** The end line number, when a `:start-end` range suffix is present. */
    endLine?: number;
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);

/** Whether a path opens the editable source-canvas note surface. */
export function isSourceCanvasNotePath(path: string): boolean {
    const clean = path.split(/[?#]/)[0];
    const ext = clean.split('.').pop()?.toLowerCase() || '';
    return MARKDOWN_EXTENSIONS.has(ext);
}

/** Whether a path opens the source-canvas folder explorer. */
export function isSourceCanvasDirectoryPath(path: string): boolean {
    const clean = toForwardSlashes(path).split(/[?#]/)[0];
    return clean.length > 1 && clean.endsWith('/');
}

/** Whether an href is handled outside of the local source-file link flow. */
export function isExternalFileReferenceHref(href: string): boolean {
    return /^https?:\/\/|^mailto:/i.test(href);
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizeFileUriPath(token: string): string {
    if (!/^file:/i.test(token)) {
        return token;
    }

    try {
        const url = new URL(token);
        if (url.protocol.toLowerCase() !== 'file:') {
            return token;
        }

        let pathname = safeDecodeURIComponent(url.pathname);
        if (/^\/[A-Za-z]:\//.test(pathname)) {
            pathname = pathname.slice(1);
        }

        const host = url.hostname;
        if (host && host.toLowerCase() !== 'localhost') {
            if (/^[A-Za-z]$/.test(host) && pathname.startsWith('/')) {
                return `${host}:${pathname}`;
            }
            return `//${host}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
        }

        return pathname || token;
    } catch {
        const match = token.match(/^file:\/+(.+)$/i);
        if (!match) {
            return token;
        }
        const pathname = safeDecodeURIComponent(match[1]);
        return /^[A-Za-z]:\//.test(pathname) ? pathname : `/${pathname.replace(/^\/+/, '')}`;
    }
}

function splitHashLineRef(token: string): FilePathRef {
    const m = token.match(/^(.*)#L(\d+)(?:-L?(\d+))?$/i);
    if (!m) {
        return { path: token };
    }
    const line = Number(m[2]);
    const endLine = m[3] !== undefined ? Number(m[3]) : undefined;
    return endLine !== undefined
        ? { path: m[1], line, endLine }
        : { path: m[1], line };
}

/**
 * Split an optional trailing `:line` or `:startLine-endLine` suffix from a
 * matched file-path token, or a `#Lline` / `#Lstart-Lend` hash from local file
 * links. Local `file://` URLs are converted to filesystem paths.
 *
 * Examples:
 *   '/a/b.ts'        → { path: '/a/b.ts' }
 *   '/a/b.ts:42'     → { path: '/a/b.ts', line: 42 }
 *   '/a/b.ts:42-58'  → { path: '/a/b.ts', line: 42, endLine: 58 }
 *   'src/foo.ts:42'  → { path: 'src/foo.ts', line: 42 }
 *   'src/foo.ts#L42' → { path: 'src/foo.ts', line: 42 }
 *   'file:///C:/repo/foo.ts#L42' → { path: 'C:/repo/foo.ts', line: 42 }
 *
 * Only a *trailing* numeric suffix is stripped; an interior colon (e.g. a
 * Windows drive letter or `:` inside a directory name) is left untouched.
 */
export function parseFilePathRef(token: string): FilePathRef {
    const hashRef = splitHashLineRef(token);
    const path = normalizeFileUriPath(hashRef.path);
    const m = path.match(/^(.+):(\d+)(?:-(\d+))?$/);
    if (!m) {
        if (hashRef.line === undefined) {
            return { path };
        }
        return hashRef.endLine === undefined
            ? { path, line: hashRef.line }
            : { path, line: hashRef.line, endLine: hashRef.endLine };
    }
    const line = Number(m[2]);
    const endLine = m[3] !== undefined ? Number(m[3]) : undefined;
    const resolvedLine = hashRef.line ?? line;
    const resolvedEndLine = hashRef.endLine ?? endLine;
    return resolvedEndLine !== undefined
        ? { path: m[1], line: resolvedLine, endLine: resolvedEndLine }
        : { path: m[1], line: resolvedLine };
}

/**
 * Post-process HTML to wrap file paths in interactive `.file-path-link` spans.
 * Only operates on text outside HTML tags and `<code>` blocks.
 *
 * A path may carry an optional `:line` or `:start-end` suffix. The resulting
 * span keeps `data-full-path` as the bare path (no suffix) and additionally
 * carries `data-line` / `data-end-line` so click handlers can scroll to and
 * highlight the referenced line(s).
 */
export function linkifyFilePaths(html: string): string {
    let insideCode = 0;
    return html.replace(/(<\/?(code|pre)[^>]*>)|(<[^>]+>)|([^<]+)/gi, (_match, codeTag, _codeTagName, otherTag, text) => {
        if (codeTag) {
            if (codeTag[1] === '/') insideCode = Math.max(0, insideCode - 1);
            else insideCode++;
            return codeTag;
        }
        if (otherTag) return otherTag;
        if (!text || insideCode > 0) return text || '';
        return text.replace(FILE_PATH_RE, (pathMatch: string) => {
            const { path, line, endLine } = parseFilePathRef(pathMatch);
            const normalized = toForwardSlashes(path);
            const suffix = line === undefined
                ? ''
                : endLine === undefined ? `:${line}` : `:${line}-${endLine}`;
            const short = shortenFilePath(normalized) + suffix;
            const lineAttr = line === undefined ? '' : ` data-line="${line}"`;
            const endLineAttr = endLine === undefined ? '' : ` data-end-line="${endLine}"`;
            return `<span class="file-path-link" data-full-path="${normalized}"${lineAttr}${endLineAttr} title="${normalized}${suffix}">${short}</span>`;
        });
    });
}
