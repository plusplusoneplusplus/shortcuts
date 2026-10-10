import { hasRasterImageSignature, isRasterImageMimeType } from '../core/inbound-image';
import type { WhatsAppMediaContent, WhatsAppOutboundMedia } from './types';

export const WHATSAPP_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

export type WhatsAppMediaErrorCode = 'invalid' | 'size-limit' | 'disconnected' | 'timeout' | 'send';

/** Safe errors without provider details, filenames or paths; uncertain sends must not be replayed. */
export class WhatsAppMediaError extends Error {
    readonly outcome: 'not-attempted' | 'unknown';

    constructor(readonly code: WhatsAppMediaErrorCode) {
        const messages: Record<WhatsAppMediaErrorCode, string> = {
            invalid: 'Invalid WhatsApp attachment.',
            'size-limit': 'WhatsApp attachment exceeds the 10 MiB limit.',
            disconnected: 'WhatsApp is not connected.',
            timeout: 'WhatsApp attachment send timed out; delivery is unknown.',
            send: 'WhatsApp attachment send failed; delivery is unknown.',
        };
        super(messages[code]);
        this.name = 'WhatsAppMediaError';
        this.outcome = code === 'timeout' || code === 'send' ? 'unknown' : 'not-attempted';
    }
}

/** Pure decoded-byte validation for capture before any outbound message is attempted. */
export function validateWhatsAppMedia(media: WhatsAppOutboundMedia): void {
    if (!media || !Buffer.isBuffer(media.bytes) || !media.bytes.length
        || typeof media.filename !== 'string' || !media.filename.trim()
        || /[/\\\x00-\x1f\x7f]/.test(media.filename)
        || typeof media.mimeType !== 'string'
        || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(media.mimeType)
        || (media.caption !== undefined && typeof media.caption !== 'string')) {
        throw new WhatsAppMediaError('invalid');
    }
    if (media.bytes.length > WHATSAPP_MEDIA_MAX_BYTES) throw new WhatsAppMediaError('size-limit');
    const mimeType = media.mimeType.toLowerCase();
    if (isRasterImageMimeType(mimeType) && !hasRasterImageSignature(mimeType, media.bytes)) {
        throw new WhatsAppMediaError('invalid');
    }
}

export function prepareWhatsAppMedia(media: WhatsAppOutboundMedia): WhatsAppMediaContent {
    validateWhatsAppMedia(media);
    const mimetype = media.mimeType.toLowerCase();
    const metadata = { mimetype, fileName: media.filename, ...(media.caption === undefined ? {} : { caption: media.caption }) };
    if (isRasterImageMimeType(mimetype)) {
        return { image: media.bytes, ...metadata };
    }
    return { document: media.bytes, ...metadata };
}
