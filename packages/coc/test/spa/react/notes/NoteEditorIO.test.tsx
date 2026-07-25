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

        it('ingestPaper POSTs to the paper-ingest endpoint and returns the result', async () => {
            const fetchMock = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({
                    arxivId: '1802.05799',
                    pdfPath: '.papers/1802.05799.pdf',
                    textPath: '.papers/1802.05799.txt',
                    cached: false,
                }),
            });
            vi.stubGlobal('fetch', fetchMock);
            try {
                const result = await defaultNoteEditorIO.ingestPaper!('ws1', 'https://arxiv.org/pdf/1802.05799', 'r1');
                expect(fetchMock).toHaveBeenCalledWith(
                    '/api/workspaces/ws1/notes/paper-ingest',
                    expect.objectContaining({ method: 'POST' }),
                );
                const body = JSON.parse(fetchMock.mock.calls[0][1].body);
                expect(body).toEqual({ url: 'https://arxiv.org/pdf/1802.05799', root: 'r1' });
                expect(result.pdfPath).toBe('.papers/1802.05799.pdf');
                expect(result.arxivId).toBe('1802.05799');
            } finally {
                vi.unstubAllGlobals();
            }
        });

        it('ingestPaper omits root when not provided and throws on a non-ok response', async () => {
            const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400 });
            vi.stubGlobal('fetch', fetchMock);
            try {
                await expect(
                    defaultNoteEditorIO.ingestPaper!('ws1', 'not-arxiv'),
                ).rejects.toThrow(/HTTP 400/);
                const body = JSON.parse(fetchMock.mock.calls[0][1].body);
                expect(body).toEqual({ url: 'not-arxiv' });
            } finally {
                vi.unstubAllGlobals();
            }
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

        it('rewrites data-pdf-url .attachments/ paths to API URLs', () => {
            const html = '<div class="md-pdf-embed" data-pdf-url=".attachments/doc.pdf" data-pdf-label="Doc"></div>';
            const result = rewriteHtmlImageSrc(html, notesIo, 'ws1');
            expect(result).toContain('data-pdf-url="/api/workspaces/ws1/notes/image?path=.attachments%2Fdoc.pdf"');
        });

        it('rewrites data-pdf-url .images/ paths and leaves already-API pdf urls untouched', () => {
            const relative = '<div class="md-pdf-embed" data-pdf-url=".images/doc.pdf"></div>';
            expect(rewriteHtmlImageSrc(relative, notesIo, 'ws1')).toContain(
                'data-pdf-url="/api/workspaces/ws1/notes/image?path=.images%2Fdoc.pdf"',
            );

            const alreadyApi = '<div class="md-pdf-embed" data-pdf-url="/api/workspaces/ws1/notes/image?path=.attachments%2Fdoc.pdf"></div>';
            expect(rewriteHtmlImageSrc(alreadyApi, notesIo, 'ws1')).toBe(alreadyApi);
        });

        it('rewrites data-pdf-url .papers/ (cached arXiv PDF) paths to API URLs', () => {
            const html = '<div class="md-pdf-embed" data-pdf-url=".papers/1802.05799.pdf" data-pdf-label="1802.05799"></div>';
            const result = rewriteHtmlImageSrc(html, notesIo, 'ws1');
            expect(result).toContain('data-pdf-url="/api/workspaces/ws1/notes/image?path=.papers%2F1802.05799.pdf"');
        });
    });
});
