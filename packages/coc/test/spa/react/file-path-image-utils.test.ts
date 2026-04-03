/**
 * Tests for image file detection utilities.
 *
 * Covers isImageFile() and getImageMimeType() from file-path-utils.
 */

import { describe, it, expect } from 'vitest';
import { isImageFile, getImageMimeType } from '../../../src/server/spa/client/react/shared/file-path-utils';

describe('isImageFile', () => {
    it('detects SVG files', () => {
        expect(isImageFile('diagram.svg')).toBe(true);
        expect(isImageFile('/path/to/icon.SVG')).toBe(true);
    });

    it('detects raster image files', () => {
        expect(isImageFile('photo.png')).toBe(true);
        expect(isImageFile('photo.jpg')).toBe(true);
        expect(isImageFile('photo.jpeg')).toBe(true);
        expect(isImageFile('animation.gif')).toBe(true);
        expect(isImageFile('modern.webp')).toBe(true);
        expect(isImageFile('legacy.bmp')).toBe(true);
        expect(isImageFile('favicon.ico')).toBe(true);
    });

    it('returns false for non-image files', () => {
        expect(isImageFile('app.ts')).toBe(false);
        expect(isImageFile('readme.md')).toBe(false);
        expect(isImageFile('data.json')).toBe(false);
        expect(isImageFile('archive.zip')).toBe(false);
        expect(isImageFile('document.pdf')).toBe(false);
    });

    it('handles paths with directories', () => {
        expect(isImageFile('/home/user/images/logo.png')).toBe(true);
        expect(isImageFile('C:/Users/test/diagram.svg')).toBe(true);
    });

    it('handles edge cases', () => {
        expect(isImageFile('.png')).toBe(true);
        expect(isImageFile('noextension')).toBe(false);
    });
});

describe('getImageMimeType', () => {
    it('returns correct MIME types for image extensions', () => {
        expect(getImageMimeType('icon.svg')).toBe('image/svg+xml');
        expect(getImageMimeType('photo.png')).toBe('image/png');
        expect(getImageMimeType('photo.jpg')).toBe('image/jpeg');
        expect(getImageMimeType('photo.jpeg')).toBe('image/jpeg');
        expect(getImageMimeType('anim.gif')).toBe('image/gif');
        expect(getImageMimeType('pic.webp')).toBe('image/webp');
        expect(getImageMimeType('old.bmp')).toBe('image/bmp');
        expect(getImageMimeType('fav.ico')).toBe('image/x-icon');
    });

    it('returns null for non-image files', () => {
        expect(getImageMimeType('app.ts')).toBeNull();
        expect(getImageMimeType('readme.md')).toBeNull();
        expect(getImageMimeType('data.json')).toBeNull();
    });

    it('is case-insensitive', () => {
        expect(getImageMimeType('LOGO.PNG')).toBe('image/png');
        expect(getImageMimeType('icon.SVG')).toBe('image/svg+xml');
    });
});
