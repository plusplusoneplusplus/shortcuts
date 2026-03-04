/**
 * Tests for NewChatDialog — floating dialog for starting new chats.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { MinimizedDialogsProvider, MinimizedDialogsTray } from '../../../../src/server/spa/client/react/context/MinimizedDialogsContext';
import { NewChatDialog } from '../../../../src/server/spa/client/react/chat/NewChatDialog';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue([]),
}));

import { fetchApi } from '../../../../src/server/spa/client/react/hooks/useApi';
import type { Mock } from 'vitest';
const mockFetchApi = fetchApi as Mock;

vi.mock('../../../../src/server/spa/client/react/hooks/usePreferences', () => ({
    usePreferences: () => ({ model: '', setModel: vi.fn(), loaded: true }),
}));

const mockClearImages = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useImagePaste', () => ({
    useImagePaste: () => ({
        images: [],
        addFromPaste: vi.fn(),
        removeImage: vi.fn(),
        clearImages: mockClearImages,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/processes/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn }: any) => (
        <div data-testid="conversation-turn">{turn.content}</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/shared/ImagePreviews', () => ({
    ImagePreviews: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        highlightIndex: 0,
        filteredSkills: [],
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        dismissMenu: vi.fn(),
        selectSkill: vi.fn(),
        parseAndExtract: (text: string) => ({ skills: [], prompt: text }),
    }),
}));

// ── Helpers ────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

function renderDialog(props: Partial<React.ComponentProps<typeof NewChatDialog>> = {}) {
    const defaultProps: React.ComponentProps<typeof NewChatDialog> = {
        workspaceId: 'ws-1',
        workspacePath: '/path/to/repo',
        onMinimize: vi.fn(),
        onRestore: vi.fn(),
        onClose: vi.fn(),
        ...props,
    };
    return {
        ...render(
            <AppProvider>
                <MinimizedDialogsProvider>
                    <NewChatDialog {...defaultProps} />
                    <MinimizedDialogsTray />
                </MinimizedDialogsProvider>
            </AppProvider>,
        ),
        props: defaultProps,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('NewChatDialog', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockFetch.mockReset();
        mockClearImages.mockReset();
        global.fetch = mockFetch;

        // Re-setup fetchApi mock after restoreAllMocks
        mockFetchApi.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({ models: ['model-a', 'model-b'] });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({ skills: [] });
            }
            return Promise.resolve([]);
        });

        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ models: ['model-a', 'model-b'] }),
                });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ skills: [] }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });
    });

    // ── Rendering ──────────────────────────────────────────────────────

    it('renders the start screen with input and start button', async () => {
        await act(async () => { renderDialog(); });
        expect(screen.getByText('New Chat')).toBeDefined();
        expect(screen.getByTestId('new-chat-input')).toBeDefined();
        expect(screen.getByTestId('new-chat-start-btn')).toBeDefined();
    });

    it('renders with read-only title when readOnly=true', async () => {
        await act(async () => { renderDialog({ readOnly: true }); });
        expect(screen.getByText('New Chat (Read-Only)')).toBeDefined();
    });

    it('start button is disabled when input is empty', async () => {
        await act(async () => { renderDialog(); });
        const btn = screen.getByTestId('new-chat-start-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('start button is enabled when input has text', async () => {
        await act(async () => { renderDialog(); });
        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'hello world' } });
        const btn = screen.getByTestId('new-chat-start-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('renders read-only toggle checkbox', async () => {
        await act(async () => { renderDialog(); });
        expect(screen.getByTestId('new-chat-readonly-toggle')).toBeDefined();
    });

    it('renders model select dropdown', async () => {
        await act(async () => { renderDialog(); });
        expect(screen.getByTestId('new-chat-model-select')).toBeDefined();
    });

    // ── Close/Minimize ─────────────────────────────────────────────────

    it('renders via FloatingDialog with minimize and close buttons', async () => {
        await act(async () => { renderDialog(); });
        expect(document.querySelector('[data-testid="dialog-close-btn"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="dialog-minimize-btn"]')).not.toBeNull();
    });

    it('clicking close button calls onClose', async () => {
        const onClose = vi.fn();
        await act(async () => { renderDialog({ onClose }); });
        fireEvent.click(document.querySelector('[data-testid="dialog-close-btn"]')!);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('clicking minimize button calls onMinimize', async () => {
        const onMinimize = vi.fn();
        await act(async () => { renderDialog({ onMinimize }); });
        fireEvent.click(document.querySelector('[data-testid="dialog-minimize-btn"]')!);
        expect(onMinimize).toHaveBeenCalledOnce();
    });

    // ── Minimized pill ─────────────────────────────────────────────────

    it('renders minimized pill when minimized=true', async () => {
        await act(async () => { renderDialog({ minimized: true }); });
        expect(document.querySelector('[data-testid="minimized-pill-new-chat"]')).not.toBeNull();
        expect(screen.getByText(/New Chat/)).toBeDefined();
    });

    it('minimized pill shows read-only label', async () => {
        await act(async () => { renderDialog({ minimized: true, readOnly: true }); });
        const pill = document.querySelector('[data-testid="minimized-pill-new-chat"]');
        expect(pill).not.toBeNull();
        expect(pill!.textContent).toContain('Read-Only');
    });

    it('clicking minimized pill calls onRestore', async () => {
        const onRestore = vi.fn();
        await act(async () => { renderDialog({ minimized: true, onRestore }); });
        fireEvent.click(document.querySelector('[data-testid="minimized-pill-new-chat"]')!);
        expect(onRestore).toHaveBeenCalledOnce();
    });

    // ── Start chat flow ────────────────────────────────────────────────

    it('creates queue task on start and calls onChatCreated', async () => {
        const onChatCreated = vi.fn();
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
            }
            if (opts?.method === 'POST' && url.includes('/queue')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        task: { id: 'task-123', processId: 'proc-123', status: 'running' },
                    }),
                });
            }
            if (url.includes('/processes/')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        process: {
                            conversationTurns: [
                                { role: 'user', content: 'test prompt', timeline: [] },
                                { role: 'assistant', content: 'AI response', timeline: [] },
                            ],
                        },
                    }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const mockClose = vi.fn();
        const eventListeners: Record<string, Function> = {};
        (global as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: (event: string, fn: Function) => { eventListeners[event] = fn; },
            removeEventListener: vi.fn(),
            close: mockClose,
            onerror: null,
        }));

        await act(async () => { renderDialog({ onChatCreated }); });

        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'test prompt' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-start-btn'));
        });

        // Verify queue POST was called with correct body
        const postCall = mockFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST' && c[0].includes('/queue')
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse(postCall![1].body);
        expect(body.type).toBe('chat');
        expect(body.prompt).toBe('test prompt');
        expect(body.workspaceId).toBe('ws-1');

        // Fire SSE done to complete streaming
        await act(async () => {
            eventListeners['done']?.();
        });

        expect(onChatCreated).toHaveBeenCalledWith('task-123');
    });

    it('creates readonly-chat task when readOnly is true', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
            }
            if (opts?.method === 'POST' && url.includes('/queue')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        task: { id: 'task-456', processId: 'proc-456', status: 'running' },
                    }),
                });
            }
            if (url.includes('/processes/')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ process: { conversationTurns: [] } }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const eventListeners: Record<string, Function> = {};
        (global as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: (event: string, fn: Function) => { eventListeners[event] = fn; },
            removeEventListener: vi.fn(),
            close: vi.fn(),
            onerror: null,
        }));

        await act(async () => { renderDialog({ readOnly: true }); });

        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'readonly prompt' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-start-btn'));
        });

        const postCall = mockFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST' && c[0].includes('/queue')
        );
        expect(postCall).toBeDefined();
        const body = JSON.parse(postCall![1].body);
        expect(body.type).toBe('chat');
        expect(body.payload?.readonly).toBe(true);

        await act(async () => { eventListeners['done']?.(); });
    });

    it('shows error when queue POST fails', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
            }
            if (opts?.method === 'POST') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({ error: 'Queue full' }),
                });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        await act(async () => { renderDialog(); });
        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'test' } });
        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-start-btn'));
        });

        expect(screen.getByTestId('new-chat-error')).toBeDefined();
        expect(screen.getByText('Queue full')).toBeDefined();
    });

    // ── Dialog properties ──────────────────────────────────────────────

    it('renders as a FloatingDialog with resizable and correct id', async () => {
        await act(async () => { renderDialog(); });
        const dialog = document.getElementById('new-chat-dialog');
        expect(dialog).not.toBeNull();
        // Should have resize handles (resizable=true)
        expect(document.querySelector('[data-resize="se"]')).not.toBeNull();
    });

    it('dialog is draggable via title bar', async () => {
        await act(async () => { renderDialog(); });
        const dragHandle = document.querySelector('[data-testid="floating-dialog-drag-handle"]');
        expect(dragHandle).not.toBeNull();
        expect((dragHandle as HTMLElement).className).toContain('cursor-move');
    });

    it('Enter key submits the start-chat form', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (url.includes('/queue/models')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ models: [] }) });
            }
            if (url.includes('/skills')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
            }
            if (opts?.method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ task: { id: 't1', processId: 'p1', status: 'queued' } }),
                });
            }
            if (url.includes('/processes/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ process: { conversationTurns: [] } }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        });

        const eventListeners: Record<string, Function> = {};
        (global as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: (event: string, fn: Function) => { eventListeners[event] = fn; },
            removeEventListener: vi.fn(),
            close: vi.fn(),
            onerror: null,
        }));

        await act(async () => { renderDialog(); });
        const textarea = screen.getByTestId('new-chat-input') as HTMLTextAreaElement;
        fireEvent.change(textarea, { target: { value: 'enter test' } });
        await act(async () => {
            fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
        });

        const postCall = mockFetch.mock.calls.find(
            (c: any[]) => c[1]?.method === 'POST' && c[0].includes('/queue')
        );
        expect(postCall).toBeDefined();

        await act(async () => { eventListeners['done']?.(); });
    });

    // ── Cancel button on start screen ──────────────────────────────────

    it('Cancel button on start screen calls onClose', async () => {
        const onClose = vi.fn();
        await act(async () => { renderDialog({ onClose }); });
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
