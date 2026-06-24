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
    | 'read-error'
    /**
     * The bytes are a recognizable image format that Claude's base64 image
     * source does not accept (e.g. HEIC/AVIF/BMP/TIFF/ICO). Recorded so the drop
     * is visible in diagnostics instead of vanishing silently.
     */
    | 'unsupported-format';

/**
 * Safe, sanitized metadata describing a skipped Claude image. Carries only
 * non-sensitive fields (reason, byte size, limit, extension, media/detected
 * type) — never image bytes, prompt text, or credentials.
 */
export interface ClaudeImageSkip {
    reason: ClaudeImageSkipReason;
    /** Decoded byte size when known (e.g. for oversized files). */
    byteSize?: number;
    /** The effective Claude image byte limit that was applied. */
    limit: number;
    extension: string;
    /** Claude media type when the file is (or claims to be) a supported image. */
    mediaType?: ClaudeImageSource['media_type'];
    /** Sniffed format label for `unsupported-format` skips (e.g. 'heic', 'bmp'). */
    detectedFormat?: string;
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

/** Number of leading bytes read to sniff an image's magic number. */
const IMAGE_SNIFF_BYTES = 16;

/**
 * Read the first `length` bytes of a file without loading the whole thing.
 * Returns the bytes actually read, or `null` on any error. Used to sniff an
 * image's magic number cheaply (e.g. for oversized files we never fully read).
 */
function readImageHeader(filePath: string, length: number): Buffer | null {
    let fd: number | undefined;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(length);
        const bytesRead = fs.readSync(fd, buf, 0, length, 0);
        return buf.subarray(0, bytesRead);
    } catch {
        return null;
    } finally {
        if (fd !== undefined) {
            try { fs.closeSync(fd); } catch { /* best-effort */ }
        }
    }
}

/**
 * Detect the Claude-supported raster image media type from a file's leading
 * bytes (magic number). Content-based detection is authoritative: a correctly
 * encoded PNG/JPEG/GIF/WebP is recognized regardless of its filename — so an
 * image whose temp file lost its extension is no longer dropped. Returns `null`
 * when the bytes are not one of the four formats Claude's base64 image source
 * accepts.
 */
export function sniffClaudeImageMediaType(bytes: Buffer): ClaudeImageSource['media_type'] | null {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (bytes.length >= 8
        && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
        return 'image/png';
    }
    // JPEG: FF D8 FF
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    // GIF: "GIF87a" / "GIF89a"
    if (bytes.length >= 6
        && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
        && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
        return 'image/gif';
    }
    // WebP: "RIFF" .... "WEBP"
    if (bytes.length >= 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'image/webp';
    }
    return null;
}

/**
 * Best-effort detection of common image formats that Claude's base64 image
 * source does NOT accept (HEIC/HEIF, AVIF, BMP, TIFF, ICO). Used purely for
 * diagnostics, so a dropped image is logged with a meaningful reason instead of
 * vanishing silently. Returns a short format label or `null`.
 */
export function sniffUnsupportedImageFormat(bytes: Buffer): string | null {
    // BMP: "BM"
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
    // TIFF: little-endian "II*\0" or big-endian "MM\0*"
    if (bytes.length >= 4
        && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
            || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) {
        return 'tiff';
    }
    // ICO: 00 00 01 00
    if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) {
        return 'ico';
    }
    // ISO-BMFF "ftyp" box (HEIC/HEIF/AVIF): "ftyp" at bytes 4-7, brand at 8-11.
    if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        const brand = bytes.subarray(8, 12).toString('latin1').toLowerCase();
        if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
        if (brand.startsWith('hei') || brand.startsWith('hev') || brand.startsWith('mif1') || brand.startsWith('msf1')) {
            return 'heic';
        }
        return 'heif';
    }
    return null;
}

/**
 * Evaluate a file path for use as a Claude base64 image block.
 *
 * Detection is content-first: the file's magic bytes decide the media type, so a
 * correctly encoded PNG/JPEG/GIF/WebP is forwarded even when its temp filename
 * carries a wrong or missing extension (the original silent-drop bug). A
 * supported extension is used only as a fallback when the bytes are not a
 * recognized signature (e.g. synthetic fixtures). The decoded byte length is
 * enforced against {@link MAX_CLAUDE_IMAGE_BYTES} before encoding, so an
 * oversized image is never forwarded. Bytes that are a recognizable but
 * unsupported image format (HEIC/AVIF/BMP/TIFF/ICO) return a sanitized
 * `unsupported-format` skip; anything that is not an image at all returns `null`
 * (an expected, silent skip). Oversized / not-a-regular-file / unreadable cases
 * return a sanitized `{ ok: false, skip }` so the caller can record safe
 * diagnostics without ever touching image bytes.
 */
export function evaluateClaudeImageFile(filePath: string): ClaudeImageEvaluation | null {
    const extension = path.extname(filePath).replace(/^\./, '').toLowerCase();
    const extensionMediaType = CLAUDE_IMAGE_MEDIA_TYPES[extension];

    let stat: fs.Stats;
    try {
        stat = fs.statSync(filePath);
    } catch {
        // Unreadable. Diagnose as a skip only when the name claims a supported
        // image extension; otherwise it's an unknown non-image → silent.
        return extensionMediaType
            ? { ok: false, skip: { reason: 'read-error', limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType: extensionMediaType } }
            : null;
    }

    if (!stat.isFile()) {
        return extensionMediaType
            ? { ok: false, skip: { reason: 'not-a-regular-file', limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType: extensionMediaType } }
            : null;
    }

    if (stat.size > MAX_CLAUDE_IMAGE_BYTES) {
        // Too large to forward. Sniff a small header so an oversized image with a
        // wrong/missing extension is still reported (not silently dropped).
        const header = readImageHeader(filePath, IMAGE_SNIFF_BYTES);
        const sniffedMediaType = header ? sniffClaudeImageMediaType(header) : null;
        const detectedFormat = header ? sniffUnsupportedImageFormat(header) : null;
        const mediaType = sniffedMediaType ?? extensionMediaType;
        if (mediaType || detectedFormat) {
            return {
                ok: false,
                skip: {
                    reason: 'too-large',
                    byteSize: stat.size,
                    limit: MAX_CLAUDE_IMAGE_BYTES,
                    extension,
                    ...(mediaType ? { mediaType } : {}),
                    ...(detectedFormat ? { detectedFormat } : {}),
                },
            };
        }
        return null;
    }

    let data: Buffer;
    try {
        data = fs.readFileSync(filePath);
    } catch {
        return extensionMediaType
            ? { ok: false, skip: { reason: 'read-error', limit: MAX_CLAUDE_IMAGE_BYTES, extension, mediaType: extensionMediaType } }
            : null;
    }
    // Defensive: enforce the limit against the actual decoded byte length too,
    // in case stat under-reported (e.g. a file that grew between stat and read).
    if (data.length > MAX_CLAUDE_IMAGE_BYTES) {
        const mediaType = sniffClaudeImageMediaType(data) ?? extensionMediaType;
        return {
            ok: false,
            skip: {
                reason: 'too-large',
                byteSize: data.length,
                limit: MAX_CLAUDE_IMAGE_BYTES,
                extension,
                ...(mediaType ? { mediaType } : {}),
            },
        };
    }

    // Content-first detection: the actual bytes win over the filename.
    const mediaType = sniffClaudeImageMediaType(data) ?? extensionMediaType;
    if (mediaType) {
        return {
            ok: true,
            source: { media_type: mediaType, data: data.toString('base64') },
            byteSize: data.length,
            extension,
            mediaType,
        };
    }

    // Not a Claude-supported image. Log a diagnostic skip when the bytes are a
    // recognizable-but-unsupported image format; otherwise stay silent (it is
    // not an image at all, e.g. a text/binary attachment).
    const detectedFormat = sniffUnsupportedImageFormat(data);
    if (detectedFormat) {
        return {
            ok: false,
            skip: { reason: 'unsupported-format', limit: MAX_CLAUDE_IMAGE_BYTES, extension, detectedFormat },
        };
    }
    return null;
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
