import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MAP_EMBED_HEIGHT,
    MAX_MAP_EMBED_HEIGHT,
    MIN_MAP_EMBED_HEIGHT,
    isEmbeddableMapUrl,
} from '../../../src/editor/rendering/map-embed';

describe('isEmbeddableMapUrl', () => {
    it('allows modern Google Maps embed URLs', () => {
        expect(isEmbeddableMapUrl('https://www.google.com/maps/embed?pb=!1m18!1m12')).toBe(true);
    });

    it('allows legacy maps.google.com embed URLs', () => {
        expect(isEmbeddableMapUrl('https://maps.google.com/maps?q=Lake%20Chelan&output=embed')).toBe(true);
    });

    it('trims surrounding whitespace', () => {
        expect(isEmbeddableMapUrl('  https://www.google.com/maps/embed?pb=test  ')).toBe(true);
    });

    it('rejects Google Maps share links', () => {
        expect(isEmbeddableMapUrl('https://maps.app.goo.gl/example')).toBe(false);
    });

    it('rejects non-HTTPS and non-allowlisted URLs', () => {
        expect(isEmbeddableMapUrl('http://www.google.com/maps/embed?pb=test')).toBe(false);
        expect(isEmbeddableMapUrl('https://www.google.com/maps/place/Lake')).toBe(false);
        expect(isEmbeddableMapUrl('https://evil.example/maps/embed?pb=test')).toBe(false);
        expect(isEmbeddableMapUrl('javascript:alert(1)')).toBe(false);
    });

    it('rejects missing query strings', () => {
        expect(isEmbeddableMapUrl('https://www.google.com/maps/embed')).toBe(false);
        expect(isEmbeddableMapUrl('https://maps.google.com/maps')).toBe(false);
    });

    it('exports map height limits', () => {
        expect(DEFAULT_MAP_EMBED_HEIGHT).toBe(400);
        expect(MIN_MAP_EMBED_HEIGHT).toBeLessThan(DEFAULT_MAP_EMBED_HEIGHT);
        expect(MAX_MAP_EMBED_HEIGHT).toBeGreaterThan(DEFAULT_MAP_EMBED_HEIGHT);
    });
});
