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
const mockEnqueueTask = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { selectedTaskIdByRepo: {} },
        dispatch: mockQueueDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            workspaces: [{ id: 'ws-1', rootPath: '/repos/myrepo' }],
            onboardingProgress: { hasUsedChat: false },
        },
        dispatch: mockAppDispatch,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueueTask },
        preferences: { patchGlobal: vi.fn().mockResolvedValue({}) },
        skills: { listAllWorkspace: vi.fn().mockResolvedValue({ merged: [] }) },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
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

vi.mock('../../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/modeConfig', () => ({
    MODE_BORDER_COLORS: {
        autopilot: { border: 'border-green-500', ring: 'ring-green-500' },
        ask: { border: 'border-yellow-500', ring: 'ring-yellow-500' },
        plan: { border: 'border-blue-500', ring: 'ring-blue-500' },
    },
    MODE_ICONS: {
        ask: '💡',
        plan: '📋',
        autopilot: '🤖',
    },
    MODE_LABELS: {
        ask: '💡 Ask',
        plan: '📋 Plan',
        autopilot: '🤖 Autopilot',
    },
    MODE_TOOLTIPS: {
        ask: 'Ask — get answers without making changes',
        plan: 'Plan — create a step-by-step plan',
        autopilot: 'Autopilot — execute changes automatically',
    },
    cycleMode: (current: string) => {
        const next: Record<string, string> = { autopilot: 'ask', ask: 'autopilot', plan: 'autopilot' };
        return next[current];
    },
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useSlashCommands', () => ({
    useSlashCommands: () => ({
        menuVisible: false,
        menuFilter: '',
        filteredSkills: [],
        highlightIndex: 0,
        handleInputChange: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        selectSkill: vi.fn(),
        parseAndExtract: vi.fn(() => ({ skills: [], prompt: '' })),
        dismissMenu: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useModelCommand', () => ({
    useModelCommand: () => ({
        modelMenuVisible: false,
        modelFilter: '',
        filteredModels: [],
        modelHighlightIndex: 0,
        modelOverride: null,
        setModelOverride: vi.fn(),
        handleModelSelect: vi.fn(),
        showModelMenu: vi.fn(),
        dismissModelMenu: vi.fn(),
        handleModelKeyDown: vi.fn(() => false),
        setModelFilter: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDefaultModelForMode', () => ({
    useDefaultModelForMode: () => ({ effectiveModel: undefined, effectiveModelName: undefined }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/SlashCommandMenu', () => ({
    SlashCommandMenu: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ModelCommandMenu', () => ({
    ModelCommandMenu: () => null,
}));

import { NewChatArea } from '../../../../../src/server/spa/client/react/features/chat/NewChatArea';

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
        mockEnqueueTask.mockResolvedValue({ task: { id: 'default-task' } });
    });

    it('dispatches SELECT_QUEUE_TASK with queue_-prefixed ID when server returns bare task ID', async () => {
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: '1776470192018-abc' } });

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
        mockEnqueueTask.mockResolvedValueOnce({ task: { id: 'queue_1776470192018-xyz' } });

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
        // Some API responses use result.id directly (no nested task)
        mockEnqueueTask.mockResolvedValueOnce({ id: '9999-no-task-wrapper' });

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

    it('shows error message when enqueue fails', async () => {
        mockEnqueueTask.mockRejectedValueOnce(new Error('Internal Server Error'));

        renderNewChatArea();
        typeInInput('Failing message');
        await clickSend();

        await waitFor(() => {
            expect(screen.getByTestId('new-chat-error')).toBeTruthy();
        });
        expect(mockQueueDispatch).not.toHaveBeenCalled();
    });
});
