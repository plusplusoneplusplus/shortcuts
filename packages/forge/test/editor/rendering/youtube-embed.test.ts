import { describe, expect, it } from 'vitest';
import {
    isYouTubeUrl,
    parseYouTubeVideoId,
    youTubeEmbedUrl,
} from '../../../src/editor/rendering/youtube-embed';

const VIDEO_ID = 'dQw4w9WgXcQ';

describe('parseYouTubeVideoId', () => {
    it.each([
        `https://www.youtube.com/watch?v=${VIDEO_ID}`,
        `https://youtube.com/watch?v=${VIDEO_ID}`,
        `https://m.youtube.com/watch?v=${VIDEO_ID}`,
        `https://youtu.be/${VIDEO_ID}`,
        `https://www.youtube.com/shorts/${VIDEO_ID}`,
        `https://www.youtube.com/embed/${VIDEO_ID}`,
        `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
    ])('extracts the video id from %s', (url) => {
        expect(parseYouTubeVideoId(url)).toBe(VIDEO_ID);
    });

    it.each([
        `https://www.youtube.com/watch?v=${VIDEO_ID}&t=30s`,
        `https://www.youtube.com/watch?v=${VIDEO_ID}&list=PLabc123def`,
        `https://youtu.be/${VIDEO_ID}?t=30`,
        `https://www.youtube.com/embed/${VIDEO_ID}?start=10&list=PLxyz`,
        `https://www.youtube.com/watch?list=PLabc&v=${VIDEO_ID}`,
    ])('ignores timestamp / playlist query params: %s', (url) => {
        expect(parseYouTubeVideoId(url)).toBe(VIDEO_ID);
    });

    it('trims surrounding whitespace', () => {
        expect(parseYouTubeVideoId(`  https://youtu.be/${VIDEO_ID}  `)).toBe(VIDEO_ID);
    });

    it.each([
        'https://vimeo.com/123456789',
        'https://www.dailymotion.com/video/x7abcde',
        'https://example.com/watch?v=dQw4w9WgXcQ',
        'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
        'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
    ])('rejects non-YouTube hosts: %s', (url) => {
        expect(parseYouTubeVideoId(url)).toBeNull();
    });

    it.each([
        'https://www.youtube.com/watch',
        'https://www.youtube.com/watch?v=',
        'https://www.youtube.com/watch?v=short',
        'https://www.youtube.com/watch?v=way_too_long_id_value',
        'https://youtu.be/',
        'https://www.youtube.com/shorts/',
        'https://www.youtube.com/embed/',
        'https://www.youtube.com/',
        'https://www.youtube.com/results?search_query=cats',
    ])('rejects malformed or incomplete YouTube URLs: %s', (url) => {
        expect(parseYouTubeVideoId(url)).toBeNull();
    });

    it.each([
        'javascript:alert(1)',
        'ftp://youtube.com/watch?v=dQw4w9WgXcQ',
        'not a url',
        'youtube.com/watch?v=dQw4w9WgXcQ',
        '',
        '   ',
    ])('rejects unsafe, garbage, or empty input: %s', (url) => {
        expect(parseYouTubeVideoId(url)).toBeNull();
    });

    it('returns null for nullish input', () => {
        expect(parseYouTubeVideoId(null)).toBeNull();
        expect(parseYouTubeVideoId(undefined)).toBeNull();
    });
});

describe('isYouTubeUrl', () => {
    it('is true for a recognized YouTube link', () => {
        expect(isYouTubeUrl(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(true);
    });

    it('is false for non-YouTube and garbage input', () => {
        expect(isYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ')).toBe(false);
        expect(isYouTubeUrl('not a url')).toBe(false);
        expect(isYouTubeUrl('')).toBe(false);
        expect(isYouTubeUrl(null)).toBe(false);
    });
});

describe('youTubeEmbedUrl', () => {
    it('builds a privacy-mode embed URL without autoplay by default', () => {
        expect(youTubeEmbedUrl(VIDEO_ID)).toBe(
            `https://www.youtube-nocookie.com/embed/${VIDEO_ID}`,
        );
    });

    it('adds autoplay=1 when requested', () => {
        expect(youTubeEmbedUrl(VIDEO_ID, { autoplay: true })).toBe(
            `https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1`,
        );
    });

    it('never uses the tracking youtube.com/embed host', () => {
        expect(youTubeEmbedUrl(VIDEO_ID)).not.toContain('youtube.com/embed');
        expect(youTubeEmbedUrl(VIDEO_ID, { autoplay: true })).toContain('youtube-nocookie.com');
    });
});
