/**
 * screenshotAttachment — turn a desktop-pushed screenshot PNG into a chat attachment.
 *
 * The CoC desktop shell (packages/coc-desktop) captures + annotates a screenshot,
 * then pushes the flattened PNG data URL to the main SPA window over the
 * `coc-desktop:screenshot-attach` channel (AC-04 chat-attach sink). This module
 * is the pure, framework-free receive handler: it validates the data URL, enforces
 * the same attachment limits the paste/file pipeline enforces (MAX_ATTACHMENTS and
 * MAX_FILE_SIZE), and builds a `ChatAttachment` the composer can drop straight into
 * its draft. Kept a plain function (no React) so the limit logic is unit-testable.
 */

import type { ChatAttachment } from '../../../types/attachments';
import {
    MAX_ATTACHMENTS,
    MAX_FILE_SIZE,
    MAX_FILE_SIZE_LABEL,
    getAttachmentCategory,
} from '../../../types/attachments';

/**
 * Estimate the decoded byte size of a base64 data URL without materializing the
 * bytes. Every 4 base64 chars encode 3 bytes; trailing `=` padding trims 1–2.
 * Non-base64 / malformed URLs fall back to the raw payload length, which only
 * over-estimates (so the size guard stays conservative).
 */
export function estimateDataUrlBytes(dataUrl: string): number {
    if (typeof dataUrl !== 'string') return 0;
    const comma = dataUrl.indexOf(',');
    const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const len = payload.length;
    if (len === 0) return 0;
    if (comma >= 0 && /;base64$/i.test(dataUrl.slice(0, comma))) {
        const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
        return Math.max(0, Math.floor((len * 3) / 4) - padding);
    }
    return len;
}

/** Outcome of {@link buildScreenshotAttachment}: an attachment, or a reason it was rejected. */
export interface BuildScreenshotAttachmentResult {
    /** The attachment to add, or null when rejected (see `error`). */
    attachment: ChatAttachment | null;
    /** A user-facing rejection reason, or null on success. */
    error: string | null;
}

/**
 * Build a `ChatAttachment` from a pushed screenshot PNG data URL, enforcing the
 * composer's attachment limits against the CURRENT attachment count:
 *   - reject a non-image data URL,
 *   - reject once `currentCount >= maxAttachments` (defaults to the global
 *     `MAX_ATTACHMENTS`, but a composer with a smaller cap passes its own),
 *   - reject when the decoded size exceeds `MAX_FILE_SIZE`.
 * On success the attachment is `category: 'image'` with the given `dataUrl` and a
 * timestamped `screenshot-<ms>.png` name. `now` is injectable for deterministic tests.
 */
export function buildScreenshotAttachment(
    dataUrl: string,
    currentCount: number,
    maxAttachments: number = MAX_ATTACHMENTS,
    now: number = Date.now(),
): BuildScreenshotAttachmentResult {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return { attachment: null, error: 'Screenshot is not a valid image.' };
    }
    if (currentCount >= maxAttachments) {
        return { attachment: null, error: `Maximum ${maxAttachments} attachments allowed.` };
    }
    const size = estimateDataUrlBytes(dataUrl);
    if (size > MAX_FILE_SIZE) {
        return {
            attachment: null,
            error: `Screenshot exceeds the ${MAX_FILE_SIZE_LABEL} limit.`,
        };
    }
    const mimeMatch = /^data:([^;,]+)/.exec(dataUrl);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const name = `screenshot-${now}.png`;
    return {
        attachment: {
            id: crypto.randomUUID(),
            name,
            mimeType,
            size,
            dataUrl,
            category: getAttachmentCategory(mimeType, name),
        },
        error: null,
    };
}
