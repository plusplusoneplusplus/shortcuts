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
 * If `filePath` points to a readable image file (by extension), read it and
 * return a `data:image/<mime>;base64,…` string.  Returns `null` when the file
 * is not an image, doesn't exist, is too large, or any other error occurs.
 */
export function tryConvertImageFileToDataUrl(filePath: string): string | null {
    try {
        const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
        const mime = IMAGE_EXTENSIONS[ext];
        if (!mime) return null;

        const stat = fs.statSync(filePath);
        if (!stat.isFile() || stat.size > MAX_IMAGE_FILE_SIZE) return null;

        const data = fs.readFileSync(filePath);
        return `data:${mime};base64,${data.toString('base64')}`;
    } catch {
        return null;
    }
}
