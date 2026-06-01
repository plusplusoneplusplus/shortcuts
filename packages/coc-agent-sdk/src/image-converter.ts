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

export interface ClaudeImageSource {
    media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    data: string;
}

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
 * Return a Claude-compatible base64 source for supported raster image files.
 * SVG is intentionally excluded because Claude's base64 image source does not
 * accept `image/svg+xml`.
 */
export function tryReadImageAsBase64(filePath: string): ClaudeImageSource | null {
    const image = readImageFile(filePath, CLAUDE_IMAGE_MEDIA_TYPES);
    if (!image) return null;
    return {
        media_type: image.mime as ClaudeImageSource['media_type'],
        data: image.data.toString('base64'),
    };
}
