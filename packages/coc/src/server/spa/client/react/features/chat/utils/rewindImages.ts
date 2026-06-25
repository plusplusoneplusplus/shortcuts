import type { ChatAttachment } from '../../../types/attachments';
import { getAttachmentCategory } from '../../../types/attachments';

/** Parse the MIME type out of a `data:<mime>;base64,...` URL, if present. */
function parseDataUrlMime(dataUrl: string): string | null {
    const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
    return match ? match[1] : null;
}

/** Estimate the decoded byte size of a base64 data URL (best-effort). */
function estimateDataUrlBytes(dataUrl: string): number {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx < 0) return 0;
    const b64 = dataUrl.slice(commaIdx + 1);
    if (!b64) return 0;
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Reconstruct composer attachments from the base64 image data URLs returned by
 * a rewind (`TurnRewindResponse.restored.images`).
 *
 * The rewind payload only carries the raw data URLs — the original file name
 * and size are not persisted on the turn — so we synthesize a file name and
 * derive the MIME type from the data-URL prefix. Non-string / non-data-URL
 * entries are skipped defensively. The result is suitable for
 * `useFileAttachments().restoreAttachments(...)`.
 */
export function rewindImagesToAttachments(images: string[] | undefined): ChatAttachment[] {
    if (!images || images.length === 0) return [];
    const out: ChatAttachment[] = [];
    images.forEach((dataUrl, i) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return;
        const mimeType = parseDataUrlMime(dataUrl) ?? 'image/png';
        const ext = mimeType.split('/')[1]?.split('+')[0] || 'png';
        const name = `rewound-image-${i + 1}.${ext}`;
        out.push({
            id: crypto.randomUUID(),
            name,
            mimeType,
            size: estimateDataUrlBytes(dataUrl),
            dataUrl,
            category: getAttachmentCategory(mimeType, name),
        });
    });
    return out;
}
