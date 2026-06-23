/**
 * attachmentDraftStore — sessionStorage-backed sidecar for composer attachments.
 *
 * Parallels useDraftStore (text drafts in localStorage) but persists pasted/added
 * attachments per browser tab so they survive in-SPA navigation (workspace switch,
 * opening another chat, leaving and returning to the new-chat tab). Text drafts
 * already survive via useDraftStore; this restores the same continuity for images
 * and other attachments, which previously lived only in ephemeral React state.
 *
 * sessionStorage (not localStorage) keeps the data per-tab and bounded: it is
 * cleared automatically when the tab closes, so stale images never accumulate
 * across sessions and quietly fill the quota.
 *
 * Keyed by the same draftKey useDraftStore uses (e.g. `new-chat:<workspaceId>`),
 * so attachment drafts are scoped exactly like the text drafts beside them.
 */

import type { ChatAttachment, AttachmentPayload } from '../../../types/attachments';
import { getAttachmentCategory } from '../../../types/attachments';

const KEY_PREFIX = 'coc.attachmentDraft.';

/**
 * Skip persisting when the serialized payload exceeds this many characters, to
 * avoid sessionStorage quota errors on unusually large attachments. Compressed
 * screenshots are ~100–300 KB base64, so a couple of images stay well under.
 * Base64 data URLs are ASCII, so character count ≈ byte count here.
 */
const MAX_SERIALIZED_CHARS = 2 * 1024 * 1024;

function storageKey(draftKey: string): string {
    return `${KEY_PREFIX}${draftKey}`;
}

/**
 * Persist the current attachments for a draft key. An empty list clears the
 * sidecar so removing the last attachment frees the slot immediately.
 */
export function saveAttachmentDraft(draftKey: string, attachments: ChatAttachment[]): void {
    if (!draftKey) return;
    if (!attachments || attachments.length === 0) {
        clearAttachmentDraft(draftKey);
        return;
    }
    try {
        const payloads: AttachmentPayload[] = attachments.map(a => ({
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
            dataUrl: a.dataUrl,
        }));
        const serialized = JSON.stringify(payloads);
        if (serialized.length > MAX_SERIALIZED_CHARS) {
            console.warn(
                `[coc-attachment-draft] Skipping save for "${draftKey}": serialized size ${serialized.length} exceeds ${MAX_SERIALIZED_CHARS} chars.`,
            );
            return;
        }
        sessionStorage.setItem(storageKey(draftKey), serialized);
    } catch {
        // Quota exceeded or storage disabled — silently ignore.
    }
}

/**
 * Load saved attachments for a draft key, or null when none exist or the stored
 * value is missing/invalid. The client-side `id` is regenerated and `category`
 * is re-derived, since the sidecar only stores the wire payload subset.
 */
export function loadAttachmentDraft(draftKey: string): ChatAttachment[] | null {
    if (!draftKey) return null;
    try {
        const raw = sessionStorage.getItem(storageKey(draftKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return null;
        const restored = parsed
            .filter((p): p is AttachmentPayload =>
                !!p
                && typeof (p as AttachmentPayload).dataUrl === 'string'
                && typeof (p as AttachmentPayload).name === 'string'
                && typeof (p as AttachmentPayload).mimeType === 'string',
            )
            .map((p): ChatAttachment => ({
                id: crypto.randomUUID(),
                name: p.name,
                mimeType: p.mimeType,
                size: typeof p.size === 'number' ? p.size : 0,
                dataUrl: p.dataUrl,
                category: getAttachmentCategory(p.mimeType, p.name),
            }));
        return restored.length > 0 ? restored : null;
    } catch {
        return null;
    }
}

/** Remove the saved attachments for a draft key. */
export function clearAttachmentDraft(draftKey: string): void {
    if (!draftKey) return;
    try {
        sessionStorage.removeItem(storageKey(draftKey));
    } catch {
        // Storage disabled — silently ignore.
    }
}
