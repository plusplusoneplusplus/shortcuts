import { describe, expect, it } from 'vitest';
import { serializeToolResultWithImages } from '../src/tool-result-images';

const image = { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' };

describe('inline tool result images', () => {
    it('deduplicates native binary and content representations without duplicating text', () => {
        expect(JSON.parse(serializeToolResultWithImages({
            content: 'ok', binaryResultsForLlm: [image], contents: [{ type: 'text', text: 'ok' }, image],
        })!)).toEqual({ content: [{ type: 'text', text: 'ok' }, image] });
    });

    it.each([
        'ordinary text',
        { content: [{ type: 'text', text: 'ordinary text' }] },
        { binaryResultsForLlm: [{ type: 'image', mimeType: 'image/jpeg' }] },
        { contents: [{ ...image, mimeType: 'image/svg+xml' }] },
        { contents: [{ ...image, data: '<invalid>' }] },
        { attachments: [{ type: 'file', url: 'file:///screenshot.jpeg', mime: 'image/jpeg' }] },
        { attachments: [{ type: 'file', url: 'https://example.invalid/screenshot.jpeg', mime: 'image/jpeg' }] },
    ])('does not reinterpret non-inline or non-image results: %j', value => {
        expect(serializeToolResultWithImages(value)).toBeUndefined();
    });

    it('normalizes Anthropic base64 sources', () => {
        expect(JSON.parse(serializeToolResultWithImages([
            { type: 'text', text: 'ok' },
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.data } },
        ])!)).toEqual({ content: [{ type: 'text', text: 'ok' }, image] });
    });

    it('retains rich content text when the native plain content is empty', () => {
        expect(JSON.parse(serializeToolResultWithImages({
            content: '', contents: [{ type: 'text', text: 'ok' }, image],
        })!)).toEqual({ content: [{ type: 'text', text: 'ok' }, image] });
    });
});
