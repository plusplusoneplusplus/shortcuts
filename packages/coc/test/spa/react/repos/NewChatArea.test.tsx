/**
 * Tests for NewChatArea — the empty-state chat component on the Activity tab.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockQueueDispatch, mockAppState, mockFetch, mockToPayload, mockAddFromFileInput, mockAddFromPaste, mockClearAttachments, mockRemoveAttachment } = vi.hoisted(() => ({
    mockQueueDispatch: vi.fn(),
    mockAppState: {
        workspaces: [{ id: 'ws-1', rootPath: '/home/user/repo' }],
    },
    mockFetch: vi.fn(),
    mockToPayload: vi.fn(() => []),
    mockAddFromFileInput: vi.fn(),
    mockAddFromPaste: vi.fn(),
    mockClearAttachments: vi.fn(),
    mockRemoveAttachment: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({ state: {}, dispatch: mockQueueDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    getConfig: () => ({ apiBasePath: '/api' }),
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

vi.mock('../../../../src/server/spa/client/react/repos/CreateWorkItemDialog', () => ({
    CreateWorkItemDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        images: [],
        addFromPaste: mockAddFromPaste,
        addFromFileInput: mockAddFromFileInput,
        removeAttachment: mockRemoveAttachment,
        clearAttachments: mockClearAttachments,
        error: null,
        clearError: vi.fn(),
        toPayload: mockToPayload,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

import { NewChatArea } from '../../../../src/server/spa/client/react/repos/NewChatArea';

beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.workspaces = [{ id: 'ws-1', rootPath: '/home/user/repo' }];
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
        expect(screen.getByTestId('new-chat-attach-file-btn')).toBeTruthy();
    });

    it('does not render back button when onBack is not provided', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.queryByTestId('new-chat-back-btn')).toBeNull();
    });

    it('renders back button when onBack prop is provided', () => {
        render(<NewChatArea workspaceId="ws-1" onBack={vi.fn()} />);
        expect(screen.getByTestId('new-chat-back-btn')).toBeTruthy();
        expect(screen.getByTestId('new-chat-back-btn').textContent).toContain('Chats');
    });

    it('clicking back button calls onBack', () => {
        const onBack = vi.fn();
        render(<NewChatArea workspaceId="ws-1" onBack={onBack} />);
        fireEvent.click(screen.getByTestId('new-chat-back-btn'));
        expect(onBack).toHaveBeenCalledOnce();
    });

    it('send button is disabled when input is empty', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('send button is enabled after typing', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });
        const btn = screen.getByTestId('new-chat-send-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
    });

    it('does not render a mode selector (chat is always ask mode)', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.queryByTestId('new-chat-mode-dropdown')).toBeNull();
        expect(screen.queryByTestId('mode-cycle-btn')).toBeNull();
    });

    it('does not render quick-action buttons', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.queryByTestId('quick-ask-btn')).toBeNull();
        expect(screen.queryByTestId('quick-create-work-item-btn')).toBeNull();
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
        expect(body.payload.mode).toBe('ask');
        expect(body.payload.prompt).toBe('Hello world');
        expect(body.payload.workingDirectory).toBe('/home/user/repo');
        expect(body.payload.workspaceId).toBe('ws-1');

        expect(mockQueueDispatch).toHaveBeenCalledWith({
            type: 'SELECT_QUEUE_TASK',
            id: 'new-task-42',
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

    it('always sends mode=ask regardless of any prior state', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-ask' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Ask this' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.payload.mode).toBe('ask');
    });

    it('shows stop button while sending', async () => {
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
            expect(screen.getByTestId('new-chat-stop-btn').textContent).toBe('Stop');
        });

        // Resolve the fetch
        await act(async () => {
            resolvePost!({ ok: true, json: async () => ({ id: 'done' }) });
        });

        expect(screen.getByTestId('new-chat-send-btn').textContent).toBe('Send');
    });

    it('stop button cancels the send and reverts to send state', async () => {
        let rejectPost: (err: any) => void;
        mockFetch.mockReturnValueOnce(new Promise((_, r) => { rejectPost = r; }));

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        act(() => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-stop-btn')).toBeTruthy();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-stop-btn'));
            rejectPost!(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });

        expect(screen.getByTestId('new-chat-send-btn')).toBeTruthy();
        expect(screen.queryByTestId('new-chat-error')).toBeNull();
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

    it('renders attach file button with correct label', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        const btn = screen.getByTestId('new-chat-attach-file-btn');
        expect(btn.textContent).toBe('+');
        expect(btn.getAttribute('aria-label')).toBe('Attach file');
    });

    it('renders hidden file input for attachment', () => {
        render(<NewChatArea workspaceId="ws-1" />);
        expect(screen.getByTestId('new-chat-file-input-hidden')).toBeTruthy();
    });

    it('includes attachments in POST payload when present', async () => {
        const fakePayload = [{ name: 'test.txt', mimeType: 'text/plain', size: 100, dataUrl: 'data:text/plain;base64,abc' }];
        mockToPayload.mockReturnValueOnce(fakePayload);
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-with-attach' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello with file' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.attachments).toEqual(fakePayload);
    });

    it('does not include attachments key when payload is empty', async () => {
        mockToPayload.mockReturnValueOnce([]);
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-no-attach' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        const body = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(body.attachments).toBeUndefined();
    });

    it('clears attachments after successful send', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ id: 'task-clear' }),
        });

        render(<NewChatArea workspaceId="ws-1" />);
        const input = screen.getByTestId('new-chat-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'Hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('new-chat-send-btn'));
        });

        expect(mockClearAttachments).toHaveBeenCalled();
    });
});
