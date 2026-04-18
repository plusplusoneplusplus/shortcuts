/**
 * @vitest-environment jsdom
 *
 * Tests for NewChatArea — focused on the queue_ prefix fix in handleSend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

const mockQueueDispatch = vi.fn();
const mockAppDispatch = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskIdByRepo: {} },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({
        state: {
            workspaces: [{ id: 'ws-1', rootPath: '/repos/myrepo' }],
            onboardingProgress: { hasUsedChat: false },
        },
        dispatch: mockAppDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        addFromPaste: vi.fn(),
        addFromFileInput: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: vi.fn(),
        error: null,
        toPayload: () => [],
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: vi.fn().mockImplementation(({ onChange, onKeyDown, placeholder, disabled, ...rest }: any) => (
        <input
            data-testid={rest['data-testid'] ?? 'rich-text-input'}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={onKeyDown}
        />
    )),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        ask: { border: 'border-blue-500', ring: 'ring-blue-500' },
    },
}));

vi.mock('../../../../../src/server/spa/client/react/shared/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

import { NewChatArea } from '../../../../../src/server/spa/client/react/repos/NewChatArea';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNewChatArea(workspaceId = 'ws-1') {
    return render(<NewChatArea workspaceId={workspaceId} />);
}

function typeInInput(text: string) {
    const input = screen.getByTestId('new-chat-input');
    fireEvent.change(input, { target: { value: text } });
}

async function clickSend() {
    const btn = screen.getByTestId('new-chat-send-btn');
    await act(async () => {
        fireEvent.click(btn);
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NewChatArea – queue_ prefix in handleSend', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches SELECT_QUEUE_TASK with queue_-prefixed ID when server returns bare task ID', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ task: { id: '1776470192018-abc' } }),
        });

        renderNewChatArea();
        typeInInput('Hello world');
        await clickSend();

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_1776470192018-abc',
                repoId: 'ws-1',
            });
        });
    });

    it('does not double-prefix if server returns an already-prefixed processId', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: 'queue_1776470192018-xyz' }),
        });

        renderNewChatArea();
        typeInInput('Hello world');
        await clickSend();

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_1776470192018-xyz',
                repoId: 'ws-1',
            });
        });
    });

    it('dispatches with queue_-prefixed ID when task ID comes from top-level id field', async () => {
        // Some API responses use newTask.id directly (no nested task)
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ id: '9999-no-task-wrapper' }),
        });

        renderNewChatArea();
        typeInInput('Test message');
        await clickSend();

        await waitFor(() => {
            expect(mockQueueDispatch).toHaveBeenCalledWith({
                type: 'SELECT_QUEUE_TASK',
                id: 'queue_9999-no-task-wrapper',
                repoId: 'ws-1',
            });
        });
    });

    it('shows error message when fetch fails', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error',
        });

        renderNewChatArea();
        typeInInput('Failing message');
        await clickSend();

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-error')).toBeTruthy();
        });
        expect(mockQueueDispatch).not.toHaveBeenCalled();
    });
});
