import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MAX_ATTACHMENT_SIZE, parseGenericDataUrl } from '../core/attachment-utils';

export const mirrorAttachmentSchema = z.object({
    name: z.string().min(1).max(200).refine(name => !!name.trim() && !/[/\\\x00-\x1f\x7f]/.test(name)),
    mimeType: z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
    size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    data: z.string().max(Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4).optional(),
}).strict();

export type MirrorAttachment = z.infer<typeof mirrorAttachmentSchema>;
export interface MirrorUploadSource {
    attachments?: unknown;
    images?: unknown;
}

export class MirrorAttachmentError extends Error {
    constructor(detail: string) {
        super(`Sentinel mirror: ${detail} The submission was not accepted; no text or files were forwarded.`);
    }
}

/** Only request-upload bytes grant authority. SDK paths, paste cards and references never do. */
export function captureMirrorUploads(source: MirrorUploadSource): MirrorAttachment[] {
    if ((source.attachments != null && !Array.isArray(source.attachments))
        || (source.images != null && !Array.isArray(source.images))) {
        throw new MirrorAttachmentError('Uploaded attachment metadata is malformed.');
    }
    const nativeUploads = Array.isArray(source.attachments) && source.attachments.length > 0;
    const raw = nativeUploads && Array.isArray(source.attachments)
        ? source.attachments
        : Array.isArray(source.images) ? source.images.map((dataUrl, index) => ({
            name: `image-${index + 1}`, dataUrl,
        })) : [];
    if (raw.length > 10) throw new MirrorAttachmentError('At most 10 uploaded attachments are supported.');
    let total = 0;
    return raw.map(value => {
        if (!value || typeof value !== 'object' || !('dataUrl' in value)
            || typeof value.dataUrl !== 'string' || !('name' in value) || typeof value.name !== 'string') {
            throw new MirrorAttachmentError('Only uploaded attachments are supported; file references cannot be forwarded.');
        }
        if (nativeUploads && (!('size' in value) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size)
            || value.size < 0 || value.size > MAX_ATTACHMENT_SIZE)) {
            throw new MirrorAttachmentError('Uploaded attachment size metadata is missing or exceeds 10 MiB.');
        }
        if (value.dataUrl.length > Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4 + 256) {
            throw new MirrorAttachmentError('Uploaded attachments must total at most 10 MiB.');
        }
        const parsed = parseGenericDataUrl(value.dataUrl);
        const encoded = value.dataUrl.slice(value.dataUrl.indexOf(',') + 1);
        if (!parsed || parsed.buffer.toString('base64') !== encoded || !parsed.buffer.length) {
            throw new MirrorAttachmentError('An uploaded attachment is missing or malformed.');
        }
        total += parsed.buffer.length;
        if (total > MAX_ATTACHMENT_SIZE) throw new MirrorAttachmentError('Uploaded attachments must total at most 10 MiB.');
        const mimeType = parsed.mimeType.toLowerCase();
        if ('mimeType' in value && value.mimeType !== mimeType) {
            throw new MirrorAttachmentError('An uploaded attachment has inconsistent MIME metadata.');
        }
        // Strip path-shaped names rather than publishing client filesystem information.
        const name = value.name.split(/[/\\]/).pop()?.replace(/[\x00-\x1f\x7f]/g, '_').trim().slice(0, 200) || 'attachment';
        const result = mirrorAttachmentSchema.safeParse({
            name, mimeType, size: parsed.buffer.length,
            sha256: createHash('sha256').update(parsed.buffer).digest('hex'), data: encoded,
        });
        if (!result.success) throw new MirrorAttachmentError('An uploaded attachment has an unsupported MIME type.');
        return result.data;
    });
}

export function mirrorAttachmentBytes(attachment: MirrorAttachment): Buffer {
    if (attachment.data === undefined) throw new MirrorAttachmentError('Stored attachment bytes are unavailable.');
    const bytes = Buffer.from(attachment.data, 'base64');
    if (bytes.toString('base64') !== attachment.data || bytes.length !== attachment.size
        || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) {
        throw new MirrorAttachmentError('Stored attachment bytes failed integrity validation.');
    }
    return bytes;
}
