/**
 * Tests for MarkdownReviewEditor rich-mode integration.
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import { MarkdownReviewEditor } from '../../../src/server/spa/client/react/shared/MarkdownReviewEditor';

/* ── Mock RichEditorCore ── */
let capturedOnChange: ((editor: any) => void) | null = null;
let capturedOnEditorReady: ((editor: any) => void) | null = null;

const mockEditorCommands = { setContent: vi.fn(), clearContent: vi.fn() };
const mockEditor = {
    commands: mockEditorCommands,
    getHTML: vi.fn(() => '<p>rich content</p>'),
    isActive: vi.fn(() => false),
    state: { selection: { empty: true } },
};

vi.mock('../../../src/server/spa/client/react/features/notes/editor/RichEditorCore', () => ({
    RichEditorCore: ({ onEditorReady, onChange }: { onEditorReady?: (ed: any) => void; onChange?: (ed: any) => void }) => {
        capturedOnEditorReady = onEditorReady ?? null;
        capturedOnChange = onChange ?? null;
        // Fire onEditorReady synchronously so the parent can get the editor ref
        React.useEffect(() => {
            onEditorReady?.(mockEditor);
        }, [onEditorReady]);
        return <div data-testid="rich-editor-content" />;
    },
}));

/* ── Mock noteMarkdown ── */
const mockMarkdownToHtml = vi.fn((md: string) => `<p>${md}</p>`);
const mockHtmlToMarkdown = vi.fn((html: string) => {
    const match = html.match(/<p>(.*?)<\/p>/);
    return match ? match[1] + '\n' : '';
});

vi.mock('../../../src/server/spa/client/react/features/notes/editor/noteMarkdown', () => ({
    markdownToHtml: (...args: any[]) => mockMarkdownToHtml(...args),
    htmlToMarkdown: (...args: any[]) => mockHtmlToMarkdown(...args),
}));

/* ── Mock useTaskComments ── */
vi.mock('../../../src/server/spa/client/react/tasks/hooks/useTaskComments', () => ({
    useTaskComments: () => ({
        comments: [],
        loading: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        copyResolvePrompt: vi.fn(),
        refresh: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
    }),
}));

/* ── Mock useMarkdownPreview ── */
vi.mock('../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: content ? `<p>${content}</p>` : '',
    }),
}));

/* ── Mock anchor creation ── */
vi.mock('@plusplusoneplusplus/forge/editor/anchor', () => ({
    createAnchorData: vi.fn(),
    DEFAULT_ANCHOR_MATCH_CONFIG: {},
}));

/* ── Mock extractDocumentContext ── */
vi.mock('../../../src/server/spa/client/react/utils/document-context', () => ({
    extractDocumentContext: vi.fn(() => ({ surroundingLines: 'ctx', nearestHeading: null, allHeadings: [] })),
}));

/* ── Mock useGlobalToast ── */
vi.mock('../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }),
}));

/* ── Mock SourceEditor ── */
vi.mock('../../../src/server/spa/client/react/shared/SourceEditor', () => ({
    SourceEditor: ({ content, onChange }: { content: string; onChange: (v: string) => void }) => (
        <textarea
            data-testid="source-editor"
            value={content}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));

/* ── Mock getApiBase ── */
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

/* ── Mock useApp ── */
vi.mock('../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { workspaces: [] }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: vi.fn() }),
}));

const RAW_CONTENT = '# Hello\nSome content here';

function mockJsonResponse(body: any, ok = true, status = 200): Response {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as any;
}

let fetchSpy: ReturnType<typeof vi.fn>;

function setupFetchSpy() {
    fetchSpy = vi.fn();
    (global as any).fetch = fetchSpy;
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/tasks/content?')) {
            return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT }));
        }
        if (url.includes('/comment-counts/')) {
            return Promise.resolve(mockJsonResponse({ counts: {} }));
        }
        if (url.includes('/comments/')) {
            return Promise.resolve(mockJsonResponse({ comments: [] }));
        }
        return Promise.resolve(mockJsonResponse({}));
    });
    return fetchSpy;
}

async function renderAndWait(props: Record<string, any> = {}) {
    const result = render(
        <MarkdownReviewEditor wsId="ws1" filePath="test.md" fetchMode="tasks" {...props} />
    );
    await waitFor(() => {
        expect(
            document.querySelector('#task-preview-body') ||
            document.querySelector('[data-testid="source-editor"]') ||
            document.querySelector('[data-testid="rich-editor-content"]')
        ).toBeTruthy();
    });
    return result;
}

describe('MarkdownReviewEditor rich mode', () => {
    beforeEach(() => {
        capturedOnChange = null;
        capturedOnEditorReady = null;
        mockEditorCommands.setContent.mockReset();
        mockMarkdownToHtml.mockClear();
        mockHtmlToMarkdown.mockClear();
        mockEditor.getHTML.mockReturnValue('<p>rich content</p>');
        setupFetchSpy();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    describe('mode button visibility', () => {
        it('does not show Rich button when showRichMode is omitted', async () => {
            await renderAndWait();
            expect(screen.queryByText('Rich')).toBeNull();
            expect(screen.getByText('Preview')).toBeDefined();
            expect(screen.getByText('Source')).toBeDefined();
        });

        it('does not show Rich button when showRichMode is false', async () => {
            await renderAndWait({ showRichMode: false });
            expect(screen.queryByText('Rich')).toBeNull();
        });

        it('shows Rich button when showRichMode is true', async () => {
            await renderAndWait({ showRichMode: true });
            expect(screen.getByText('Rich')).toBeDefined();
            expect(screen.getByText('Preview')).toBeDefined();
            expect(screen.getByText('Source')).toBeDefined();
        });
    });

    describe('switching into rich mode', () => {
        it('renders the rich editor core when Rich button is clicked', async () => {
            await renderAndWait({ showRichMode: true });

            // Initially in review mode — no rich editor
            expect(screen.queryByTestId('rich-editor-content')).toBeNull();

            // Click Rich
            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            expect(screen.getByTestId('rich-editor-content')).toBeDefined();
        });

        it('loads content into editor via markdownToHtml when entering rich mode', async () => {
            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Wait for the useEffect to fire and setContent to be called
            await waitFor(() => {
                expect(mockMarkdownToHtml).toHaveBeenCalledWith(RAW_CONTENT);
            });
            expect(mockEditorCommands.setContent).toHaveBeenCalled();
        });

        it('shows Save button after making changes in rich mode', async () => {
            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Before changes, no save button (not dirty)
            expect(screen.queryByText('Save')).toBeNull();

            // Simulate a change via onChange callback
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Now dirty — save button should appear
            await waitFor(() => {
                expect(screen.getByText('Save')).toBeDefined();
            });
        });
    });

    describe('rich mode dirty state', () => {
        it('shows dirty indicator on Rich button after content change', async () => {
            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Simulate change
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // ModeToggleToolbar shows "Rich ●" when dirty
            await waitFor(() => {
                expect(screen.getByText('Rich ●')).toBeDefined();
            });
        });

        it('prompts confirm when switching from dirty rich to preview', async () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Make dirty
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Switch to Preview
            await act(async () => {
                fireEvent.click(screen.getByText('Preview'));
            });

            expect(confirmSpy).toHaveBeenCalledWith(
                'You have unsaved changes. Discard and switch to Preview?'
            );
            confirmSpy.mockRestore();
        });

        it('stays in rich mode when user cancels confirm on switch to preview', async () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Make dirty
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Try to switch to Preview — cancel
            await act(async () => {
                fireEvent.click(screen.getByText('Preview'));
            });

            // Should still be in rich mode
            expect(screen.getByTestId('rich-editor-content')).toBeDefined();
            confirmSpy.mockRestore();
        });

        it('prompts confirm when switching from dirty rich to source', async () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Make dirty
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Switch to Source
            await act(async () => {
                fireEvent.click(screen.getByText('Source'));
            });

            expect(confirmSpy).toHaveBeenCalledWith(
                'You have unsaved changes. Discard and switch to Source?'
            );
            confirmSpy.mockRestore();
        });
    });

    describe('rich mode saving', () => {
        it('saves rich content by converting html→markdown then PATCHing', async () => {
            mockHtmlToMarkdown.mockReturnValue('converted markdown\n');

            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Simulate editor change so we get dirty
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Mock PATCH success
            fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.includes('/tasks/content') && init?.method === 'PATCH') {
                    return Promise.resolve(mockJsonResponse({}, true, 200));
                }
                if (url.includes('/tasks/content?')) {
                    return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT }));
                }
                return Promise.resolve(mockJsonResponse({}));
            });

            // Click Save
            await act(async () => {
                fireEvent.click(screen.getByText('Save'));
            });

            // Verify htmlToMarkdown was called with the editor's HTML
            expect(mockHtmlToMarkdown).toHaveBeenCalledWith('<p>rich content</p>');

            // Verify the PATCH was made
            await waitFor(() => {
                const patchCall = fetchSpy.mock.calls.find(
                    (c: any[]) => c[1]?.method === 'PATCH'
                );
                expect(patchCall).toBeDefined();
                const body = JSON.parse(patchCall[1].body);
                expect(body.content).toBe('converted markdown\n');
            });
        });

        it('clears dirty state after successful save', async () => {
            mockHtmlToMarkdown.mockReturnValue('saved\n');

            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Make dirty
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Mock PATCH success
            fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.includes('/tasks/content') && init?.method === 'PATCH') {
                    return Promise.resolve(mockJsonResponse({}, true, 200));
                }
                if (url.includes('/tasks/content?')) {
                    return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT }));
                }
                return Promise.resolve(mockJsonResponse({}));
            });

            // Save
            await act(async () => {
                fireEvent.click(screen.getByText('Save'));
            });

            // After save, dirty indicator should be gone
            await waitFor(() => {
                expect(screen.queryByText('Rich ●')).toBeNull();
                expect(screen.queryByText('Save')).toBeNull();
            });
        });
    });

    describe('rich mode Ctrl+S', () => {
        it('triggers save on Ctrl+S in rich mode', async () => {
            mockHtmlToMarkdown.mockReturnValue('ctrl-s-saved\n');

            await renderAndWait({ showRichMode: true });

            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });

            // Make dirty
            await act(async () => {
                capturedOnChange?.(mockEditor);
            });

            // Mock PATCH
            fetchSpy.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                if (url.includes('/tasks/content') && init?.method === 'PATCH') {
                    return Promise.resolve(mockJsonResponse({}, true, 200));
                }
                if (url.includes('/tasks/content?')) {
                    return Promise.resolve(mockJsonResponse({ content: RAW_CONTENT }));
                }
                return Promise.resolve(mockJsonResponse({}));
            });

            // Fire Ctrl+S
            await act(async () => {
                fireEvent.keyDown(document, { key: 's', ctrlKey: true });
            });

            // Verify save was triggered
            await waitFor(() => {
                const patchCall = fetchSpy.mock.calls.find(
                    (c: any[]) => c[1]?.method === 'PATCH'
                );
                expect(patchCall).toBeDefined();
            });
        });
    });

    describe('existing behavior unchanged', () => {
        it('works normally without showRichMode prop', async () => {
            await renderAndWait();

            // Preview is shown
            expect(document.querySelector('#task-preview-body')).toBeTruthy();

            // No rich editor
            expect(screen.queryByTestId('rich-editor-content')).toBeNull();

            // Source mode works
            await act(async () => {
                fireEvent.click(screen.getByText('Source'));
            });
            expect(screen.getByTestId('source-editor')).toBeDefined();
        });

        it('preview and source modes work alongside rich mode', async () => {
            await renderAndWait({ showRichMode: true });

            // Start in preview
            expect(document.querySelector('#task-preview-body')).toBeTruthy();

            // Switch to source
            await act(async () => {
                fireEvent.click(screen.getByText('Source'));
            });
            expect(screen.getByTestId('source-editor')).toBeDefined();

            // Switch to rich
            await act(async () => {
                fireEvent.click(screen.getByText('Rich'));
            });
            expect(screen.getByTestId('rich-editor-content')).toBeDefined();

            // Switch back to preview
            await act(async () => {
                fireEvent.click(screen.getByText('Preview'));
            });
            expect(document.querySelector('#task-preview-body')).toBeTruthy();
        });
    });
});
