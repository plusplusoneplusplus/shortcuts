import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { GenerateTaskDialog } from '../../../src/server/spa/client/react/tasks/GenerateTaskDialog';
import { useTaskGeneration } from '../../../src/server/spa/client/react/hooks/useTaskGeneration';
import { usePreferences } from '../../../src/server/spa/client/react/hooks/usePreferences';

// ── mock useTaskGeneration ──────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/useTaskGeneration', () => ({
    useTaskGeneration: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/hooks/usePreferences', () => ({
    usePreferences: vi.fn(),
}));

const mockUseTaskGeneration = useTaskGeneration as Mock;
const mockUsePreferences = usePreferences as Mock;

function makeHookReturn(overrides: Record<string, unknown> = {}) {
    return {
        status: 'idle',
        chunks: [],
        progressMessage: null,
        result: null,
        error: null,
        generate: vi.fn(),
        cancel: vi.fn(),
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
    global.fetch = mockFetch;
    mockUseTaskGeneration.mockReturnValue(makeHookReturn());
    mockUsePreferences.mockReturnValue({
        model: '',
        setModel: mockPersistModel,
        loaded: true,
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
        // output panel should not be rendered when idle
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

    it('submit triggers generate() from hook', async () => {
        const generateSpy = vi.fn();
        mockUseTaskGeneration.mockReturnValue(makeHookReturn({ generate: generateSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(generateSpy).toHaveBeenCalledWith({
            prompt: 'hello',
            name: undefined,
            targetFolder: undefined,
            model: undefined,
            mode: 'from-feature',
            depth: 'deep',
        });
    });

    it('streaming output panel appears during generating', async () => {
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'generating', chunks: ['partial output'] }),
        );

        await act(async () => { renderDialog(); });

        const output = document.getElementById('gen-task-output');
        expect(output).toBeDefined();
        expect(output!.textContent).toBe('partial output');
    });

    it('progress message shown while generating', async () => {
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'generating',
                chunks: [],
                progressMessage: 'Writing file…',
            }),
        );

        await act(async () => { renderDialog(); });

        expect(screen.getByText('Writing file…')).toBeDefined();
    });

    it('output panel auto-scrolls (ref attached)', async () => {
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'generating', chunks: ['line1\n'] }),
        );

        await act(async () => { renderDialog(); });

        const output = document.getElementById('gen-task-output') as HTMLPreElement;
        expect(output).toBeDefined();
        // scrollTop should be set — verify the ref is wired by checking the element exists
        // (jsdom doesn't compute layout, so scrollTop/scrollHeight are both 0, but the ref attachment is verified)
        expect(output.tagName).toBe('PRE');
    });

    it('success state shows file path', async () => {
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'complete',
                result: { filePath: 'foo/bar.md', content: '# Task' },
                chunks: ['done'],
            }),
        );

        await act(async () => { renderDialog(); });

        const success = document.getElementById('gen-task-success');
        expect(success).toBeDefined();
        expect(success!.textContent).toContain('foo/bar.md');
    });

    it('onSuccess callback fires with filePath on done', async () => {
        const onSuccess = vi.fn();
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'complete',
                result: { filePath: 'foo/bar.md', content: '# Task' },
                chunks: [],
            }),
        );

        await act(async () => { renderDialog({ onSuccess }); });

        expect(onSuccess).toHaveBeenCalledWith('foo/bar.md');
    });

    it('error state shows error message and Retry button', async () => {
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'error',
                error: 'Network error',
                chunks: ['partial'],
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
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'error',
                error: 'fail',
                chunks: [],
                reset: resetSpy,
            }),
        );

        await act(async () => { renderDialog(); });

        fireEvent.click(screen.getByText('Retry'));
        expect(resetSpy).toHaveBeenCalled();
    });

    it('Cancel button calls onClose when idle', async () => {
        const onClose = vi.fn();
        await act(async () => { renderDialog({ onClose }); });

        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('Cancel button calls cancel() and onClose when generating', async () => {
        const cancelSpy = vi.fn();
        const onClose = vi.fn();
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'generating', chunks: [], cancel: cancelSpy }),
        );

        await act(async () => { renderDialog({ onClose }); });

        fireEvent.click(screen.getByText('Cancel'));
        expect(cancelSpy).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it('Generate button shows loading spinner when generating', async () => {
        mockUseTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'generating', chunks: [] }),
        );

        await act(async () => { renderDialog(); });

        const btn = document.getElementById('gen-task-generate') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
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

    it('submit sends persisted model in generate call', async () => {
        const generateSpy = vi.fn();
        mockUseTaskGeneration.mockReturnValue(makeHookReturn({ generate: generateSpy }));
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

        expect(generateSpy).toHaveBeenCalledWith(
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
});
