// @vitest-environment jsdom
/**
 * AC-04 (DoD #3): the desktop screenshot receive handler builds an image
 * ChatAttachment from a pushed PNG data URL and enforces MAX_ATTACHMENTS /
 * MAX_FILE_SIZE — the same limits the paste/file pipeline enforces.
 */
import { describe, it, expect } from 'vitest';
import {
    estimateDataUrlBytes,
    buildScreenshotAttachment,
} from '../../../src/server/spa/client/react/features/chat/utils/screenshotAttachment';
import {
    MAX_ATTACHMENTS,
    MAX_FILE_SIZE,
} from '../../../src/server/spa/client/react/types/attachments';

const PNG = 'data:image/png;base64,AAAA';

describe('estimateDataUrlBytes', () => {
    it('decodes base64 length minus padding', () => {
        expect(estimateDataUrlBytes('data:image/png;base64,AAAA')).toBe(3); // 4 chars, no padding
        expect(estimateDataUrlBytes('data:image/png;base64,AAA=')).toBe(2); // 1 pad char
        expect(estimateDataUrlBytes('data:image/png;base64,AA==')).toBe(1); // 2 pad chars
    });

    it('returns 0 for an empty payload and falls back to raw length for non-base64', () => {
        expect(estimateDataUrlBytes('data:image/png;base64,')).toBe(0);
        expect(estimateDataUrlBytes('data:image/png,rawtext')).toBe(7);
        expect(estimateDataUrlBytes('' as string)).toBe(0);
    });
});

describe('buildScreenshotAttachment', () => {
    it('builds an image ChatAttachment with the pushed data URL and a timestamped name', () => {
        const { attachment, error } = buildScreenshotAttachment(PNG, 0, MAX_ATTACHMENTS, 1_700_000_000_000);
        expect(error).toBeNull();
        expect(attachment).not.toBeNull();
        expect(attachment).toMatchObject({
            name: 'screenshot-1700000000000.png',
            mimeType: 'image/png',
            category: 'image',
            dataUrl: PNG,
            size: 3,
        });
        expect(typeof attachment!.id).toBe('string');
        expect(attachment!.id.length).toBeGreaterThan(0);
    });

    it('rejects a non-image data URL', () => {
        const { attachment, error } = buildScreenshotAttachment('data:text/plain;base64,AAAA', 0);
        expect(attachment).toBeNull();
        expect(error).toMatch(/not a valid image/i);
    });

    it('enforces MAX_ATTACHMENTS — rejects once the composer is already full', () => {
        // One slot free: still accepted.
        expect(buildScreenshotAttachment(PNG, MAX_ATTACHMENTS - 1).attachment).not.toBeNull();
        // At the cap: rejected, no attachment.
        const full = buildScreenshotAttachment(PNG, MAX_ATTACHMENTS);
        expect(full.attachment).toBeNull();
        expect(full.error).toMatch(new RegExp(`Maximum ${MAX_ATTACHMENTS}`, 'i'));
    });

    it('enforces MAX_FILE_SIZE — rejects a screenshot over the limit', () => {
        // A base64 payload whose decoded size exceeds MAX_FILE_SIZE.
        const overBytes = MAX_FILE_SIZE + 1024;
        const b64Len = Math.ceil((overBytes * 4) / 3);
        const bigUrl = 'data:image/png;base64,' + 'A'.repeat(b64Len);
        expect(estimateDataUrlBytes(bigUrl)).toBeGreaterThan(MAX_FILE_SIZE);

        const { attachment, error } = buildScreenshotAttachment(bigUrl, 0);
        expect(attachment).toBeNull();
        expect(error).toMatch(/limit/i);
    });
});
