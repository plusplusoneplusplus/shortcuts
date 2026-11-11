import { describe, expect, it } from 'vitest';
import { parseCanvasLink } from '../../../../src/server/spa/client/react/shared/canvasLink';

describe('parseCanvasLink', () => {
    it.each(['abc', 'A-1', 'a'.repeat(128)])('accepts canvas://%s', id => {
        expect(parseCanvasLink(`canvas://${id}`)).toEqual({ canvasId: id });
    });

    it.each([
        'canvas://',
        'canvas://a/b',
        'canvas://-x',
        `canvas://${'a'.repeat(129)}`,
        'https://example.com',
        'coc://canvas/abc',
        'src/canvas://abc',
    ])('rejects %s', href => {
        expect(parseCanvasLink(href)).toBeNull();
    });
});
