/**
 * Tests for NewChatArea — the empty-state chat component on the Activity tab.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockQueueDispatch, mockAppState, mockFetch, mockAppDispatch, mockModelCommand, mockSlashCommands } = vi.hoisted(() => ({
    mockQueueDispatch: vi.fn(),
    mockAppState: {
        workspaces: [{ id: 'ws-1', rootPath: '/home/user/repo' }],
        onboardingProgress: { hasUsedChat: false },
    } as Record<string, any>,
    mockFetch: vi.fn(),
    mockAppDispatch: vi.fn(),
    mockModelCommand: {
        modelMenuVisible: false,
        modelFilter: '',
        filteredModels: [],
        modelHighlightIndex: 0,
        modelOverride: null as string | null,
        setModelOverride: vi.fn(),
        handleModelSelect: vi.fn(),
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    },
    mockSlashCommands: {
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn(() => ({ skills: [], prompt: '' })),
        dismissMenu: vi.fn(),
    },
}));

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: mockAppDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [{ id: 'gpt-5.4', name: 'GPT-5.4', tokenLimit: 128000, enabled: true }], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/repos/useSlashCommands', () => ({
    useSlashCommands: () => mockSlashCommands,
}));

vi.mock('../../../../src/server/spa/client/react/repos/useModelCommand', () => ({
    useModelCommand: () => mockModelCommand,
}));

vi.mock('../../../../src/server/spa/client/react/repos/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/repos/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

// Minimal RichTextInput mock
vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', async () => {
    const R = await import('react');
    return {
        RichTextInput: R.forwardRef((props: any, ref: any) => {
            const [val, setVal] = R.useState('');
            R.useImperativeHandle(ref, () => ({
                getValue: () => val,
                setValue: (text: string) => setVal(text),
                focus: () => {},
            }), [val]);
            return R.createElement('input', {
                'data-testid': props['data-testid'],
                value: val,
                disabled: props.disabled,
                placeholder: props.placeholder,
                onChange: (e: any) => {
                    setVal(e.target.value);
                    props.onChange?.(e.target.value, e.target.selectionStart ?? 0);
                },
                onKeyDown: props.onKeyDown,
            });
        }),
    };
});

import { NewChatArea } from '../../../../src/server/spa/client/react/repos/NewChatArea';

beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.workspaces = [{ id: 'ws-1', rootPath: '/home/user/repo' }];
    mockAppState.onboardingProgress = { hasUsedChat: false };
    mockModelCommand.modelOverride = null;
    mockModelCommand.modelMenuVisible = false;
    globalThis.fetch = mockFetch;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('NewChatArea', () => {
    it('renders hero text and input elements', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByText('Start a new conversation')).toBeTruthy();
        expect(screen.getByText('Type a message below to begin')).toBeTruthy();
        expect(screen.getByTestId('new-chat-input')).toBeTruthy();
        expect(screen.getByTestId('new-chat-send-btn')).toBeTruthy();
    });

    it('send button is disabled when input is empty', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('send button has tooltip with keyboard shortcut hints', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn');
        expect(btn.getAttribute('title')).toBe(
            'Send (Enter) · Shift+Enter for newline',
        );
    });

    it('send button is enabled after typing', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('uses autopilot mode by default', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        // Mode dropdown should exist with autopilot as default
        const dropdown = screen.getByTestId('new-chat-mode-dropdown') as HTMLSelectElement;
        expect(dropdown.value).toBe('autopilot');
    });

    it('sends with default autopilot mode', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-ask' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.payload.mode).toBe('autopilot');
    });

    it('sends POST to /api/queue/tasks on submit and selects the new task', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'new-task-42' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello world' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toBe('/api/queue/tasks');
        expect(opts.method).toBe('POST');

        const body = JSON.parse(opts.body);
        expect(body.type).toBe('chat');
        expect(body.payload.kind).toBe('chat');
        expect(body.payload.mode).toBe('autopilot');
        expect(body.payload.prompt).toBe('Hello world');
        expect(body.payload.workingDirectory).toBe('/home/user/repo');
        expect(body.payload.workspaceId).toBe('ws-1');

        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'SELECT_QUEUE_TASK',
            id: 'queue_new-task-42',
            repoId: 'ws-1',
        });
    });

    it('shows error when POST fails', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error',
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'test message' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(screen.getByTestId('new-chat-error')).toBeTruthy();
        expect(screen.getByTestId('new-chat-error').textContent).toBe('Internal Server Error');
    });

    it('shows error when fetch throws', async () => {
        mockFetch.mockRejectedValueOnce(new Error('Network failure'));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'test' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(screen.getByTestId('new-chat-error').textContent).toBe('Network failure');
    });

    it('does not send when input is only whitespace', async () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '   ' } });

        // Button should still be disabled since trim() is empty
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('shows Stop button while sending', async () => {
        let resolvePost: (v: any) => void;
        mockFetch.mockReturnValueOnce(new Promise(r => { resolvePost = r; }));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        // Start sending but don't resolve yet
        act(() => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-stop-btn')).toBeTruthy();
            expect(screen.queryByTestId('new-chat-send-btn')).toBeNull();
        });

        // Resolve the fetch
        await act(async () => {
            resolvePost!({ ok: true, json: async () => ({ id: 'done' }) });
        });

        expect(screen.getByTestId('new-chat-send-btn')).toBeTruthy();
        expect(screen.queryByTestId('new-chat-stop-btn')).toBeNull();
    });

    it('Enter key triggers send', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'enter-task' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('Shift+Enter does not trigger send', async () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('handles missing workspace gracefully (no workingDirectory)', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'no-ws-task' }),
        });
        mockAppState.workspaces = [];

        render(<NewChatArea workspaceId="ws-unknown" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.payload.workingDirectory).toBeUndefined();
    });

    it('dispatches UPDATE_ONBOARDING with hasUsedChat after successful send', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-1' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockAppDispatch).toHaveBeenCalledWith({
            type: 'UPDATE_ONBOARDING',
            payload: { hasUsedChat: true },
        });
    });

    it('does not dispatch UPDATE_ONBOARDING if hasUsedChat is already true', async () => {
        mockAppState.onboardingProgress = { hasUsedChat: true };
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-2' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockAppDispatch).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'UPDATE_ONBOARDING' }),
        );
    });

    it('does not dispatch UPDATE_ONBOARDING when POST fails', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Server error',
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockAppDispatch).not.toHaveBeenCalled();
    });

    describe('model command in new chat', () => {
        it('shows model badge when modelOverride is set', () => {
            mockModelCommand.modelOverride = 'gpt-5.4';
            render(<NewChatArea workspaceId="ws-1" />);
            const badge = screen.getByTestId('new-chat-model-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent).toContain('gpt-5.4');
        });

        it('does not show model badge when modelOverride is null', () => {
            mockModelCommand.modelOverride = null;
            render(<NewChatArea workspaceId="ws-1" />);
            expect(screen.queryByTestId('new-chat-model-badge')).toBeNull();
        });

        it('includes model in payload when modelOverride is set', async () => {
            mockModelCommand.modelOverride = 'claude-sonnet-4.6';
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'model-task' }),
            });

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.payload.model).toBe('claude-sonnet-4.6');
        });

        it('does not include model in payload when modelOverride is null', async () => {
            mockModelCommand.modelOverride = null;
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ id: 'no-model-task' }),
            });

            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });

            await act(async () => {
                fireEvent.click(screen.getByTestId('new-chat-send-btn'));
            });

            const body = JSON.parse(mockFetch.mock.calls[0][1].body);
            expect(body.payload.model).toBeUndefined();
        });

        it('placeholder mentions slash commands', () => {
            render(<NewChatArea workspaceId="ws-1" />);
            const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
            expect(input.placeholder).toContain('type / for commands');
        });
    });
});
