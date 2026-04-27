/**
 * Tests for NoteEditorIO — rewriteHtmlImageSrc and localImageApiUrl.
 */

import { describe, it, expect } from 'vitest';
import {
    rewriteHtmlImageSrc,
    defaultNoteEditorIO,
    type NoteEditorIO,
} from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorIO';

// Stub IO that records calls and returns predictable URLs
function createStubIO(): NoteEditorIO & { calls: { method: string; args: string[] }[] } {
    const calls: { method: string; args: string[] }[] = [];
    return {
        calls,
        loadContent: async () => ({ content: '', path: '' }),
        saveContent: async () => ({ path: '', updated: false }),
        uploadImage: async () => ({ path: '' }),
        imageApiUrl: (wsId, relPath) => {
            calls.push({ method: 'imageApiUrl', args: [wsId, relPath] });
            return `/api/workspaces/${wsId}/notes/image?path=${encodeURIComponent(relPath)}`;
        },
        localImageApiUrl: (wsId, absPath) => {
            calls.push({ method: 'localImageApiUrl', args: [wsId, absPath] });
            return `/api/workspaces/${wsId}/notes/local-image?path=${encodeURIComponent(absPath)}`;
        },
    };
}

describe('rewriteHtmlImageSrc', () => {
    it('should rewrite .attachments/ paths using imageApiUrl', () => {
        const io = createStubIO();
        const html = '<img src=".attachments/abc.png" alt="pic">';
        const result = rewriteHtmlImageSrc(html, io, 'ws1');

        expect(result).toContain('/api/workspaces/ws1/notes/image?path=');
        expect(io.calls).toContainEqual({
            method: 'imageApiUrl',
            args: ['ws1', '.attachments/abc.png'],
        });
    });

    it('should rewrite Windows absolute paths using localImageApiUrl', () => {
        const io = createStubIO();
        const html = '<img src="C:\\repo\\chart.png">';
        const result = rewriteHtmlImageSrc(html, io, 'ws1');

        expect(result).toContain('/api/workspaces/ws1/notes/local-image?path=');
        expect(io.calls).toContainEqual({
            method: 'localImageApiUrl',
            args: ['ws1', 'C:\\repo\\chart.png'],
        });
    });

    it('should rewrite Windows forward-slash paths', () => {
        const io = createStubIO();
        const html = '<img src="D:/projects/img.jpg">';
        const result = rewriteHtmlImageSrc(html, io, 'ws1');

        expect(result).toContain('/notes/local-image');
        expect(io.calls.some(c => c.method === 'localImageApiUrl')).toBe(true);
    });

    it('should rewrite Unix absolute paths using localImageApiUrl', () => {
        const io = createStubIO();
        const html = '<img src="/home/user/photo.png">';
        const result = rewriteHtmlImageSrc(html, io, 'ws1');

        expect(result).toContain('/notes/local-image');
        expect(io.calls).toContainEqual({
            method: 'localImageApiUrl',
            args: ['ws1', '/home/user/photo.png'],
        });
    });

    it('should not double-rewrite /api/ paths', () => {
        const io = createStubIO();
        const html = '<img src="/api/workspaces/ws/notes/image?path=.attachments%2Ftest.png">';
        const result = rewriteHtmlImageSrc(html, io, 'ws');

        // /api/ paths should be left alone
        expect(result).toBe(html);
        expect(io.calls.filter(c => c.method === 'localImageApiUrl')).toHaveLength(0);
    });

    it('should not rewrite external URLs', () => {
        const io = createStubIO();
        const html = '<img src="https://example.com/photo.png">';
        const result = rewriteHtmlImageSrc(html, io, 'ws1');
        expect(result).toBe(html);
        expect(io.calls).toHaveLength(0);
    });

    it('should handle multiple images of different types', () => {
        const io = createStubIO();
        const html = [
            '<img src=".attachments/a.png">',
            '<img src="C:\\repo\\b.jpg">',
            '<img src="/opt/c.gif">',
            '<img src="https://cdn.example.com/d.png">',
        ].join('');

        const result = rewriteHtmlImageSrc(html, io, 'ws1');

        // .attachments rewritten
        expect(result).toContain('/notes/image?path=');
        // Absolute paths rewritten
        expect(result).toContain('/notes/local-image?path=');
        // External URL untouched
        expect(result).toContain('https://cdn.example.com/d.png');

        const imageApiCalls = io.calls.filter(c => c.method === 'imageApiUrl');
        const localCalls = io.calls.filter(c => c.method === 'localImageApiUrl');
        expect(imageApiCalls).toHaveLength(1);
        expect(localCalls).toHaveLength(2);
    });

    it('should handle empty HTML', () => {
        const io = createStubIO();
        expect(rewriteHtmlImageSrc('', io, 'ws')).toBe('');
    });

    it('should preserve other img attributes', () => {
        const io = createStubIO();
        const html = '<img class="thumb" src="C:\\img.png" width="200" alt="test">';
        const result = rewriteHtmlImageSrc(html, io, 'ws1');

        expect(result).toContain('class="thumb"');
        expect(result).toContain('width="200"');
        expect(result).toContain('alt="test"');
    });
});

describe('defaultNoteEditorIO.localImageApiUrl', () => {
    it('should build correct URL for Windows path', () => {
        const url = defaultNoteEditorIO.localImageApiUrl('my-ws', 'C:\\src\\repo\\chart.png');
        expect(url).toBe(
            '/api/workspaces/my-ws/notes/local-image?path=' +
            encodeURIComponent('C:\\src\\repo\\chart.png')
        );
    });

    it('should build correct URL for Unix path', () => {
        const url = defaultNoteEditorIO.localImageApiUrl('my-ws', '/home/user/img.png');
        expect(url).toBe(
            '/api/workspaces/my-ws/notes/local-image?path=' +
            encodeURIComponent('/home/user/img.png')
        );
    });

    it('should encode workspace ID with special characters', () => {
        const url = defaultNoteEditorIO.localImageApiUrl('ws/special', '/path/img.png');
        expect(url).toContain('/api/workspaces/ws%2Fspecial/notes/local-image');
    });
});
