/**
 * Tests for EnqueueDialog image/file attachment features:
 * - Image paste via clipboard
 * - File picker button (📎 Attach)
 * - Drag-and-drop zone
 * - Attachment previews rendered
 * - Attachment error display
 * - Images included in POST body
 * - Attachments cleared on submit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
import { EnqueueDialog } from '../../../../src/server/spa/client/react/queue/EnqueueDialog';
import { mockViewport } from '../../../spa/helpers/viewport-mock';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

function Wrap({ children, workspaces = [] }: { children: ReactNode; workspaces?: any[] }) {
    return (
        <AppProvider>
            <QueueProvider>
                <MinimizedDialogsProvider>
                    <WorkspaceSetter workspaces={workspaces} />
                    {children}
                    <MinimizedDialogsTray />
                </MinimizedDialogsProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function WorkspaceSetter({ workspaces }: { workspaces: any[] }) {
    const { dispatch } = useApp();
    useEffect(() => {
        if (workspaces.length > 0) {
            dispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

function DialogOpener({ mode }: { mode?: 'task' | 'ask' }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({ type: 'OPEN_DIALOG', mode });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return null;
}

// ── Mock helpers ───────────────────────────────────────────────────────

const OriginalFileReader = globalThis.FileReader;
let fileReaderCounter = 0;

function mockFileReader() {
    fileReaderCounter = 0;
    globalThis.FileReader = function (this: any) {
        const idx = fileReaderCounter++;
        this.onload = null;
        this.readAsDataURL = (file: File) => {
            if (this.onload) {
                const mimeType = file.type || 'image/png';
                this.onload({ target: { result: `data:${mimeType};base64,img${idx}` } });
            }
        };
    } as any;
}

function restoreFileReader() {
    if (OriginalFileReader) {
        globalThis.FileReader = OriginalFileReader;
    }
}

function createPasteEventWithImage(): React.ClipboardEvent {
    const file = new File(['pixel-data'], 'screenshot.png', { type: 'image/png' });
    const preventDefault = vi.fn();
    return {
        clipboardData: {
            items: [
                {
                    kind: 'file',
                    type: 'image/png',
                    getAsFile: () => file,
                },
            ],
        },
        preventDefault,
    } as unknown as React.ClipboardEvent;
}

function createPasteEventWithText(): React.ClipboardEvent {
    const preventDefault = vi.fn();
    return {
        clipboardData: {
            items: [
                {
                    kind: 'string',
                    type: 'text/plain',
                    getAsFile: () => null,
                },
            ],
        },
        preventDefault,
    } as unknown as React.ClipboardEvent;
}

function createDragEvent(type: string, files: File[] = []): React.DragEvent {
    const dataTransfer = {
        files,
        types: files.length > 0 ? ['Files'] : [],
    };
    return {
        type,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer,
    } as unknown as React.DragEvent;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('EnqueueDialog — Attachments', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let restoreViewport: (() => void) | undefined;

    beforeEach(() => {
        mockFileReader();
        // Mock crypto.randomUUID if not available
        if (!globalThis.crypto?.randomUUID) {
            (globalThis as any).crypto = {
                ...globalThis.crypto,
                randomUUID: () => `uuid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            };
        }
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
        fetchSpy.mockImplementation((url: string) => {
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            // Default: return a valid response for any URL (preferences, onboarding, etc.)
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        restoreFileReader();
        restoreViewport?.();
        restoreViewport = undefined;
    });

    it('renders the attach button when dialog is open', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        const attachBtn = screen.getByTestId('enqueue-attach-btn');
        expect(attachBtn).toBeTruthy();
        expect(attachBtn.textContent).toContain('Attach');
    });

    it('renders the hidden file input', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        const fileInput = screen.getByTestId('enqueue-file-input-hidden');
        expect(fileInput).toBeTruthy();
        expect(fileInput.getAttribute('type')).toBe('file');
        expect(fileInput.hasAttribute('multiple')).toBe(true);
    });

    it('renders the drag-and-drop zone', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        const dropZone = screen.getByTestId('enqueue-drop-zone');
        expect(dropZone).toBeTruthy();
    });

    it('shows paste/drag hint text', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });
        expect(screen.getByText(/paste images.*drag.*drop/i)).toBeTruthy();
    });

    it('clicking attach button triggers file input click', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const fileInput = screen.getByTestId('enqueue-file-input-hidden') as HTMLInputElement;
        const clickSpy = vi.spyOn(fileInput, 'click');
        const attachBtn = screen.getByTestId('enqueue-attach-btn');
        fireEvent.click(attachBtn);
        expect(clickSpy).toHaveBeenCalled();
    });

    it('adds image from paste event and shows preview', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const promptInput = screen.getByTestId('prompt-input');
        const pasteEvent = createPasteEventWithImage();

        act(() => {
            fireEvent.paste(promptInput, pasteEvent);
        });

        // Attachment preview should appear
        await waitFor(() => {
            const previews = screen.queryAllByTestId('attachment-preview-image');
            expect(previews.length).toBeGreaterThan(0);
        });
    });

    it('ignores non-image paste events', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const promptInput = screen.getByTestId('prompt-input');
        const pasteEvent = createPasteEventWithText();

        act(() => {
            fireEvent.paste(promptInput, pasteEvent);
        });

        // No attachment preview should appear
        const previews = screen.queryAllByTestId('attachment-preview-image');
        expect(previews).toHaveLength(0);
    });

    it('adds files via file input change event', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const fileInput = screen.getByTestId('enqueue-file-input-hidden');
        const file = new File(['image-data'], 'test-screenshot.png', { type: 'image/png' });

        act(() => {
            fireEvent.change(fileInput, { target: { files: [file] } });
        });

        await waitFor(() => {
            const previews = screen.queryAllByTestId('attachment-preview-image');
            expect(previews.length).toBeGreaterThan(0);
        });
    });

    it('shows drop zone overlay on drag over', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const dropZone = screen.getByTestId('enqueue-drop-zone');

        act(() => {
            fireEvent.dragOver(dropZone, createDragEvent('dragover'));
        });

        const overlay = screen.queryByTestId('drop-zone-overlay');
        expect(overlay).toBeTruthy();
        expect(overlay!.textContent).toContain('Drop files here');
    });

    it('hides drop zone overlay on drag leave', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const dropZone = screen.getByTestId('enqueue-drop-zone');

        act(() => {
            fireEvent.dragOver(dropZone, createDragEvent('dragover'));
        });
        expect(screen.queryByTestId('drop-zone-overlay')).toBeTruthy();

        act(() => {
            fireEvent.dragLeave(dropZone, createDragEvent('dragleave'));
        });
        expect(screen.queryByTestId('drop-zone-overlay')).toBeNull();
    });

    it('adds files on drop', async () => {
        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        const dropZone = screen.getByTestId('enqueue-drop-zone');
        const file = new File(['pixel-data'], 'dropped-image.png', { type: 'image/png' });

        act(() => {
            fireEvent.drop(dropZone, createDragEvent('drop', [file]));
        });

        await waitFor(() => {
            const previews = screen.queryAllByTestId('attachment-preview-image');
            expect(previews.length).toBeGreaterThan(0);
        });
    });

    it('includes images in POST body when submitting', async () => {
        let postBody: any = null;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                postBody = JSON.parse(opts?.body || '{}');
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap workspaces={[{ id: 'ws1', name: 'Test WS', rootPath: '/test' }]}>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Paste an image
        const promptInput = screen.getByTestId('prompt-input');
        const pasteEvent = createPasteEventWithImage();

        act(() => {
            fireEvent.paste(promptInput, pasteEvent);
        });

        // Wait for image to be processed
        await waitFor(() => {
            expect(screen.queryAllByTestId('attachment-preview-image').length).toBeGreaterThan(0);
        });

        // Enter a prompt
        promptInput.innerText = 'Test with image';
        fireEvent.input(promptInput);

        // Submit
        fireEvent.click(screen.getByText('Enqueue'));

        await waitFor(() => {
            expect(postBody).toBeTruthy();
        });

        // Verify images are included in the POST body
        expect(postBody.images).toBeDefined();
        expect(postBody.images).toHaveLength(1);
        expect(postBody.images[0]).toMatch(/^data:image\/png;base64,/);
    });

    it('clears attachments after successful submit', async () => {
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Paste an image
        const promptInput = screen.getByTestId('prompt-input');
        act(() => {
            fireEvent.paste(promptInput, createPasteEventWithImage());
        });

        await waitFor(() => {
            expect(screen.queryAllByTestId('attachment-preview-image').length).toBeGreaterThan(0);
        });

        // Enter prompt and submit
        promptInput.innerText = 'Test clear';
        fireEvent.input(promptInput);
        fireEvent.click(screen.getByText('Enqueue'));

        // Dialog closes — verify no attachment previews
        await waitFor(() => {
            expect(screen.queryAllByTestId('attachment-preview-image')).toHaveLength(0);
        });
    });

    it('renders in ask mode with attach button', async () => {
        render(
            <Wrap>
                <DialogOpener mode="ask" />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Ask AI (Read-only)')).toBeTruthy();
        });
        expect(screen.getByTestId('enqueue-attach-btn')).toBeTruthy();
    });

    it('disables attach button while submitting', async () => {
        let resolvePost: (() => void) | undefined;
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (typeof url === 'string' && url.includes('/queue') && opts?.method === 'POST') {
                return new Promise<any>(resolve => {
                    resolvePost = () => resolve({ ok: true, json: () => Promise.resolve({}) });
                });
            }
            if (typeof url === 'string' && url.includes('/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ provider: 'copilot', models: [] }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        render(
            <Wrap>
                <DialogOpener />
                <EnqueueDialog />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Enqueue AI Task')).toBeTruthy();
        });

        // Enter prompt
        const promptInput = screen.getByTestId('prompt-input');
        promptInput.innerText = 'Submit test';
        fireEvent.input(promptInput);

        // Submit — this will block since we control the promise
        fireEvent.click(screen.getByText('Enqueue'));

        // While submitting, attach button should be disabled
        await waitFor(() => {
            expect(screen.getByTestId('enqueue-attach-btn').hasAttribute('disabled')).toBe(true);
        });

        // Resolve the POST and wait for all effects to complete
        await act(async () => {
            resolvePost?.();
            // Allow microtasks to settle (handleSubmit continuation, onboarding dispatch, etc.)
            await new Promise(r => setTimeout(r, 10));
        });
    });
});
