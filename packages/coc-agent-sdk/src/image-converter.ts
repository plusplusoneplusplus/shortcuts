import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Image file → data URL conversion (for view tool results)
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
};

/** Max image file size we'll convert to a data URL (10 MB). */
const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Explicit Claude SDK image-size boundary.
 *
 * Claude image attachments must be size-checked at the Claude provider boundary
 * before being converted into Claude base64 image blocks. The limit reuses the
 * shared {@link MAX_IMAGE_FILE_SIZE} (10 MB) so all CoC image limits stay
 * consistent (see `attachment-utils.MAX_ATTACHMENT_SIZE`, also 10 MB). It is
 * exported (rather than left hidden inside the incidental shared read helper) so
 * the Claude path makes the boundary clear and tests can reference it instead of
 * hard-coding a magic number.
 */
export const MAX_CLAUDE_IMAGE_BYTES = MAX_IMAGE_FILE_SIZE;

export interface ClaudeImageSource {
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
}

/** Why a candidate Claude image attachment was not forwarded as an image block. */
export type ClaudeImageSkipReason =
    /** The file is too large once its bytes are read/decoded. */
    | 'too-large'
    /** The path is not a regular file (e.g. a directory). */
    | 'not-a-regular-file'
    /** stat/read failed (missing file, permission error, etc.). */
    | 'read-error';

/**
 * Safe, sanitized metadata describing a skipped Claude image. Carries only
 * non-sensitive fields (reason, byte size, limit, extension, media type) — never
 * image bytes, prompt text, or credentials.
 */
export interface ClaudeImageSkip {
    reason: ClaudeImageSkipReason;
    /** Decoded byte size when known (e.g. for oversized files). */
    byteSize?: number;
    /** The effective Claude image byte limit that was applied. */
    limit: number;
    extension: string;
    mediaType: ClaudeImageSource['media_type'];
}

/**
 * Result of evaluating a single file path for Claude image suitability: either a
 * forwardable base64 image source plus its metadata, or a sanitized skip record.
 * Unsupported extensions (SVG, non-images) return `null` so callers can ignore
 * them silently — they are an expected, non-diagnostic case.
 */
export type ClaudeImageEvaluation =
    | { ok: true; source: ClaudeImageSource; byteSize: number; extension: string; mediaType: ClaudeImageSource['media_type'] }
    | { ok: false; skip: ClaudeImageSkip };

const CLAUDE_IMAGE_MEDIA_TYPES: Record<string, ClaudeImageSource['media_type']> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};

const CODEX_IMAGE_EXTENSIONS = new Set(Object.keys(CLAUDE_IMAGE_MEDIA_TYPES));

export function isImageFilePath(filePath: string): boolean {
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
    return ext in IMAGE_EXTENSIONS;
}

export function isSupportedCodexImagePath(filePath: string): boolean {
    const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
    return CODEX_IMAGE_EXTENSIONS.has(ext);
}

function readImageFile(filePath: string, mimeByExtension: Record<string, string>): { mime: string; data: Buffer } | null {
    try {
        const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
        const mime = mimeByExtension[ext];
        if (!mime) return null;

        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_IMAGE_FILE_SIZE) return null;

        return { mime, data: fs.readFileSync(filePath) };
    } catch {
        return null;
    }
}

/**
 * If `filePath` points to a readable image file (by extension), read it and
 * return a `data:image/<mime>;base64,…` string.  Returns `null` when the file
 * is not an image, doesn't exist, is too large, or any other error occurs.
 */
export function tryConvertImageFileToDataUrl(filePath: string): string | null {
    const image = readImageFile(filePath, IMAGE_EXTENSIONS);
    if (!image) return null;
    return `data:${image.mime};base64,${image.data.toString('base64')}`;
}

/**
 * Evaluate a file path for use as a Claude base64 image block.
 *
 * This is the explicit Claude image-size boundary: the decoded byte length is
 * enforced against {@link MAX_CLAUDE_IMAGE_BYTES} before the data is base64-
 * encoded, so an oversized image is never forwarded to Claude. SVG and other
 * non-Claude-raster extensions return `null` (an expected, silent skip rather
 * than a diagnostic). Supported-extension files that are oversized, not regular
 * files, or unreadable return a sanitized `{ ok: false, skip }` so the caller can
 * record safe diagnostics without touching image bytes.
 */
export function evaluateClaudeImageFile(filePath: string): ClaudeImageEvaluation | null {
    const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
    const mediaType = CLAUDE_IMAGE_MEDIA_TYPES[extension];
    if (!mediaType) return null;

    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch {
        return { ok: false, skip: { reason: 'read-error', limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType } };
    }

    if (!stat.isFile()) {
        return { ok: false, skip: { reason: 'not-a-regular-file', limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType } };
    }
    if (stat.size > MAX_CLAUDE_IMAGE_BYTES) {
        return { ok: false, skip: { reason: 'too-large', byteSize: stat.size, limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType } };
    }

    let data: Buffer;
    try {
        data = fs.readFileSync(filePath);
    } catch {
        return { ok: false, skip: { reason: 'read-error', limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType } };
    }
    // Defensive: enforce the limit against the actual decoded byte length too,
    // in case stat under-reported (e.g. a file that grew between stat and read).
    if (data.length > MAX_CLAUDE_IMAGE_BYTES) {
        return { ok: false, skip: { reason: 'too-large', byteSize: data.length, limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType } };
    }

    return {
        ok: true,
        source: { media_type: mediaType, data: data.toString('base64') },
        byteSize: data.length,
        extension,
        mediaType,
    };
}

/**
 * Return a Claude-compatible base64 source for supported raster image files.
 * SVG is intentionally excluded because Claude's base64 image source does not
 * accept `image/svg+xml`. Delegates to {@link evaluateClaudeImageFile} so the
 * size boundary is enforced in exactly one place.
 */
export function tryReadImageAsBase64(filePath: string): ClaudeImageSource | null {
    const evaluation = evaluateClaudeImageFile(filePath);
    return evaluation?.ok ? evaluation.source : null;
}
