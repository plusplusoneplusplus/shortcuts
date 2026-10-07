import type { proto } from '@whiskeysockets/baileys';
import { downloadInboundImage, ImageDownloadError } from '../core';
import type { InboundImage } from '../core';

/** The media key from the admitted message authenticates/decrypts the WhatsApp download. */
export function createWhatsAppImage(image: proto.Message.IImageMessage, lifetimeSignal: AbortSignal): InboundImage {
    const mimeType = image.mimetype?.split(';')[0].trim().toLowerCase() ?? '';
    return {
        mimeType,
        download: options => downloadInboundImage(mimeType, async signal => {
            // Always use Baileys' fixed media origin. Never fetch an inbound arbitrary URL or redirect.
            if (!image.directPath?.startsWith('/') || image.directPath.startsWith('//')
                || !image.mediaKey || image.mediaKey.length !== 32) {
                throw new ImageDownloadError('download');
            }
            if (image.fileLength != null) {
                const size = Number(image.fileLength.toString());
                if (Number.isFinite(size) && size > options.maxBytes) throw new ImageDownloadError('size-limit');
            }
            const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
            signal.throwIfAborted();
            return downloadContentFromMessage({ directPath: image.directPath, mediaKey: image.mediaKey }, 'image', {
                options: { signal, timeout: Math.min(options.timeoutMs ?? 30_000, 30_000), maxRedirects: 0 },
            });
        }, options, lifetimeSignal),
    };
}
