import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockGetContent = vi.fn();
const mockSaveContent = vi.fn();
const mockGetComments = vi.fn(() => Promise.resolve({ noteId: '', threads: {} }));
const mockUpdateThread = vi.fn(() => Promise.resolve());

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getContent: (...args: unknown[]) => mockGetContent(...args),
        saveContent: (...args: unknown[]) => mockSaveContent(...args),
        getComments: (...args: unknown[]) => mockGetComments(...args),
        updateThread: (...args: unknown[]) => mockUpdateThread(...args),
        uploadImage: vi.fn(() => Promise.resolve({ path: 'img/test.png' })),
        getGitStatus: vi.fn(() => Promise.resolve({ initialized: false })),
    },
}));

const mockLoadContent = vi.fn();
const mockIOSaveContent = vi.fn();
const mockUploadImage = vi.fn();
const mockImageApiUrl = vi.fn((wsId: string, relPath: string) =>
    `/api/workspaces/${encodeURIComponent(wsId)}/notes/image?path=${encodeURIComponent(relPath)}`);

const mockIo = {
    loadContent: (...args: unknown[]) => mockLoadContent(...(args as [string, string])),
    saveContent: (...args: unknown[]) => mockIOSaveContent(...(args as [string, string, string])),
    uploadImage: (...args: unknown[]) => mockUploadImage(...(args as [string, string, string])),
    imageApiUrl: (...args: unknown[]) => mockImageApiUrl(...(args as [string, string])),
};

vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/noteMarkdown',
    () => ({
        markdownToHtml: (md: string) => `<p>${md}</p>`,
        htmlToMarkdown: (html: string) => html.replace(/<\/?[^>]+>/g, ''),
        rewriteImageSrcToApi: (html: string) => html,
        rewriteImageSrcToRelative: (md: string) => md,
    }),
);

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));
const mockSetContent = vi.fn();
const mockClearContent = vi.fn();
const mockGetHTML = vi.fn(() => '<p>content</p>');

const mockEditor = {
    commands: { setContent: mockSetContent, clearContent: mockClearContent },
    getHTML: mockGetHTML,
    isActive: vi.fn(() => false),
    chain: () => ({
        focus: () => ({
            toggleBold: () => ({ run: vi.fn() }),
        }),
    }),
};

vi.mock('@tiptap/react', () => ({
    useEditor: () => mockEditor,
    EditorContent: ({ editor }: { editor: unknown }) =>
        editor ? <div data-testid="editor-content" /> : null,
}));

vi.mock('@tiptap/starter-kit', () => ({ StarterKit: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-task-list', () => ({ TaskList: {} }));
vi.mock('@tiptap/extension-task-item', () => ({ TaskItem: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-link', () => ({ Link: { configure: () => ({}) } }));
vi.mock('@tiptap/extension-placeholder', () => ({ Placeholder: { configure: () => ({}) } }));

import { NoteEditor } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditor';
import type { NoteEditorCommentBackend } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorCommentBackend';
import { noopCommentBackend, defaultCommentBackend } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorCommentBackend';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditorCommentBackend', () => {
    beforeEach(() => {
        mockLoadContent.mockReset();
        mockIOSaveContent.mockReset();
        mockGetComments.mockReset().mockResolvedValue({ noteId: '', threads: {} });
        mockUpdateThread.mockReset().mockResolvedValue({ thread: {} });
        mockSetContent.mockReset();
        mockClearContent.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    // ── No-op backend ───────────────────────────────────────────────────

    describe('noopCommentBackend', () => {
        it('loadThreads returns an empty array', async () => {
            const threads = await noopCommentBackend.loadThreads('ws1', 'page.md');
            expect(threads).toEqual([]);
        });

        it('updateThreadAnchor resolves without error', async () => {
            await expect(
                noopCommentBackend.updateThreadAnchor('ws1', 'page.md', 't1', 'open'),
            ).resolves.toBeUndefined();
        });
    });

    // ── Default backend delegates to notesApi ───────────────────────────

    describe('defaultCommentBackend', () => {
        it('loadThreads delegates to notesApi.getComments', async () => {
            const thread = {
                id: 't1',
                anchor: { quotedText: 'hello', prefix: '', suffix: '' },
                status: 'open' as const,
                comments: [],
                createdAt: '2025-01-01T00:00:00Z',
            };
            mockGetComments.mockResolvedValue({
                noteId: 'page.md',
                threads: { t1: thread },
            });

            const result = await defaultCommentBackend.loadThreads('ws1', 'page.md');
            expect(mockGetComments).toHaveBeenCalledWith('ws1', 'page.md');
            expect(result).toEqual([thread]);
        });

        it('updateThreadAnchor delegates to notesApi.updateThread', async () => {
            mockUpdateThread.mockResolvedValue({ thread: {} });
            await defaultCommentBackend.updateThreadAnchor('ws1', 'page.md', 't1', 'resolved');
            expect(mockUpdateThread).toHaveBeenCalledWith('ws1', 'page.md', 't1', 'resolved');
        });
    });

    // ── NoteEditor with no-op backend ───────────────────────────────────

    describe('NoteEditor with noopCommentBackend', () => {
        it('renders without loading any comment threads', async () => {
            mockLoadContent.mockResolvedValue({ content: '# Hello', path: 'page.md' });

            await act(async () => {
                render(
                    <NoteEditor
                        workspaceId="ws1"
                        notePath="page.md"
                        io={mockIo}
                        commentBackend={noopCommentBackend}
                        commentsEnabled={true}
                    />,
                );
            });

            await waitFor(() => {
                expect(mockLoadContent).toHaveBeenCalledWith('ws1', 'page.md', undefined);
                expect(mockSetContent).toHaveBeenCalledWith('<p># Hello</p>', { emitUpdate: false });
            });

            // The no-op backend should have been called (not notesApi directly)
            // and should not have triggered any notesApi.getComments call
            expect(mockGetComments).not.toHaveBeenCalled();
        });

        it('does not error when comments are disabled', async () => {
            mockLoadContent.mockResolvedValue({ content: 'text', path: 'p.md' });

            await act(async () => {
                render(
                    <NoteEditor
                        workspaceId="ws1"
                        notePath="p.md"
                        io={mockIo}
                        commentBackend={noopCommentBackend}
                        commentsEnabled={false}
                    />,
                );
            });

            await waitFor(() => {
                expect(mockSetContent).toHaveBeenCalled();
            });

            expect(mockGetComments).not.toHaveBeenCalled();
        });
    });

    // ── NoteEditor with fake comment backend ────────────────────────────

    describe('NoteEditor with fake comment backend', () => {
        it('loads threads from the injected backend on content load', async () => {
            const fakeThread = {
                id: 'thread-1',
                anchor: { quotedText: 'Hello', prefix: '', suffix: '' },
                status: 'open' as const,
                comments: [{ id: 'c1', body: 'Nice!', createdAt: '2025-01-01T00:00:00Z' }],
                createdAt: '2025-01-01T00:00:00Z',
            };

            const fakeBackend: NoteEditorCommentBackend = {
                loadThreads: vi.fn().mockResolvedValue([fakeThread]),
                updateThreadAnchor: vi.fn().mockResolvedValue(undefined),
            };

            mockLoadContent.mockResolvedValue({ content: '# Hello world', path: 'page.md' });

            await act(async () => {
                render(
                    <NoteEditor
                        workspaceId="ws1"
                        notePath="page.md"
                        io={mockIo}
                        commentBackend={fakeBackend}
                        commentsEnabled={true}
                    />,
                );
            });

            await waitFor(() => {
                expect(fakeBackend.loadThreads).toHaveBeenCalledWith('ws1', 'page.md');
            });

            // notesApi should NOT have been called directly
            expect(mockGetComments).not.toHaveBeenCalled();
        });
    });

    // ── Default behavior preserved ──────────────────────────────────────

    describe('default commentBackend (no prop)', () => {
        it('uses defaultCommentBackend when no commentBackend prop is passed', async () => {
            const thread = {
                id: 't1',
                anchor: { quotedText: 'text', prefix: '', suffix: '' },
                status: 'open' as const,
                comments: [],
                createdAt: '2025-01-01T00:00:00Z',
            };
            mockGetComments.mockResolvedValue({ noteId: 'p.md', threads: { t1: thread } });
            mockGetContent.mockResolvedValue({ content: 'text', path: 'p.md' });

            await act(async () => {
                render(
                    <NoteEditor workspaceId="ws1" notePath="p.md" commentsEnabled={true} />,
                );
            });

            await waitFor(() => {
                // The default backend should delegate to notesApi.getComments
                expect(mockGetComments).toHaveBeenCalledWith('ws1', 'p.md');
            });
        });
    });
});
