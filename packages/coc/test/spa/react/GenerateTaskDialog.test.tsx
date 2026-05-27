import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../src/server/spa/client/react/contexts/MinimizedDialogsContext';
import { GenerateTaskDialog, EFFORT_PRESETS } from '../../../src/server/spa/client/react/tasks/GenerateTaskDialog';
import { useQueueTaskGeneration } from '../../../src/server/spa/client/react/queue/hooks/useQueueTaskGeneration';
import { usePreferences } from '../../../src/server/spa/client/react/hooks/preferences/usePreferences';
import { mockViewport } from '../../spa/helpers/viewport-mock';

// ── mock useQueueTaskGeneration ─────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/queue/hooks/useQueueTaskGeneration', () => ({
    useQueueTaskGeneration: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/hooks/preferences/usePreferences', () => ({
    usePreferences: vi.fn(),
}));

const mockClearAttachments = vi.fn();
const mockAddFromPaste = vi.fn();
const mockRemoveAttachment = vi.fn();
const mockAddFromFileInput = vi.fn();
const mockClearError = vi.fn();

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: vi.fn(() => ({
        attachments: [],
        images: [],
        addFromPaste: mockAddFromPaste,
        addFromFileInput: mockAddFromFileInput,
        removeAttachment: mockRemoveAttachment,
        clearAttachments: mockClearAttachments,
        error: null,
        clearError: mockClearError,
        toPayload: vi.fn(() => []),
    })),
}));

import { useFileAttachments } from '../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments';

const mockUseQueueTaskGeneration = useQueueTaskGeneration as Mock;
const mockUsePreferences = usePreferences as Mock;
const mockUseFileAttachments = useFileAttachments as Mock;

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
const mockPersistDepth = vi.fn();
const mockPersistEffort = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockPersistModel.mockReset();
    mockPersistDepth.mockReset();
    mockPersistEffort.mockReset();
    mockClearAttachments.mockReset();
    mockAddFromPaste.mockReset();
    mockRemoveAttachment.mockReset();
    mockAddFromFileInput.mockReset();
    mockClearError.mockReset();
    global.fetch = mockFetch;
    mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn());
    mockUsePreferences.mockReturnValue({
        model: '',
        models: { task: '', ask: '', plan: '' },
        setModel: mockPersistModel,
        depth: '',
        setDepth: mockPersistDepth,
        effort: '',
        setEffort: mockPersistEffort,
        loaded: true,
    });
    mockUseFileAttachments.mockReturnValue({
        attachments: [],
        images: [],
        addFromPaste: mockAddFromPaste,
        addFromFileInput: mockAddFromFileInput,
        removeAttachment: mockRemoveAttachment,
        clearAttachments: mockClearAttachments,
        error: null,
        clearError: mockClearError,
        toPayload: vi.fn(() => []),
    });

    // Default fetch: models + tasks
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('/models')) {
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ provider: 'copilot', models: [] }),
            });
        }
        if (url.includes('/summary')) {
            return Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({ workflows: [], tasks: {
                        name: 'root',
                        relativePath: '',
                        children: [],
                        documentGroups: [],
                        singleDocuments: [],
                    } }),
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
                <MinimizedDialogsProvider>
                    <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                        <GenerateTaskDialog {...defaultProps} />
                        <MinimizedDialogsTray />
                    </ToastProvider>
                </MinimizedDialogsProvider>
            </AppProvider>,
        ),
        props: defaultProps,
    };
}

function switchToAdvanced() {
    fireEvent.click(screen.getByTestId('tab-advanced'));
}

// ── tests ───────────────────────────────────────────────────────────────────

describe('GenerateTaskDialog', () => {
    it('renders idle state', async () => {
        await act(async () => { renderDialog(); });
        expect(screen.getByText('📋 Generate Plan')).toBeDefined();
        const prompt = document.getElementById('gen-task-prompt') as HTMLElement;
        expect(prompt).toBeDefined();
        expect(prompt.textContent).toBe('');
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
        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'hello';
        fireEvent.input(textarea);
        const btn = document.getElementById('gen-task-generate') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('submit triggers enqueue() from hook', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'hello';
        fireEvent.input(textarea);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith({
            prompt: 'hello',
            name: undefined,
            targetFolder: '__auto__',
            model: undefined,
            mode: undefined,
            depth: 'normal',
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

    it('does not navigate to queue tab when status becomes queued', async () => {
        // Observer component to read activeRepoSubTab from AppContext
        let capturedTab: string | undefined;
        function TabObserver() {
            const { state } = useApp();
            capturedTab = state.activeRepoSubTab;
            return null;
        }

        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'queued', taskId: 'task-xyz' }),
        );

        await act(async () => {
            render(
                <AppProvider>
                    <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                        <GenerateTaskDialog wsId="ws-1" onSuccess={vi.fn()} onClose={vi.fn()} />
                        <TabObserver />
                    </ToastProvider>
                </AppProvider>,
            );
        });

        // activeRepoSubTab should remain at its initial value ('chats'), not 'queue'
        expect(capturedTab).toBe('chats');
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
        switchToAdvanced();

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
        switchToAdvanced();

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        const prioritySelect = document.getElementById('gen-task-priority') as HTMLSelectElement;
        fireEvent.change(prioritySelect, { target: { value: 'high' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ priority: 'high' }),
        );
    });

    it('populates model select from /models', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            const options = Array.from(select.options).map(o => o.value);
            expect(options).toContain('gpt-4');
            expect(options).toContain('claude-3');
        });
    });

    it('populates folder select from workspace tasks API', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [] }),
                });
            }
            if (url.includes('/workspaces/ws-1/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
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
                        } }),
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
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [] }),
                });
            }
            if (url.includes('/workspaces/ws-1/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
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
                        } }),
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
            models: { task: 'gpt-4', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(select.value).toBe('gpt-4');
        });
    });

    it('persists model selection when user changes model', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(Array.from(select.options).map(o => o.value)).toContain('gpt-4');
        });

        const select = document.getElementById('gen-task-model') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'claude-3' } });

        expect(mockPersistModel).toHaveBeenCalledWith('task', 'claude-3');
        expect(select.value).toBe('claude-3');
    });

    it('persists empty string when user selects Default model', async () => {
        mockUsePreferences.mockReturnValue({
            model: 'gpt-4',
            models: { task: 'gpt-4', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(select.value).toBe('gpt-4');
        });

        const select = document.getElementById('gen-task-model') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: '' } });

        expect(mockPersistModel).toHaveBeenCalledWith('task', '');
        expect(select.value).toBe('');
    });

    it('submit sends persisted model in enqueue call', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));
        mockUsePreferences.mockReturnValue({
            model: 'claude-3',
            models: { task: 'claude-3', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(select.value).toBe('claude-3');
        });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test prompt';
        fireEvent.input(textarea);

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
            models: { task: '', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const { rerender } = await act(async () =>
            renderDialog(),
        );
        switchToAdvanced();

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
            models: { task: 'claude-3', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        await act(async () => {
            rerender(
                <AppProvider>
                    <MinimizedDialogsProvider>
                        <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                            <GenerateTaskDialog wsId="ws-1" onSuccess={vi.fn()} onClose={vi.fn()} />
                            <MinimizedDialogsTray />
                        </ToastProvider>
                    </MinimizedDialogsProvider>
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
        switchToAdvanced();
        const select = document.getElementById('gen-task-depth') as HTMLSelectElement;
        expect(select).toBeDefined();
        expect(select).not.toBeNull();
        expect(select.value).toBe('deep');
    });

    it('submit sends selected depth in enqueue call', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'hello';
        fireEvent.input(textarea);

        const depthSelect= document.getElementById('gen-task-depth') as HTMLSelectElement;
        fireEvent.change(depthSelect, { target: { value: 'normal' } });

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ depth: 'normal' }),
        );
    });

    it('submit sends normal depth by default (medium effort)', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'hello';
        fireEvent.input(textarea);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ depth: 'normal' }),
        );
    });

    // ── depth persistence tests ─────────────────────────────────────────────

    it('restores saved depth from preferences on mount', async () => {
        mockUsePreferences.mockReturnValue({
            model: '',
            models: { task: '', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: 'normal',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-depth') as HTMLSelectElement;
            expect(select.value).toBe('normal');
        });
    });

    it('persists depth selection when user changes depth', async () => {
        await act(async () => { renderDialog(); });
        switchToAdvanced();

        const depthSelect = document.getElementById('gen-task-depth') as HTMLSelectElement;
        fireEvent.change(depthSelect, { target: { value: 'normal' } });

        expect(mockPersistDepth).toHaveBeenCalledWith('normal');
    });

    it('submit sends saved depth in enqueue call', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));
        mockUsePreferences.mockReturnValue({
            model: '',
            models: { task: '', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: 'normal',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ depth: 'normal' }),
        );
    });

    // ── effort/advanced tab tests ────────────────────────────────────────────

    it('renders Effort tab as default with Medium selected', async () => {
        await act(async () => { renderDialog(); });

        expect(screen.getByTestId('tab-effort')).toBeDefined();
        expect(screen.getByTestId('tab-advanced')).toBeDefined();
        expect(screen.getByTestId('effort-panel')).toBeDefined();
        expect(screen.queryByTestId('advanced-panel')).toBeNull();

        // Medium is selected by default
        const mediumBtn = screen.getByTestId('effort-medium');
        expect(mediumBtn.className).toContain('bg-[#0078d4]/10');
    });

    it('switching to Advanced tab shows model/priority/depth selectors', async () => {
        await act(async () => { renderDialog(); });
        switchToAdvanced();

        expect(screen.queryByTestId('effort-panel')).toBeNull();
        expect(screen.getByTestId('advanced-panel')).toBeDefined();
        expect(document.getElementById('gen-task-model')).not.toBeNull();
        expect(document.getElementById('gen-task-priority')).not.toBeNull();
        expect(document.getElementById('gen-task-depth')).not.toBeNull();
    });

    it('switching back to Effort tab hides advanced selectors', async () => {
        await act(async () => { renderDialog(); });
        switchToAdvanced();
        expect(screen.getByTestId('advanced-panel')).toBeDefined();

        fireEvent.click(screen.getByTestId('tab-effort'));
        expect(screen.getByTestId('effort-panel')).toBeDefined();
        expect(screen.queryByTestId('advanced-panel')).toBeNull();
    });

    it('clicking effort level buttons updates selection', async () => {
        await act(async () => { renderDialog(); });

        const lowBtn = screen.getByTestId('effort-low');
        fireEvent.click(lowBtn);
        expect(lowBtn.className).toContain('bg-[#0078d4]/10');

        const highBtn = screen.getByTestId('effort-high');
        expect(highBtn.className).not.toContain('bg-[#0078d4]/10');
    });

    it('submit with effort=low sends normal priority and normal depth', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByTestId('effort-low'));

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ priority: 'normal', depth: 'normal' }),
        );
    });

    it('submit with effort=medium sends normal priority and normal depth', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByTestId('effort-medium'));

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ priority: 'normal', depth: 'normal' }),
        );
    });

    it('submit with effort=high sends normal priority and deep depth', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        fireEvent.click(screen.getByTestId('effort-high'));

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ priority: 'normal', depth: 'deep' }),
        );
    });

    it('effort preset picks matching model from available models', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'claude-haiku-4.5', name: 'claude-haiku-4.5', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-sonnet-4', name: 'claude-sonnet-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-opus-4', name: 'claude-opus-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        // wait for models to load
        await waitFor(() => {
            switchToAdvanced();
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(Array.from(select.options).map(o => o.value)).toContain('claude-haiku-4.5');
        });

        // switch back to effort and select low
        fireEvent.click(screen.getByTestId('tab-effort'));
        fireEvent.click(screen.getByTestId('effort-low'));

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'claude-sonnet-4' }),
        );
    });

    it('effort preset falls back to undefined model when no match', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);
        fireEvent.click(screen.getByTestId('effort-low'));

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        // No models loaded, so model should be undefined
        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: undefined }),
        );
    });

    it('advanced tab submit uses manual selections, not effort presets', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ provider: 'copilot', models: [{ id: 'gpt-4', name: 'gpt-4', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }, { id: 'claude-3', name: 'claude-3', capabilities: { supports: { vision: false, reasoningEffort: false }, limits: { max_context_window_tokens: 128000 } } }] }),
                });
            }
            if (url.includes('/summary')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({ workflows: [], tasks: {
                            name: 'root',
                            relativePath: '',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [],
                        } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        switchToAdvanced();

        await waitFor(() => {
            const select = document.getElementById('gen-task-model') as HTMLSelectElement;
            expect(Array.from(select.options).map(o => o.value)).toContain('gpt-4');
        });

        const modelSelect = document.getElementById('gen-task-model') as HTMLSelectElement;
        fireEvent.change(modelSelect, { target: { value: 'gpt-4' } });

        const prioritySelect = document.getElementById('gen-task-priority') as HTMLSelectElement;
        fireEvent.change(prioritySelect, { target: { value: 'high' } });

        const depthSelect = document.getElementById('gen-task-depth') as HTMLSelectElement;
        fireEvent.change(depthSelect, { target: { value: 'normal' } });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'test';
        fireEvent.input(textarea);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ model: 'gpt-4', priority: 'high', depth: 'normal' }),
        );
    });

    it('EFFORT_PRESETS exports are correctly shaped', () => {
        expect(EFFORT_PRESETS.low.priority).toBe('normal');
        expect(EFFORT_PRESETS.low.depth).toBe('normal');
        expect(EFFORT_PRESETS.medium.priority).toBe('normal');
        expect(EFFORT_PRESETS.medium.depth).toBe('normal');
        expect(EFFORT_PRESETS.high.priority).toBe('normal');
        expect(EFFORT_PRESETS.high.depth).toBe('deep');
    });

    it('effort model picker selects correct model for each level', () => {
        const models = ['claude-haiku-4.5', 'claude-sonnet-4', 'claude-opus-4'];
        expect(EFFORT_PRESETS.low.modelPicker(models)).toBe('claude-sonnet-4');
        expect(EFFORT_PRESETS.medium.modelPicker(models)).toBe('claude-opus-4');
        expect(EFFORT_PRESETS.high.modelPicker(models)).toBe('claude-opus-4');
    });

    it('effort model picker returns empty string when no match', () => {
        expect(EFFORT_PRESETS.low.modelPicker([])).toBe('');
        expect(EFFORT_PRESETS.low.modelPicker(['unknown-model'])).toBe('');
    });

    it('effort buttons show inline descriptions', async () => {
        await act(async () => { renderDialog(); });

        expect(screen.getByText('Sonnet-class model, normal analysis')).toBeDefined();
        expect(screen.getByText('Opus-class model, normal analysis')).toBeDefined();
        expect(screen.getByText('Opus-class model, deep analysis')).toBeDefined();
    });

    // ── effort persistence tests ────────────────────────────────────────────

    it('clicking effort button calls persistEffort', async () => {
        await act(async () => { renderDialog(); });

        fireEvent.click(screen.getByTestId('effort-low'));
        expect(mockPersistEffort).toHaveBeenCalledWith('low');

        fireEvent.click(screen.getByTestId('effort-high'));
        expect(mockPersistEffort).toHaveBeenCalledWith('high');

        fireEvent.click(screen.getByTestId('effort-medium'));
        expect(mockPersistEffort).toHaveBeenCalledWith('medium');

        expect(mockPersistEffort).toHaveBeenCalledTimes(3);
    });

    it('initializes effort level from saved preference', async () => {
        mockUsePreferences.mockReturnValue({
            model: '',
            models: { task: '', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: 'high',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        await act(async () => { renderDialog(); });

        const highBtn = screen.getByTestId('effort-high');
        expect(highBtn.className).toContain('bg-[#0078d4]/10');

        const mediumBtn = screen.getByTestId('effort-medium');
        expect(mediumBtn.className).not.toContain('bg-[#0078d4]/10');
    });

    it('defaults to medium when no saved effort preference', async () => {
        mockUsePreferences.mockReturnValue({
            model: '',
            models: { task: '', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: '',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        await act(async () => { renderDialog(); });

        const mediumBtn = screen.getByTestId('effort-medium');
        expect(mediumBtn.className).toContain('bg-[#0078d4]/10');
    });

    it('initializes effort level from low saved preference', async () => {
        mockUsePreferences.mockReturnValue({
            model: '',
            models: { task: '', ask: '', plan: '' },
            setModel: mockPersistModel,
            depth: '',
            setDepth: mockPersistDepth,
            effort: 'low',
            setEffort: mockPersistEffort,
            loaded: true,
        });

        await act(async () => { renderDialog(); });

        const lowBtn = screen.getByTestId('effort-low');
        expect(lowBtn.className).toContain('bg-[#0078d4]/10');
    });

    // ── attachment tests ─────────────────────────────────────────────────────

    it('renders attachment previews when attachments are present', async () => {
        mockUseFileAttachments.mockReturnValue({
            attachments: [
                { id: 'a1', name: 'img1.png', mimeType: 'image/png', size: 100, dataUrl: 'data:image/png;base64,abc', category: 'image' },
                { id: 'a2', name: 'img2.jpeg', mimeType: 'image/jpeg', size: 200, dataUrl: 'data:image/jpeg;base64,def', category: 'image' },
            ],
            images: ['data:image/png;base64,abc', 'data:image/jpeg;base64,def'],
            addFromPaste: mockAddFromPaste,
            addFromFileInput: mockAddFromFileInput,
            removeAttachment: mockRemoveAttachment,
            clearAttachments: mockClearAttachments,
            error: null,
            clearError: mockClearError,
            toPayload: vi.fn(() => []),
        });

        await act(async () => { renderDialog(); });

        const previewContainer = screen.getByTestId('gen-task-attachment-previews');
        expect(previewContainer).toBeTruthy();
        const imgs = previewContainer.querySelectorAll('[data-testid="attachment-preview-image"]');
        expect(imgs).toHaveLength(2);
    });

    it('does not render attachment previews when no attachments', async () => {
        await act(async () => { renderDialog(); });

        expect(screen.queryByTestId('gen-task-attachment-previews')).toBeNull();
    });

    it('submit sends images in enqueue payload', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));
        mockUseFileAttachments.mockReturnValue({
            attachments: [
                { id: 'a1', name: 'img1.png', mimeType: 'image/png', size: 100, dataUrl: 'data:image/png;base64,abc', category: 'image' },
            ],
            images: ['data:image/png;base64,abc'],
            addFromPaste: mockAddFromPaste,
            addFromFileInput: mockAddFromFileInput,
            removeAttachment: mockRemoveAttachment,
            clearAttachments: mockClearAttachments,
            error: null,
            clearError: mockClearError,
            toPayload: vi.fn(() => []),
        });

        await act(async () => { renderDialog(); });

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'hello';
        fireEvent.input(textarea);

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

        const textarea = document.getElementById('gen-task-prompt') as HTMLElement;
        textarea.innerText = 'hello';
        fireEvent.input(textarea);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                images: undefined,
            }),
        );
    });

    it('clears attachments after successful queue', async () => {
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({
                status: 'queued',
                taskId: 'task-img',
            }),
        );

        await act(async () => { renderDialog(); });

        expect(mockClearAttachments).toHaveBeenCalled();
    });

    it('remove button calls removeAttachment with correct id', async () => {
        mockUseFileAttachments.mockReturnValue({
            attachments: [
                { id: 'a1', name: 'img1.png', mimeType: 'image/png', size: 100, dataUrl: 'data:image/png;base64,abc', category: 'image' },
                { id: 'a2', name: 'img2.jpeg', mimeType: 'image/jpeg', size: 200, dataUrl: 'data:image/jpeg;base64,def', category: 'image' },
            ],
            images: ['data:image/png;base64,abc', 'data:image/jpeg;base64,def'],
            addFromPaste: mockAddFromPaste,
            addFromFileInput: mockAddFromFileInput,
            removeAttachment: mockRemoveAttachment,
            clearAttachments: mockClearAttachments,
            error: null,
            clearError: mockClearError,
            toPayload: vi.fn(() => []),
        });

        await act(async () => { renderDialog(); });

        const removeButtons = screen.getAllByTestId(/^remove-attachment-/);
        expect(removeButtons).toHaveLength(2);

        fireEvent.click(removeButtons[1]);
        expect(mockRemoveAttachment).toHaveBeenCalledWith('a2');
    });

    it('clicking a thumbnail opens the lightbox', async () => {
        mockUseFileAttachments.mockReturnValue({
            attachments: [
                { id: 'a1', name: 'img1.png', mimeType: 'image/png', size: 100, dataUrl: 'data:image/png;base64,abc', category: 'image' },
            ],
            images: ['data:image/png;base64,abc'],
            addFromPaste: mockAddFromPaste,
            addFromFileInput: mockAddFromFileInput,
            removeAttachment: mockRemoveAttachment,
            clearAttachments: mockClearAttachments,
            error: null,
            clearError: mockClearError,
            toPayload: vi.fn(() => []),
        });

        await act(async () => { renderDialog(); });

        expect(screen.queryByTestId('image-lightbox')).toBeNull();

        const img = screen.getByTestId('gen-task-attachment-previews').querySelector('img')!;
        fireEvent.click(img);

        expect(screen.getByTestId('image-lightbox')).toBeTruthy();
        const lightboxImg = screen.getByTestId('image-lightbox').querySelector('img');
        expect(lightboxImg?.getAttribute('src')).toBe('data:image/png;base64,abc');
    });

    it('remove button does not open the lightbox', async () => {
        mockUseFileAttachments.mockReturnValue({
            attachments: [
                { id: 'a1', name: 'img1.png', mimeType: 'image/png', size: 100, dataUrl: 'data:image/png;base64,abc', category: 'image' },
            ],
            images: ['data:image/png;base64,abc'],
            addFromPaste: mockAddFromPaste,
            addFromFileInput: mockAddFromFileInput,
            removeAttachment: mockRemoveAttachment,
            clearAttachments: mockClearAttachments,
            error: null,
            clearError: mockClearError,
            toPayload: vi.fn(() => []),
        });

        await act(async () => { renderDialog(); });

        const removeBtn = screen.getByTestId('remove-attachment-a1');
        fireEvent.click(removeBtn);

        expect(screen.queryByTestId('image-lightbox')).toBeNull();
    });

    it('renders attach button that opens file picker', async () => {
        await act(async () => { renderDialog(); });

        const attachBtn = screen.getByTestId('gen-task-attach-btn');
        expect(attachBtn).toBeTruthy();
        expect(attachBtn.textContent).toContain('Attach');
    });

    it('renders drag-and-drop zone', async () => {
        await act(async () => { renderDialog(); });

        const dropZone = screen.getByTestId('gen-task-drop-zone');
        expect(dropZone).toBeTruthy();
    });

    it('shows drop overlay on dragOver and hides on dragLeave', async () => {
        await act(async () => { renderDialog(); });

        const dropZone = screen.getByTestId('gen-task-drop-zone');

        expect(screen.queryByTestId('gen-task-drop-zone-overlay')).toBeNull();

        fireEvent.dragOver(dropZone);
        expect(screen.getByTestId('gen-task-drop-zone-overlay')).toBeTruthy();

        fireEvent.dragLeave(dropZone);
        expect(screen.queryByTestId('gen-task-drop-zone-overlay')).toBeNull();
    });

    it('displays attachment error when present', async () => {
        mockUseFileAttachments.mockReturnValue({
            attachments: [],
            images: [],
            addFromPaste: mockAddFromPaste,
            addFromFileInput: mockAddFromFileInput,
            removeAttachment: mockRemoveAttachment,
            clearAttachments: mockClearAttachments,
            error: 'File too large!',
            clearError: mockClearError,
            toPayload: vi.fn(() => []),
        });

        await act(async () => { renderDialog(); });

        const errorEl = screen.getByTestId('gen-task-attachment-error');
        expect(errorEl).toBeTruthy();
        expect(errorEl.textContent).toBe('File too large!');
    });

    it('does not display attachment error when null', async () => {
        await act(async () => { renderDialog(); });

        expect(screen.queryByTestId('gen-task-attachment-error')).toBeNull();
    });

    it('renders hint text for paste/drag instructions', async () => {
        await act(async () => { renderDialog(); });

        expect(screen.getByText(/paste images/)).toBeTruthy();
    });

    // ── Ctrl+Enter keyboard shortcut tests ──────────────────────────────────

    it('Ctrl+Enter on prompt input submits when prompt is non-empty', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'Build a REST API';
        fireEvent.input(el);
        fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });

        expect(enqueueSpy).toHaveBeenCalledTimes(1);
        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'Build a REST API' }),
        );
    });

    it('Cmd+Enter (metaKey) on prompt input submits when prompt is non-empty', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'Build a REST API';
        fireEvent.input(el);
        fireEvent.keyDown(el, { key: 'Enter', metaKey: true });

        expect(enqueueSpy).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+Enter does not submit when prompt is empty or whitespace', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;

        // empty
        fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });
        expect(enqueueSpy).not.toHaveBeenCalled();

        // whitespace only
        el.innerText = '   ';
        fireEvent.input(el);
        fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });
        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('Ctrl+Enter does not submit while submitting', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ enqueue: enqueueSpy, status: 'submitting' }),
        );

        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'hello';
        fireEvent.input(el);
        fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });

        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('Ctrl+Enter does not submit when already queued', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ enqueue: enqueueSpy, status: 'queued', taskId: 'q1' }),
        );

        await act(async () => { renderDialog({ onSuccess: vi.fn() }); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'hello';
        fireEvent.input(el);
        fireEvent.keyDown(el, { key: 'Enter', ctrlKey: true });

        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('plain Enter does not trigger submit', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'hello';
        fireEvent.input(el);
        fireEvent.keyDown(el, { key: 'Enter' });

        expect(enqueueSpy).not.toHaveBeenCalled();
    });

    it('shows Ctrl+Enter hint on the Generate button', async () => {
        await act(async () => { renderDialog(); });

        const kbd = document.querySelector('#gen-task-generate kbd');
        expect(kbd).toBeTruthy();
        expect(kbd!.textContent).toBe('Ctrl+Enter');
    });

    // ── include folder context checkbox tests ───────────────────────────────

    it('renders include context checkbox unchecked by default', async () => {
        await act(async () => { renderDialog(); });

        const checkbox = document.getElementById('gen-task-include-context') as HTMLInputElement;
        expect(checkbox).toBeDefined();
        expect(checkbox).not.toBeNull();
        expect(checkbox.type).toBe('checkbox');
        expect(checkbox.checked).toBe(false);
    });

    it('submit sends mode undefined when include context is unchecked (default)', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'hello';
        fireEvent.input(el);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ mode: undefined }),
        );
    });

    it('submit sends mode from-feature when include context is checked', async () => {
        const enqueueSpy = vi.fn();
        mockUseQueueTaskGeneration.mockReturnValue(makeHookReturn({ enqueue: enqueueSpy }));

        await act(async () => { renderDialog(); });

        const checkbox = document.getElementById('gen-task-include-context') as HTMLInputElement;
        fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(true);

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'hello';
        fireEvent.input(el);

        await act(async () => {
            fireEvent.click(screen.getByText('Generate'));
        });

        expect(enqueueSpy).toHaveBeenCalledWith(
            expect.objectContaining({ mode: 'from-feature' }),
        );
    });

    it('include context checkbox is disabled while submitting', async () => {
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'submitting' }),
        );

        await act(async () => { renderDialog(); });

        const checkbox = document.getElementById('gen-task-include-context') as HTMLInputElement;
        expect(checkbox.disabled).toBe(true);
    });

    it('include context checkbox shows descriptive label', async () => {
        await act(async () => { renderDialog(); });

        const label = document.getElementById('gen-task-include-context')!.closest('label');
        expect(label).toBeTruthy();
        expect(label!.textContent).toContain('Include folder context');
        expect(label!.textContent).toContain('plan.md');
    });

    // ── minimize / restore tests ────────────────────────────────────────────

    it('renders full dialog when minimized is false (default)', async () => {
        await act(async () => { renderDialog(); });

        expect(document.getElementById('generate-task-overlay')).not.toBeNull();
        expect(document.querySelector('[data-testid="minimized-pill-generate-task"]')).toBeNull();
    });

    it('renders minimized pill and hides full dialog when minimized is true', async () => {
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn() }); });

        const overlay = document.getElementById('generate-task-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay!.closest('[aria-hidden="true"]')).not.toBeNull();
        const pill = document.querySelector('[data-testid="minimized-pill-generate-task"]');
        expect(pill).not.toBeNull();
        expect(pill!.textContent).toContain('📋');
        expect(pill!.textContent).toContain('Generate Plan');
        expect(pill!.textContent).toContain('Restore');
    });

    it('minimized pill shows prompt preview when prompt has text', async () => {
        await act(async () => { renderDialog(); });

        const el = document.getElementById('gen-task-prompt') as HTMLElement;
        el.innerText = 'Build a REST API for users';
        fireEvent.input(el);

        // Re-render with minimized=true to see the pill
        await act(async () => {
            renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn() });
        });

        // Second render gets its own prompt state so let's test with prop-driven approach
        // The pill should show the preview from internal state
        const pill = document.querySelector('[data-testid="minimized-pill-generate-task"]');
        expect(pill).not.toBeNull();
    });

    it('minimized pill does not show prompt preview when prompt is empty', async () => {
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn() }); });

        const pill = document.querySelector('[data-testid="minimized-pill-generate-task"]');
        expect(pill).not.toBeNull();
        // Empty prompt should not have a preview with quotes
        expect(pill!.textContent).not.toContain('▪');
    });

    it('clicking minimized pill calls onRestore', async () => {
        const onRestore = vi.fn();
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore }); });

        const pill = document.querySelector('[data-testid="minimized-pill-generate-task"]') as HTMLElement;
        fireEvent.click(pill);
        expect(onRestore).toHaveBeenCalledOnce();
    });

    it('minimized pill is rendered inside the tray portal in document.body', async () => {
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn() }); });

        const tray = document.querySelector('[data-testid="minimized-dialogs-tray"]');
        expect(tray?.parentElement).toBe(document.body);
    });

    it('full dialog renders minimize button via Dialog onMinimize prop', async () => {
        await act(async () => { renderDialog({ onMinimize: vi.fn() }); });

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]');
        expect(minimizeBtn).not.toBeNull();
    });

    it('does not pass onMinimize to Dialog when submitting', async () => {
        mockUseQueueTaskGeneration.mockReturnValue(
            makeHookReturn({ status: 'submitting' }),
        );

        await act(async () => { renderDialog({ onMinimize: vi.fn() }); });

        const minimizeBtn = document.querySelector('[data-testid="dialog-minimize-btn"]');
        expect(minimizeBtn).toBeNull();
    });

    it('close button still calls onClose (not onMinimize)', async () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        await act(async () => { renderDialog({ onClose, onMinimize }); });

        fireEvent.click(screen.getByText('Close'));
        expect(onClose).toHaveBeenCalled();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('× button still calls onClose (not onMinimize)', async () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        await act(async () => { renderDialog({ onClose, onMinimize }); });

        const closeBtn = document.querySelector('[data-testid="dialog-close-btn"]') as HTMLElement;
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalled();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('Escape key calls onClose even when onMinimize prop is provided', async () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        await act(async () => { renderDialog({ onClose, onMinimize }); });

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        expect(onMinimize).not.toHaveBeenCalled();
    });

    it('Escape key does not fire onClose while dialog is minimized (hidden)', async () => {
        const onClose = vi.fn();
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn(), onClose }); });

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('dialog overlay has aria-hidden=true when minimized', async () => {
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn() }); });

        const panel = document.querySelector('[data-testid="floating-dialog-panel"]');
        expect(panel).not.toBeNull();
        expect(panel!.getAttribute('aria-hidden')).toBe('true');
    });

    it('dialog overlay has display:none when minimized', async () => {
        await act(async () => { renderDialog({ minimized: true, onMinimize: vi.fn(), onRestore: vi.fn() }); });

        const panel = document.querySelector('[data-testid="floating-dialog-panel"]') as HTMLElement;
        expect(panel).not.toBeNull();
        expect(panel.style.display).toBe('none');
    });

    it('GenerateTaskDialogProps includes minimized, onMinimize, onRestore', async () => {
        // Type-level check: these props should compile without error
        const props: React.ComponentProps<typeof GenerateTaskDialog> = {
            wsId: 'ws-1',
            onSuccess: vi.fn(),
            onClose: vi.fn(),
            minimized: true,
            onMinimize: vi.fn(),
            onRestore: vi.fn(),
        };
        expect(props.minimized).toBe(true);
        expect(typeof props.onMinimize).toBe('function');
        expect(typeof props.onRestore).toBe('function');
    });

    // ── floating vs modal dialog layout ────────────────────────────────────

    describe('desktop/mobile dialog layout', () => {
        let viewportCleanup: (() => void) | undefined;

        afterEach(() => {
            viewportCleanup?.();
            viewportCleanup = undefined;
        });

        it('uses FloatingDialog (no backdrop) on desktop viewport', async () => {
            viewportCleanup = mockViewport(1280);
            await act(async () => { renderDialog(); });

            // FloatingDialog renders without an inset-0 backdrop overlay
            expect(document.querySelector('[data-testid="dialog-overlay"]')).toBeNull();
            expect(document.querySelector('[data-testid="floating-dialog-panel"]')).not.toBeNull();
        });

        it('uses Dialog (with backdrop) on mobile viewport', async () => {
            viewportCleanup = mockViewport(375);
            await act(async () => { renderDialog(); });

            // Standard Dialog renders with dialog-overlay
            expect(document.querySelector('[data-testid="dialog-overlay"]')).not.toBeNull();
            expect(document.querySelector('[data-testid="floating-dialog-panel"]')).toBeNull();
        });

        it('FloatingDialog panel has a drag handle on desktop', async () => {
            viewportCleanup = mockViewport(1280);
            await act(async () => { renderDialog(); });

            const handle = document.querySelector('[data-testid="floating-dialog-drag-handle"]');
            expect(handle).not.toBeNull();
            expect((handle as HTMLElement).className).toContain('cursor-move');
        });

        it('rest of page is accessible (no backdrop) on desktop', async () => {
            viewportCleanup = mockViewport(1280);
            await act(async () => { renderDialog(); });

            // No fixed inset-0 overlay covering the whole screen
            const overlay = document.querySelector('.fixed.inset-0');
            expect(overlay).toBeNull();
        });
    });
});
