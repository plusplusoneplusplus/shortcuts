import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InboundImage } from '@plusplusoneplusplus/coc-connector';
import { registeredCacheCount } from '../../../src/server/cache';
import {
    MAX_PENDING_IMAGE_CONTEXTS, PendingImages, PENDING_IMAGE_TTL_MS, type PendingImageScope,
} from '../../../src/server/messaging/pending-images';
import { MAX_MESSAGING_IMAGES } from '../../../src/server/messaging/incoming-images';

const scope: PendingImageScope = {
    platform: 'whatsapp', conversationId: 'conversation', senderId: 'sender',
    workspaceId: 'workspace', chatId: 'chat',
};
const stores: PendingImages[] = [];
function store() {
    const pending = new PendingImages();
    stores.push(pending);
    return pending;
}
function image(): InboundImage {
    return { mimeType: 'image/png', download: vi.fn(async () => Buffer.from('image')) };
}
afterEach(() => {
    for (const pending of stores.splice(0)) pending.dispose();
    vi.useRealTimers();
});

describe.each(['whatsapp', 'teams'] as const)('%s pending-image retention', platform => {
    const context = { ...scope, platform };

    it('retains descriptors without downloading and transfers the batch exactly once', () => {
        const pending = store();
        const first = image();
        const second = image();
        expect(pending.add(context, 'message-1', [first])).toEqual({ duplicate: false });
        expect(pending.add(context, 'message-2', [second])).toEqual({ duplicate: false });
        expect(pending.has(context)).toBe(true);
        expect(pending.has(context)).toBe(true);
        expect(first.download).not.toHaveBeenCalled();
        expect(second.download).not.toHaveBeenCalled();
        expect(pending.take(context)).toEqual([first, second]);
        expect(pending.take(context)).toBeUndefined();
        expect(pending.has(context)).toBe(false);
    });

    it('suppresses redelivery both before and after consumption, even if selection changes', () => {
        const pending = store();
        const first = image();
        pending.add(context, 'message', [first]);
        expect(pending.add(context, 'message', [image()])).toEqual({ duplicate: true });
        expect(pending.take(context)).toEqual([first]);
        expect(pending.add({ ...context, workspaceId: 'other' }, 'message', [image()]))
            .toEqual({ duplicate: true });
        expect(pending.take(context)).toBeUndefined();
    });

    it.each([
        { senderId: 'other-sender' },
        { conversationId: 'other-conversation' },
        { threadId: 'thread' },
        { platform: platform === 'whatsapp' ? 'teams' as const : 'whatsapp' as const },
    ])('keeps independent sender/conversation/thread/platform contexts: %j', patch => {
        const pending = store();
        const first = image();
        const second = image();
        const other = { ...context, ...patch };
        pending.add(context, 'same-message-id', [first]);
        expect(pending.take(other)).toBeUndefined();
        pending.add(other, 'same-message-id', [second]);
        expect(pending.take(context)).toEqual([first]);
        expect(pending.take(other)).toEqual([second]);
    });

    it.each([{ workspaceId: 'other-workspace' }, { chatId: 'other-chat' }, { chatId: null }])
    ('rejects instructions in a changed binding without transferring images: %j', patch => {
        const pending = store();
        pending.add(context, 'message', [image()]);
        expect(() => pending.take({ ...context, ...patch })).toThrow('The repository or topic changed.');
        expect(pending.take(context)).toBeUndefined();
    });

    it('retains a new image in its new binding without borrowing the old batch', () => {
        const pending = store();
        pending.add(context, 'old', [image()]);
        const second = image();
        const other = { ...context, workspaceId: 'other' };
        pending.add(other, 'new', [second]);
        expect(pending.take(other)).toEqual([second]);
    });

    it('lets selection controls discard a batch even when selecting the same binding', () => {
        const pending = store();
        pending.add(context, 'message', [image()]);
        pending.discard(context);
        expect(pending.take(context)).toBeUndefined();
        expect(pending.add(context, 'message', [image()])).toEqual({ duplicate: true });
    });

    it('expires at 30 minutes and emits feedback once without renewing on probes or additions', () => {
        vi.useFakeTimers();
        const pending = store();
        pending.add(context, 'first', [image()]);
        vi.advanceTimersByTime(PENDING_IMAGE_TTL_MS - 1);
        expect(pending.has(context)).toBe(true);
        pending.add(context, 'second', [image()]);
        vi.advanceTimersByTime(1);
        expect(pending.has(context)).toBe(true);
        expect(() => pending.take(context)).toThrow('The pending images expired.');
        expect(pending.take(context)).toBeUndefined();
    });

    it('accepts instructions immediately before expiry', () => {
        vi.useFakeTimers();
        const pending = store();
        const first = image();
        pending.add(context, 'message', [first]);
        vi.advanceTimersByTime(PENDING_IMAGE_TTL_MS - 1);
        expect(pending.take(context)).toEqual([first]);
    });

    it('does not silently combine a new image with expired images', () => {
        vi.useFakeTimers();
        const pending = store();
        pending.add(context, 'first', [image()]);
        vi.advanceTimersByTime(PENDING_IMAGE_TTL_MS);
        const second = image();
        expect(() => pending.add(context, 'second', [second])).toThrow('The pending images expired.');
        expect(pending.take(context)).toBeUndefined();
        expect(pending.add(context, 'second', [second])).toEqual({ duplicate: false });
        expect(pending.take(context)).toEqual([second]);
    });

    it('rejects batch overflow atomically while preserving admitted images', () => {
        const pending = store();
        const images = Array.from({ length: MAX_MESSAGING_IMAGES }, image);
        pending.add(context, 'first', images);
        expect(() => pending.add(context, 'overflow', [image()])).toThrow('Send at most 5 images');
        expect(pending.take(context)).toEqual(images);
        const next = image();
        expect(pending.add(context, 'overflow', [next])).toEqual({ duplicate: false });
        expect(pending.take(context)).toEqual([next]);
    });

    it.each([0, MAX_MESSAGING_IMAGES + 1])('rejects an invalid %i-image message', count => {
        const pending = store();
        expect(() => pending.add(context, 'message', Array.from({ length: count }, image)))
            .toThrow('Send at most 5 images');
        expect(pending.has(context)).toBe(false);
    });
});

describe('pending-image resource and identity boundaries', () => {
    it('rejects capacity overflow rather than silently evicting another sender', () => {
        const pending = store();
        for (let index = 0; index < MAX_PENDING_IMAGE_CONTEXTS; index++) {
            pending.add({ ...scope, senderId: `sender-${index}` }, 'message', [image()]);
        }
        expect(() => pending.add(scope, 'message', [image()])).toThrow('Too many image requests');
        expect(pending.take({ ...scope, senderId: 'sender-0' })).toHaveLength(1);
        expect(pending.add(scope, 'message', [image()])).toEqual({ duplicate: false });
    });

    it('drops retained descriptors and unregisters caches on connector shutdown', () => {
        const baseline = registeredCacheCount();
        const pending = store();
        expect(registeredCacheCount()).toBe(baseline + 2);
        const first = image();
        pending.add(scope, 'message', [first]);
        pending.dispose();
        expect(registeredCacheCount()).toBe(baseline);
        expect(pending.take(scope)).toBeUndefined();
        expect(() => pending.add(scope, 'late-message', [image()])).toThrow('The messaging connection stopped.');
        expect(first.download).not.toHaveBeenCalled();
        expect(store().take(scope)).toBeUndefined();
    });

    it.each([
        { conversationId: '' }, { senderId: '' }, { workspaceId: '' }, { threadId: '' }, { chatId: '' },
    ])('fails closed on missing routing identity: %j', patch => {
        const pending = store();
        expect(() => pending.add({ ...scope, ...patch }, 'message', [image()])).toThrow('Could not identify');
        expect(() => pending.take({ ...scope, ...patch })).toThrow('Could not identify');
        expect(pending.has(scope)).toBe(false);
    });

    it('requires a message ID before retaining images', () => {
        const pending = store();
        expect(() => pending.add(scope, '', [image()])).toThrow('Could not identify');
        expect(pending.has(scope)).toBe(false);
    });

    it('uses structured keys so routing identifiers containing separators cannot collide', () => {
        const pending = store();
        const first = image();
        const left = { ...scope, conversationId: 'a\0b', senderId: 'c' };
        const right = { ...scope, conversationId: 'a', senderId: 'b\0c' };
        pending.add(left, 'message', [first]);
        expect(pending.take(right)).toBeUndefined();
        expect(pending.take(left)).toEqual([first]);
    });
});

describe('pending-image conversation-scoped operations', () => {
    it('keeps stale bindings and expiry visible to take after a non-consuming count', () => {
        vi.useFakeTimers();
        const pending = store();
        pending.add(scope, 'image', [image()]);
        expect(pending.count({ ...scope, workspaceId: 'other' })).toBe(0);
        expect(pending.count(scope)).toBe(1);
        vi.advanceTimersByTime(PENDING_IMAGE_TTL_MS);
        expect(pending.count(scope)).toBe(0);
        expect(() => pending.take(scope)).toThrow('expired');
    });

    it('count returns the number of pending images for a scope', () => {
        const pending = store();
        const context = { ...scope, platform: 'whatsapp' as const };
        expect(pending.count(context)).toBe(0);
        const first = image();
        pending.add(context, 'message-1', [first]);
        expect(pending.count(context)).toBe(1);
        const second = image();
        pending.add(context, 'message-2', [second]);
        expect(pending.count(context)).toBe(2);
        pending.take(context);
        expect(pending.count(context)).toBe(0);
    });

    it('count does not include images from different senders in same conversation', () => {
        const pending = store();
        const base = { ...scope, platform: 'whatsapp' as const };
        const sender1 = { ...base, senderId: 'sender-1' };
        const sender2 = { ...base, senderId: 'sender-2' };
        pending.add(sender1, 'msg1', [image()]);
        pending.add(sender2, 'msg2', [image(), image()]);
        // Count is sender-specific
        expect(pending.count(sender1)).toBe(1);
        expect(pending.count(sender2)).toBe(2);
    });

    it('discardConversation clears all senders in a thread', () => {
        const pending = store();
        const base = { platform: 'teams' as const, conversationId: 'channel-1', threadId: 'root-msg' };
        const sender1 = { ...base, senderId: 'sender-1', workspaceId: 'ws', chatId: null };
        const sender2 = { ...base, senderId: 'sender-2', workspaceId: 'ws', chatId: null };
        const sender3 = { ...base, senderId: 'sender-3', workspaceId: 'ws', chatId: null };
        pending.add(sender1, 'msg1', [image()]);
        pending.add(sender2, 'msg2', [image()]);
        pending.add(sender3, 'msg3', [image()]);
        expect(pending.has(sender1)).toBe(true);
        expect(pending.has(sender2)).toBe(true);
        expect(pending.has(sender3)).toBe(true);
        // Discard entire conversation thread
        pending.discardConversation(base);
        expect(pending.has(sender1)).toBe(false);
        expect(pending.has(sender2)).toBe(false);
        expect(pending.has(sender3)).toBe(false);
    });

    it('discardConversation does not affect other threads in the same channel', () => {
        const pending = store();
        const channel = 'channel-1';
        const thread1 = { platform: 'teams' as const, conversationId: channel, threadId: 'root-1', senderId: 'sender', workspaceId: 'ws', chatId: null };
        const thread2 = { platform: 'teams' as const, conversationId: channel, threadId: 'root-2', senderId: 'sender', workspaceId: 'ws', chatId: null };
        pending.add(thread1, 'msg1', [image()]);
        pending.add(thread2, 'msg2', [image()]);
        // Discard only thread1
        pending.discardConversation({ platform: 'teams', conversationId: channel, threadId: 'root-1' });
        expect(pending.has(thread1)).toBe(false);
        expect(pending.has(thread2)).toBe(true);
    });

    it('discardConversation handles root selection (no threadId) to clear sender in channel roots', () => {
        const pending = store();
        const base = { platform: 'teams' as const, conversationId: 'channel-1' };
        const sender1 = { ...base, senderId: 'sender-1', workspaceId: 'ws', chatId: null };
        const sender2 = { ...base, senderId: 'sender-2', workspaceId: 'ws', chatId: null };
        pending.add(sender1, 'msg1', [image()]);
        pending.add(sender2, 'msg2', [image()]);
        // Discard all senders in channel root (no threadId)
        pending.discardConversation(base);
        expect(pending.has(sender1)).toBe(false);
        expect(pending.has(sender2)).toBe(false);
    });

    it('discardConversation in one platform does not affect other platforms', () => {
        const pending = store();
        const teamsContext = { platform: 'teams' as const, conversationId: 'conv', senderId: 'user', workspaceId: 'ws', chatId: null };
        const whatsappContext = { platform: 'whatsapp' as const, conversationId: 'conv', senderId: 'user', workspaceId: 'ws', chatId: null };
        pending.add(teamsContext, 'msg1', [image()]);
        pending.add(whatsappContext, 'msg2', [image()]);
        // Discard Teams conversation
        pending.discardConversation({ platform: 'teams', conversationId: 'conv' });
        expect(pending.has(teamsContext)).toBe(false);
        expect(pending.has(whatsappContext)).toBe(true);
    });

    it('allows caller to validate combined captioned+pending count before take', () => {
        const pending = store();
        const context = { ...scope, platform: 'whatsapp' as const };
        // Add 3 pending images
        pending.add(context, 'msg1', Array.from({ length: 3 }, image));
        // Caller checks count before adding new images
        const existingCount = pending.count(context);
        expect(existingCount).toBe(3);
        // Caller can now validate: captioned (2) + pending (3) = 5, which is ok
        expect(existingCount + 2).toBe(5);
        // But captioned (3) + pending (3) = 6 would exceed limit
        expect(existingCount + 3 > MAX_MESSAGING_IMAGES).toBe(true);
        // Take works without silent discard
        const taken = pending.take(context);
        expect(taken).toHaveLength(3);
    });

});
