import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetContent = vi.fn();
const mockSaveContent = vi.fn();
const mockUploadImage = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getContent: (...args: unknown[]) => mockGetContent(...args),
        saveContent: (...args: unknown[]) => mockSaveContent(...args),
        uploadImage: (...args: unknown[]) => mockUploadImage(...args),
    },
}));

import {
    defaultNoteEditorIO,
    rewriteHtmlImageSrc,
} from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorIO';
import type { NoteEditorIO } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorIO';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditorIO', () => {
    beforeEach(() => {
        mockGetContent.mockReset();
        mockSaveContent.mockReset();
        mockUploadImage.mockReset();
    });

    // ── defaultNoteEditorIO delegates to notesApi ───────────────────────

    describe('defaultNoteEditorIO', () => {
        it('loadContent delegates to notesApi.getContent', async () => {
            mockGetContent.mockResolvedValue({ content: '# Hi', path: 'p.md' });
            const result = await defaultNoteEditorIO.loadContent('ws1', 'p.md');
            expect(mockGetContent).toHaveBeenCalledWith('ws1', 'p.md', undefined);
            expect(result).toEqual({ content: '# Hi', path: 'p.md' });
        });

        it('saveContent delegates to notesApi.saveContent', async () => {
            mockSaveContent.mockResolvedValue({ path: 'p.md', updated: true, mtime: 1000 });
            const result = await defaultNoteEditorIO.saveContent('ws1', 'p.md', '# Hi');
            expect(mockSaveContent).toHaveBeenCalledWith('ws1', 'p.md', '# Hi', undefined, undefined);
            expect(result).toEqual({ path: 'p.md', updated: true, mtime: 1000 });
        });

        it('saveContent forwards expectedMtime to notesApi.saveContent', async () => {
            mockSaveContent.mockResolvedValue({ path: 'p.md', updated: true, mtime: 2000 });
            const result = await defaultNoteEditorIO.saveContent('ws1', 'p.md', '# Hi', 1000);
            expect(mockSaveContent).toHaveBeenCalledWith('ws1', 'p.md', '# Hi', 1000, undefined);
            expect(result).toEqual({ path: 'p.md', updated: true, mtime: 2000 });
        });

        it('uploadImage delegates to notesApi.uploadImage', async () => {
            mockUploadImage.mockResolvedValue({ path: '.attachments/img.png' });
            const result = await defaultNoteEditorIO.uploadImage('ws1', 'shot.png', 'data:image/png;base64,abc');
            expect(mockUploadImage).toHaveBeenCalledWith('ws1', 'shot.png', 'data:image/png;base64,abc', undefined);
            expect(result).toEqual({ path: '.attachments/img.png' });
        });

        it('imageApiUrl produces the notes endpoint URL', () => {
            const url = defaultNoteEditorIO.imageApiUrl('ws1', '.attachments/uuid.png');
            expect(url).toBe('/api/workspaces/ws1/notes/image?path=.attachments%2Fuuid.png');
        });

        it('imageApiUrl encodes special characters in workspaceId', () => {
            const url = defaultNoteEditorIO.imageApiUrl('ws/special', '.attachments/img.png');
            expect(url).toBe('/api/workspaces/ws%2Fspecial/notes/image?path=.attachments%2Fimg.png');
        });
    });

    // ── rewriteHtmlImageSrc ─────────────────────────────────────────────

    describe('rewriteHtmlImageSrc', () => {
        const notesIo = defaultNoteEditorIO;

        it('rewrites .attachments/ src to API URLs', () => {
            const html = '<img src=".attachments/uuid.png" alt="pic">';
            const result = rewriteHtmlImageSrc(html, notesIo, 'ws1');
            expect(result).toBe(
                '<img src="/api/workspaces/ws1/notes/image?path=.attachments%2Fuuid.png" alt="pic">',
            );
        });

        it('rewrites multiple images', () => {
            const html = '<img src=".attachments/a.png"><img src=".attachments/b.jpg">';
            const result = rewriteHtmlImageSrc(html, notesIo, 'ws1');
            expect(result).toContain('path=.attachments%2Fa.png');
            expect(result).toContain('path=.attachments%2Fb.jpg');
        });

        it('leaves non-attachment src unchanged', () => {
            const html = '<img src="https://example.com/img.png">';
            expect(rewriteHtmlImageSrc(html, notesIo, 'ws1')).toBe(html);
        });

        it('returns empty string for empty input', () => {
            expect(rewriteHtmlImageSrc('', notesIo, 'ws1')).toBe('');
        });

        it('uses custom io.imageApiUrl when provided', () => {
            const customIo: NoteEditorIO = {
                loadContent: vi.fn(),
                saveContent: vi.fn(),
                uploadImage: vi.fn(),
                imageApiUrl: (_ws, relPath) => `/custom/images/${relPath}`,
                localImageApiUrl: (_ws, absolutePath) => `/custom/local-images/${absolutePath}`,
            };
            const html = '<img src=".attachments/uuid.png">';
            const result = rewriteHtmlImageSrc(html, customIo, 'ws1');
            expect(result).toBe('<img src="/custom/images/.attachments/uuid.png">');
        });
    });
});
