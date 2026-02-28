import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { GenerateTaskDialog } from '../../../src/server/spa/client/react/tasks/GenerateTaskDialog';
import { useQueueTaskGeneration } from '../../../src/server/spa/client/react/hooks/useQueueTaskGeneration';
import { usePreferences } from '../../../src/server/spa/client/react/hooks/usePreferences';

// ── mock useQueueTaskGeneration ─────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/useQueueTaskGeneration', () => ({
    useQueueTaskGeneration: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/hooks/usePreferences', () => ({
    usePreferences: vi.fn(),
}));

const mockClearImages = vi.fn();
const mockAddFromPaste = vi.fn();
const mockRemoveImage = vi.fn();

vi.mock('../../../src/server/spa/client/react/hooks/useImagePaste', () => ({
    useImagePaste: vi.fn(() => ({
        images: [],
        addFromPaste: mockAddFromPaste,
        removeImage: mockRemoveImage,
        clearImages: mockClearImages,
    })),
}));

import { useImagePaste } from '../../../src/server/spa/client/react/hooks/useImagePaste';

const mockUseQueueTaskGeneration = useQueueTaskGeneration as Mock;
const mockUsePreferences = usePreferences as Mock;
const mockUseImagePaste = useImagePaste as Mock;

function makeHookReturn(overrides: Record<string, unknown> = {}) {
    return {
        status: 'idle',
        taskId: null,
        error: null,
        enqueue: vi.fn(),
        reset: vi.fn(),
        ...overrides,
    };
}

// ── helpers ─────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

const mockPersistModel = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockPersistModel.mockReset();
    mockClearImages.mockReset();
    mockAddFromPaste.mockReset();
    mockRemoveImage.mockReset();
    global.fetch = mockFetch;
    mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn());
    mockUsePreferences.mockReturnValue({
        model: '',
        setModel: mockPersistModel,
        loaded: true,
    });
    mockUseImagePaste.mockReturnValue({
        images: [],
        addFromPaste: mockAddFromPaste,
        removeImage: mockRemoveImage,
        clearImages: mockClearImages,
    });

    // Default fetch: models + tasks
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('/queue/models')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ models: [] }),
            });
        }
        if (url.includes('/tasks')) {
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        name: 'root',
                        relativePath: '',
                        children: [],
                        documentGroups: [],
                        singleDocuments: [],
                    }),
            });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
});

function renderDialog(props: Partial<React.ComponentProps<typeof GenerateTaskDialog>> = {}) {
    const defaultProps = {
        wsId: 'ws-1',
        onSuccess: vi.fn(),
        onClose: vi.fn(),
        ...props,
    };
    return {
        ...render(
            <AppProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    <GenerateTaskDialog {...defaultProps} />
                </ToastProvider>
            </AppProvider>,
        ),
        props: defaultProps,
    };
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('GenerateTaskDialog', () => {
    it('renders idle state', async () => {
        await act(async () => { renderDialog(); });
        expect(screen.getByText('Generate Task')).toBeDefined();
        const prompt = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        expect(prompt).toBeDefined();
        expect(prompt.value).toBe('');
        expect(screen.getByText('Generate')).toBeDefined();
        // no streaming output panel in queue mode
        expect(document.getElementById('gen-task-output')).toBeNull();
    });

    it('Generate button disabled when prompt is empty', async () => {
        await act(async () => { renderDialog(); });
        const btn = document.getElementById('gen-task-generate') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('Generate button enabled when prompt has text', async () => {
        await act(async () => { renderDialog(); });
        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        const btn = document.getElementById('gen-task-generate') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('submit triggers enqueue() from hook', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith({
            prompt: 'hello',
            name: undefined,
            targetFolder: undefined,
            model: undefined,
            mode: 'from-feature',
            depth: 'deep',
            priority: 'normal',
        });
    });

    it('onSuccess callback fires with taskId on queued', async () => {
        const onSuccess = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'queued',
                taskId: 'task-abc',
            }),
        );

        await act(async () => { renderDialog({ onSuccess }); });

        expect(onSuccess).toHaveBeenCalledWith('task-abc');
    });

    it('error state shows error message and Retry button', async () => {
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'error',
                error: 'Network error',
            }),
        );

        await act(async () => { renderDialog(); });

        const errorDiv = document.getElementById('gen-task-error');
        expect(errorDiv).toBeDefined();
        expect(errorDiv!.textContent).toContain('Network error');
        expect(screen.getByText('Retry')).toBeDefined();
    });

    it('Retry button calls reset()', async () => {
        const resetSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'error',
                error: 'fail',
                reset: resetSpy,
            }),
        );

        await act(async () => { renderDialog(); });

        fireEvent.click(screen.getByText('Retry'));
        expect(resetSpy).toHaveBeenCalled();
    });

    it('Close button calls onClose when idle', async () => {
        const onClose = vi.fn();
        await act(async () => { renderDialog({ onClose }); });

        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('Generate button shows loading state when submitting', async () => {
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'submitting' }),
        );

        await act(async () => { renderDialog(); });

        const btn = document.getElementById('gen-task-generate') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('renders priority selector with default Normal', async () => {
        await act(async () => { renderDialog(); });

        const select = document.getElementById('gen-task-priority') as HTMLSelectElement;
        expect(select).toBeDefined();
        expect(select.value).toBe('normal');
        const options = Array.from(select.options).map(o => o.value);
        expect(options).toEqual(['high', 'normal', 'low']);
    });

    it('submit sends selected priority', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'test' } });

        const prioritySelect = document.getElementById('gen-task-priority') as HTMLSelectElement;
        fireEvent.change(prioritySelect, { target: { value: 'high' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ priority: 'high' }),
        );
    });

    it('populates model select from /api/queue/models', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-3'] }),
                });
            }
            if (url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('gpt-4');
            expect(options).toContain('claude-3');
        });
    });

    it('populates folder select from workspace tasks API', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: [] }),
                });
            }
            if (url.includes('/workspaces/ws-1/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [
                                {
                                    name: 'feature1',
                                    relativePath: 'feature1',
                                    children: [],
                                    documentGroups: [],
                                    singleDocuments: [],
                                },
                                {
                                    name: 'feature2',
                                    relativePath: 'feature2',
                                    children: [],
                                    documentGroups: [],
                                    singleDocuments: [],
                                },
                            ],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-folder') as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('feature1');
            expect(options).toContain('feature2');
        });
    });

    it('filters out .git folders from folder select', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: [] }),
                });
            }
            if (url.includes('/workspaces/ws-1/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [
                                {
                                    name: 'feature1',
                                    relativePath: 'feature1',
                                    children: [],
                                    documentGroups: [],
                                    singleDocuments: [],
                                },
                                {
                                    name: '.git',
                                    relativePath: '.git',
                                    children: [
                                        {
                                            name: 'refs',
                                            relativePath: '.git/refs',
                                            children: [],
                                            documentGroups: [],
                                            singleDocuments: [],
                                        },
                                    ],
                                    documentGroups: [],
                                    singleDocuments: [],
                                },
                            ],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-folder') as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('feature1');
            expect(options).not.toContain('.git');
            expect(options).not.toContain('.git/refs');
        });
    });

    // ── model persistence tests ──────────────────────────────────────────────

    it('restores saved model from preferences on mount', async () => {
        mockUsePreferences.mockReturnValue({
            model: 'gpt-4',
            setModel: mockPersistModel,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-3'] }),
                });
            }
            if (url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(select.value).toBe('gpt-4');
        });
    });

    it('persists model selection when user changes model', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-3'] }),
                });
            }
            if (url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(Array.from(select.options).map(o => o.value)).toContain('gpt-4');
        });

        const select = document.getElementById('gen-task-model') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'claude-3' } });

        expect(mockPersistModel).toHaveBeenCalledWith('claude-3');
        expect(select.value).toBe('claude-3');
    });

    it('persists empty string when user selects Default model', async () => {
        mockUsePreferences.mockReturnValue({
            model: 'gpt-4',
            setModel: mockPersistModel,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-3'] }),
                });
            }
            if (url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(select.value).toBe('gpt-4');
        });

        const select = document.getElementById('gen-task-model') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '' } });

        expect(mockPersistModel).toHaveBeenCalledWith('');
        expect(select.value).toBe('');
    });

    it('submit sends persisted model in enqueue call', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));
        mockUsePreferences.mockReturnValue({
            model: 'claude-3',
            setModel: mockPersistModel,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-3'] }),
                });
            }
            if (url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(select.value).toBe('claude-3');
        });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'test prompt' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'claude-3' }),
        );
    });

    it('does not override user-selected model when preferences load later', async () => {
        mockUsePreferences.mockReturnValue({
            model: '',
            setModel: mockPersistModel,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['gpt-4', 'claude-3'] }),
                });
            }
            if (url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const { rerender } = await act(async () =>
            renderDialog(),
        );

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(Array.from(select.options).map(o => o.value)).toContain('gpt-4');
        });

        const select = document.getElementById('gen-task-model') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'gpt-4' } });
        expect(select.value).toBe('gpt-4');

        // Simulate preferences loading with a different saved model
        mockUsePreferences.mockReturnValue({
            model: 'claude-3',
            setModel: mockPersistModel,
            loaded: true,
        });

        await act(async () => {
            rerender(
                <AppProvider>
                    <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                        <GenerateTaskDialog wsId="ws-1" onSuccess={vi.fn()} onClose={vi.fn()} />
                    </ToastProvider>
                </AppProvider>,
            );
        });

        // User's manual selection should not be overridden
        const selectAfter = document.getElementById('gen-task-model') as HTMLSelectElement;
        expect(selectAfter.value).toBe('gpt-4');
    });

    // ── depth selector tests ────────────────────────────────────────────────

    it('renders depth selector with default Deep', async () => {
        await act(async () => { renderDialog(); });
        const select = document.getElementById('gen-task-depth') as HTMLSelectElement;
        expect(select).toBeDefined();
        expect(select).not.toBeNull();
        expect(select.value).toBe('deep');
    });

    it('submit sends selected depth in enqueue call', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });

        const depthSelect = document.getElementById('gen-task-depth') as HTMLSelectElement;
        fireEvent.change(depthSelect, { target: { value: 'normal' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ depth: 'normal' }),
        );
    });

    it('submit sends deep depth by default', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ depth: 'deep' }),
        );
    });

    // ── image paste tests ────────────────────────────────────────────────────

    it('renders image previews when images are present', async () => {
        mockUseImagePaste.mockReturnValue({
            images: ['data:image/png;base64,abc', 'data:image/jpeg;base64,def'],
            addFromPaste: mockAddFromPaste,
            removeImage: mockRemoveImage,
            clearImages: mockClearImages,
        });

        await act(async () => { renderDialog(); });

        const imagesContainer = document.getElementById('gen-task-images');
        expect(imagesContainer).toBeDefined();
        expect(imagesContainer).not.toBeNull();
        const imgs = imagesContainer!.querySelectorAll('img');
        expect(imgs).toHaveLength(2);
    });

    it('does not render image previews when no images', async () => {
        await act(async () => { renderDialog(); });

        const imagesContainer = document.getElementById('gen-task-images');
        expect(imagesContainer).toBeNull();
    });

    it('submit sends images in enqueue payload', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));
        mockUseImagePaste.mockReturnValue({
            images: ['data:image/png;base64,abc'],
            addFromPaste: mockAddFromPaste,
            removeImage: mockRemoveImage,
            clearImages: mockClearImages,
        });

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                images: ['data:image/png;base64,abc'],
            }),
        );
    });

    it('submit sends images as undefined when no images pasted', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                images: undefined,
            }),
        );
    });

    it('clears images after successful queue', async () => {
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'queued',
                taskId: 'task-img',
            }),
        );

        await act(async () => { renderDialog(); });

        expect(mockClearImages).toHaveBeenCalled();
    });

    it('remove button calls removeImage with correct index', async () => {
        mockUseImagePaste.mockReturnValue({
            images: ['data:image/png;base64,abc', 'data:image/jpeg;base64,def'],
            addFromPaste: mockAddFromPaste,
            removeImage: mockRemoveImage,
            clearImages: mockClearImages,
        });

        await act(async () => { renderDialog(); });

        const removeButtons = document.querySelectorAll('[aria-label^="Remove image"]');
        expect(removeButtons).toHaveLength(2);

        fireEvent.click(removeButtons[1]);
        expect(mockRemoveImage).toHaveBeenCalledWith(1);
    });

    it('clicking a thumbnail opens the lightbox', async () => {
        mockUseImagePaste.mockReturnValue({
            images: ['data:image/png;base64,abc'],
            addFromPaste: mockAddFromPaste,
            removeImage: mockRemoveImage,
            clearImages: mockClearImages,
        });

        await act(async () => { renderDialog(); });

        expect(screen.queryByTestId('image-lightbox')).toBeNull();

        const img = document.querySelector('#gen-task-images img')!;
        fireEvent.click(img);

        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
        const lightboxImg = screen.getByTestId('image-lightbox').querySelector('img');
        expect(lightboxImg?.getAttribute('src')).toBe('data:image/png;base64,abc');
    });

    it('remove button does not open the lightbox', async () => {
        mockUseImagePaste.mockReturnValue({
            images: ['data:image/png;base64,abc'],
            addFromPaste: mockAddFromPaste,
            removeImage: mockRemoveImage,
            clearImages: mockClearImages,
        });

        await act(async () => { renderDialog(); });

        const removeBtn = document.querySelector('[aria-label="Remove image 1"]')!;
        fireEvent.click(removeBtn);

        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    // ── Ctrl+Enter keyboard shortcut tests ──────────────────────────────────

    it('Ctrl+Enter on textarea submits when prompt is non-empty', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Build a REST API' } });
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'Build a REST API' }),
        );
    });

    it('Cmd+Enter (metaKey) on textarea submits when prompt is non-empty', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'Build a REST API' } });
        fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });

        expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Enter does not submit when prompt is empty or whitespace', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;

        // empty
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
        expect(enqueueSpy).not.toHaveBeenCalled();

        // whitespace only
        fireEvent.change(textarea, { target: { value: '   ' } });
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('Ctrl+Enter does not submit while submitting', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ enqueue: enqueueSpy, status: 'submitting' }),
        );

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('Ctrl+Enter does not submit when already queued', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ enqueue: enqueueSpy, status: 'queued', taskId: 'q1' }),
        );

        await act(async () => { renderDialog({ onSuccess: vi.fn() }); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });

        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('plain Enter does not trigger submit', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });
        fireEvent.keyDown(textarea, { key: 'Enter' });

        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('shows Ctrl+Enter hint on the Generate button', async () => {
        await act(async () => { renderDialog(); });

        const kbd = document.querySelector('#gen-task-generate kbd');
        expect(kbd).toBeTruthy();
        expect(kbd!.textContent).toBe('Ctrl+Enter');
    });
});
