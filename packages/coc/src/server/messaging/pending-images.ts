import type { InboundImage } from '@plusplusoneplusplus/coc-connector';
import { createCache } from '../cache';
import { MAX_MESSAGING_IMAGES } from './incoming-images';

export const PENDING_IMAGE_TTL_MS = 30 * 60_000;
export const MAX_PENDING_IMAGE_CONTEXTS = 256;

export interface PendingImageContext {
    platform: 'whatsapp' | 'teams';
    conversationId: string;
    threadId?: string;
    senderId: string;
}

/** Resolved routing identity, not display names or the instructions' mode. */
export interface PendingImageScope extends PendingImageContext {
    workspaceId: string;
    chatId: string | null;
}

interface PendingBatch {
    workspaceId: string;
    chatId: string | null;
    images: InboundImage[];
    expiresAt: number;
}

export class PendingImagesError extends Error {
    constructor(readonly code: 'expired' | 'binding-changed' | 'batch-limit' | 'capacity' | 'identity' | 'cancelled') {
        super({
            expired: 'The pending images expired. Send them again with instructions.',
            'binding-changed': 'The repository or topic changed. Send the images again in this chat.',
            'batch-limit': `Send at most ${MAX_MESSAGING_IMAGES} images before giving instructions.`,
            capacity: 'Too many image requests are waiting. Send the images again with instructions.',
            identity: 'Could not identify the image sender or chat. Send the images again in a supported chat.',
            cancelled: 'The messaging connection stopped. Reconnect and send the images again.',
        }[code]);
        this.name = 'PendingImagesError';
    }
}

function contextKey(context: PendingImageContext): string {
    if (!context.conversationId || !context.senderId
        || (context.threadId !== undefined && !context.threadId)) {
        throw new PendingImagesError('identity');
    }
    return JSON.stringify([context.platform, context.conversationId, context.threadId ?? null, context.senderId]);
}

function scopeKey(scope: PendingImageScope): string {
    if (!scope.workspaceId || (scope.chatId !== null && !scope.chatId)) throw new PendingImagesError('identity');
    return contextKey(scope);
}

/**
 * Connection-owned, memory-only retention of admitted lazy descriptors. Download
 * and workspace-scoped storage happen at dispatch, using prepareIncomingImages.
 */
export class PendingImages {
    private disposed = false;
    private readonly batches = createCache<PendingBatch>({
        namespace: 'messaging-pending-images', maxSize: MAX_PENDING_IMAGE_CONTEXTS,
    });
    private readonly seen = createCache<true>({
        namespace: 'messaging-pending-image-ids', maxSize: 2_000, ttlMs: PENDING_IMAGE_TTL_MS,
    });

    /** Caller must apply platform admission before retaining a captionless message. */
    add(scope: PendingImageScope, messageId: string, images: readonly InboundImage[]): { duplicate: boolean } {
        if (this.disposed) throw new PendingImagesError('cancelled');
        const key = scopeKey(scope);
        if (!messageId) throw new PendingImagesError('identity');
        const deliveryKey = JSON.stringify([key, messageId]);
        if (this.seen.has(deliveryKey)) return { duplicate: true };
        if (!images.length || images.length > MAX_MESSAGING_IMAGES) throw new PendingImagesError('batch-limit');
        let batch = this.batches.get(key);
        if (batch && (batch.workspaceId !== scope.workspaceId || batch.chatId !== scope.chatId)) {
            this.batches.delete(key);
            batch = undefined;
        }
        if (batch && batch.expiresAt <= Date.now()) {
            this.batches.delete(key);
            throw new PendingImagesError('expired');
        }
        if ((batch?.images.length ?? 0) + images.length > MAX_MESSAGING_IMAGES) {
            throw new PendingImagesError('batch-limit');
        }
        // Reject overload explicitly rather than silently evicting another user's intended images.
        if (!batch && this.batches.size >= MAX_PENDING_IMAGE_CONTEXTS) throw new PendingImagesError('capacity');
        this.batches.set(key, {
            workspaceId: scope.workspaceId,
            chatId: scope.chatId,
            images: [...(batch?.images ?? []), ...images],
            expiresAt: batch?.expiresAt ?? Date.now() + PENDING_IMAGE_TTL_MS,
        });
        this.seen.set(deliveryKey, true);
        return { duplicate: false };
    }

    /** Non-consuming probe for instruction routing; control commands must not call take. */
    has(context: PendingImageContext): boolean {
        return this.batches.has(contextKey(context));
    }

    /** Transfers descriptor ownership once; invalid bindings and expiry reject the whole turn. */
    take(scope: PendingImageScope): InboundImage[] | undefined {
        const key = scopeKey(scope);
        const batch = this.batches.get(key);
        if (!batch) return undefined;
        this.batches.delete(key);
        if (batch.workspaceId !== scope.workspaceId || batch.chatId !== scope.chatId) {
            throw new PendingImagesError('binding-changed');
        }
        if (batch.expiresAt <= Date.now()) throw new PendingImagesError('expired');
        return batch.images;
    }

    /** Invoke on explicit selection changes, including selecting the same repo/topic. */
    discard(context: PendingImageContext): void {
        this.batches.delete(contextKey(context));
    }

    /** Connector shutdown drops descriptors; reconnect/restart requires resending images. */
    dispose(): void {
        this.disposed = true;
        this.batches.dispose();
        this.seen.dispose();
    }
}
