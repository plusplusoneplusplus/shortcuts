/**
 * Tests for rewindImagesToAttachments — reconstructing composer attachments
 * from the base64 image data URLs returned by a rewind (AC-04 composer restore).
 */

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { rewindImagesToAttachments } from '../../../src/server/spa/client/react/features/chat/utils/rewindImages';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('rewindImagesToAttachments', () => {
    it('returns an empty array for undefined or empty input', () => {
        expect(rewindImagesToAttachments(undefined)).toEqual([]);
        expect(rewindImagesToAttachments([])).toEqual([]);
    });

    it('converts a base64 image data URL into a ChatAttachment with image category', () => {
        const [att] = rewindImagesToAttachments([PNG]);
        expect(att).toBeTruthy();
        expect(att.dataUrl).toBe(PNG);
        expect(att.mimeType).toBe('image/png');
        expect(att.category).toBe('image');
        expect(att.name).toBe('rewound-image-1.png');
        expect(typeof att.id).toBe('string');
        expect(att.id.length).toBeGreaterThan(0);
        expect(att.size).toBeGreaterThan(0);
    });

    it('derives the file extension from the MIME subtype', () => {
        const [att] = rewindImagesToAttachments([JPEG]);
        expect(att.mimeType).toBe('image/jpeg');
        expect(att.name).toBe('rewound-image-1.jpeg');
    });

    it('numbers multiple images sequentially and preserves order', () => {
        const atts = rewindImagesToAttachments([PNG, JPEG]);
        expect(atts).toHaveLength(2);
        expect(atts[0].name).toBe('rewound-image-1.png');
        expect(atts[1].name).toBe('rewound-image-2.jpeg');
        // Unique ids per attachment.
        expect(atts[0].id).not.toBe(atts[1].id);
    });

    it('skips non-string and non-data-URL entries defensively', () => {
        const atts = rewindImagesToAttachments([PNG, 'https://example.com/x.png', '', null as unknown as string]);
        expect(atts).toHaveLength(1);
        expect(atts[0].dataUrl).toBe(PNG);
    });
});
