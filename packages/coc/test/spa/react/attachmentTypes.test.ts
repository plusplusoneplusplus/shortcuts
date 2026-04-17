import { describe, it, expect } from 'vitest';
import {
    getAttachmentCategory,
    getAttachmentIcon,
    formatFileSize,
    MAX_FILE_SIZE,
    MAX_ATTACHMENTS,
} from '../../../src/server/spa/client/react/types/attachments';

describe('getAttachmentCategory', () => {
    it('classifies image MIME types as image', () => {
        expect(getAttachmentCategory('image/png', 'photo.png')).toBe('image');
        expect(getAttachmentCategory('image/jpeg', 'photo.jpg')).toBe('image');
        expect(getAttachmentCategory('image/gif', 'anim.gif')).toBe('image');
        expect(getAttachmentCategory('image/webp', 'photo.webp')).toBe('image');
        expect(getAttachmentCategory('image/svg+xml', 'icon.svg')).toBe('image');
    });

    it('classifies text MIME types as text', () => {
        expect(getAttachmentCategory('text/plain', 'readme.txt')).toBe('text');
        expect(getAttachmentCategory('text/html', 'page.html')).toBe('text');
        expect(getAttachmentCategory('text/css', 'style.css')).toBe('text');
        expect(getAttachmentCategory('text/markdown', 'readme.md')).toBe('text');
    });

    it('classifies JSON/YAML as text', () => {
        expect(getAttachmentCategory('application/json', 'config.json')).toBe('text');
        expect(getAttachmentCategory('application/yaml', 'config.yaml')).toBe('text');
        expect(getAttachmentCategory('application/xml', 'data.xml')).toBe('text');
    });

    it('classifies code files by extension as text', () => {
        expect(getAttachmentCategory('application/octet-stream', 'main.ts')).toBe('text');
        expect(getAttachmentCategory('application/octet-stream', 'app.py')).toBe('text');
        expect(getAttachmentCategory('application/octet-stream', 'main.go')).toBe('text');
        expect(getAttachmentCategory('application/octet-stream', 'lib.rs')).toBe('text');
        expect(getAttachmentCategory('application/octet-stream', 'App.vue')).toBe('text');
    });

    it('classifies Dockerfile/Makefile by base name', () => {
        expect(getAttachmentCategory('application/octet-stream', 'dockerfile')).toBe('text');
        expect(getAttachmentCategory('application/octet-stream', 'makefile')).toBe('text');
    });

    it('classifies binary MIME types as binary', () => {
        expect(getAttachmentCategory('application/zip', 'data.zip')).toBe('binary');
        expect(getAttachmentCategory('application/pdf', 'doc.pdf')).toBe('binary');
        expect(getAttachmentCategory('application/octet-stream', 'data.bin')).toBe('binary');
    });

    it('classifies unknown extensions as binary', () => {
        expect(getAttachmentCategory('application/octet-stream', 'mystery.xyz')).toBe('binary');
    });
});

describe('getAttachmentIcon', () => {
    it('returns image icon for image category', () => {
        expect(getAttachmentIcon('image')).toBe('🖼️');
    });
    it('returns text icon for text category', () => {
        expect(getAttachmentIcon('text')).toBe('📄');
    });
    it('returns binary icon for binary category', () => {
        expect(getAttachmentIcon('binary')).toBe('📎');
    });
});

describe('formatFileSize', () => {
    it('formats bytes', () => {
        expect(formatFileSize(500)).toBe('500 B');
    });
    it('formats kilobytes', () => {
        expect(formatFileSize(1024)).toBe('1.0 KB');
        expect(formatFileSize(2560)).toBe('2.5 KB');
    });
    it('formats megabytes', () => {
        expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
        expect(formatFileSize(5.5 * 1024 * 1024)).toBe('5.5 MB');
    });
});

describe('constants', () => {
    it('MAX_FILE_SIZE is 10MB', () => {
        expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    });
    it('MAX_ATTACHMENTS is 10', () => {
        expect(MAX_ATTACHMENTS).toBe(10);
    });
});
