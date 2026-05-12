/**
 * Tests for WorkspaceFileNoteEditorIO — the NoteEditor IO adapter for
 * arbitrary workspace files (used by the floating markdown dialog auto branch).
 */
/* @vitest-environment node */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    tasks: {
        previewWorkspaceFile: vi.fn(),
        writeContent: vi.fn(),
    },
    notes: {
        uploadImage: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ tasks: mocks.tasks, notes: mocks.notes }),
    translateSpaCocClientError: (err: unknown) => { throw err; },
}));

import { createWorkspaceFileNoteEditorIO } from '../../../../src/server/spa/client/react/tasks/WorkspaceFileNoteEditorIO';
import { CocApiError } from '@plusplusoneplusplus/coc-client';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('WorkspaceFileNoteEditorIO', () => {
    describe('loadContent', () => {
        it('uses the explicit content field when present', async () => {
            mocks.tasks.previewWorkspaceFile.mockResolvedValueOnce({
                type: 'file',
                content: '# Hello\n\nworld\n',
                lines: ['# Hello', '', 'world'],
                mtime: 12345,
            });
            const io = createWorkspaceFileNoteEditorIO();

            const result = await io.loadContent('ws1', 'docs/readme.md');

            expect(mocks.tasks.previewWorkspaceFile)
                .toHaveBeenCalledWith('ws1', 'docs/readme.md', { lines: 0 });
            expect(result).toEqual({
                content: '# Hello\n\nworld\n',
                path: 'docs/readme.md',
                mtime: 12345,
            });
        });

        it('falls back to joining lines when content is absent', async () => {
            mocks.tasks.previewWorkspaceFile.mockResolvedValueOnce({
                type: 'file',
                lines: ['line1', 'line2', 'line3'],
            });
            const io = createWorkspaceFileNoteEditorIO();

            const result = await io.loadContent('ws1', 'README.md');
            expect(result.content).toBe('line1\nline2\nline3');
            expect(result.mtime).toBe(0);
        });

        it('returns empty content when neither content nor lines are present', async () => {
            mocks.tasks.previewWorkspaceFile.mockResolvedValueOnce({ type: 'file' });
            const io = createWorkspaceFileNoteEditorIO();

            const result = await io.loadContent('ws1', 'empty.md');
            expect(result.content).toBe('');
            expect(result.mtime).toBe(0);
        });
    });

    describe('saveContent', () => {
        it('forwards path, content, and expectedMtime to writeContent', async () => {
            mocks.tasks.writeContent.mockResolvedValueOnce({
                path: 'docs/readme.md',
                updated: true,
                mtime: 99999,
            });
            const io = createWorkspaceFileNoteEditorIO();

            const result = await io.saveContent('ws1', 'docs/readme.md', '# new', 123);
            expect(mocks.tasks.writeContent).toHaveBeenCalledWith('ws1', {
                path: 'docs/readme.md',
                content: '# new',
                expectedMtime: 123,
            });
            expect(result).toEqual({ path: 'docs/readme.md', updated: true, mtime: 99999 });
        });

        it('translates 409 conflict responses into a "conflict" Error', async () => {
            const conflictBody = { reason: 'mtime_mismatch', currentMtime: 555, currentContent: 'fresh' };
            const apiError = new CocApiError({
                status: 409,
                statusText: 'Conflict',
                url: '/api/workspaces/ws1/tasks/content',
                message: 'conflict',
                body: conflictBody,
            });
            mocks.tasks.writeContent.mockRejectedValueOnce(apiError);
            const io = createWorkspaceFileNoteEditorIO();

            await expect(io.saveContent('ws1', 'p.md', 'x', 1)).rejects.toMatchObject({
                message: 'conflict',
                status: 409,
                reason: 'mtime_mismatch',
                currentMtime: 555,
                currentContent: 'fresh',
            });
        });
    });

    describe('uploadImage', () => {
        it('delegates to the notes image endpoint', async () => {
            mocks.notes.uploadImage.mockResolvedValueOnce({ path: '.attachments/img.png' });
            const io = createWorkspaceFileNoteEditorIO();

            const result = await io.uploadImage('ws1', 'img.png', 'data:image/png;base64,AAA');
            expect(mocks.notes.uploadImage)
                .toHaveBeenCalledWith('ws1', 'img.png', 'data:image/png;base64,AAA');
            expect(result).toEqual({ path: '.attachments/img.png' });
        });
    });

    describe('image URL helpers', () => {
        it('imageApiUrl encodes both workspace id and relative path', () => {
            const io = createWorkspaceFileNoteEditorIO();
            const url = io.imageApiUrl('ws/with space', '.attachments/foo bar.png');
            expect(url).toBe(
                '/api/workspaces/ws%2Fwith%20space/notes/image?path=.attachments%2Ffoo%20bar.png',
            );
        });

        it('localImageApiUrl encodes both workspace id and absolute path', () => {
            const io = createWorkspaceFileNoteEditorIO();
            const url = io.localImageApiUrl('ws1', 'C:\\Users\\me\\img.png');
            expect(url).toBe('/api/workspaces/ws1/notes/local-image?path=C%3A%5CUsers%5Cme%5Cimg.png');
        });
    });
});
