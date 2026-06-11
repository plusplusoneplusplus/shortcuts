import { forwardRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockCreateChat = vi.fn();
const mockStartFreshChat = vi.fn();
const mockUseWorkItemChatBinding = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/work-items/hooks/useWorkItemChatBinding', () => ({
    useWorkItemChatBinding: (...args: any[]) => mockUseWorkItemChatBinding(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetail', () => ({
    ChatDetail: (props: any) => (
        <div
            data-testid="activity-chat-detail"
            data-task-id={props.taskId}
            data-variant={props.variant}
            data-standalone={props.standalone ? 'true' : undefined}
            data-title={props.title}
            data-hide-mode-selector={props.hideModeSelector ? 'true' : undefined}
            data-has-fresh-context-action={props.onStartFreshSameContext ? 'true' : 'false'}
            data-starting-fresh={props.startingFreshSameContext ? 'true' : 'false'}
        >
            {props.onStartFreshSameContext && (
                <button type="button" data-testid="mock-new-chat-same-context" onClick={props.onStartFreshSameContext}>
                    New chat with same context
                </button>
            )}
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: forwardRef<unknown, any>(
        ({ onChange, onKeyDown, onPaste, placeholder, 'data-testid': testId }, _ref) => (
            <input
                data-testid={testId ?? 'work-item-chat-input'}
                placeholder={placeholder}
                onChange={(e: any) => onChange?.(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
            />
        ),
    ),
}));

vi.mock('../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

const mockAddFromPaste = vi.fn();
const mockClearAttachments = vi.fn();
const mockToPayload = vi.fn(() => []);

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        addFromPaste: mockAddFromPaste,
        addFromFileInput: vi.fn(),
        removeAttachment: vi.fn(),
        clearAttachments: mockClearAttachments,
        error: null,
        toPayload: mockToPayload,
    }),
}));

import { WorkItemChatPanel } from '../../../../src/server/spa/client/react/features/work-items/WorkItemChatPanel';

describe('WorkItemChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateChat.mockResolvedValue('new-task-id');
        mockStartFreshChat.mockResolvedValue(true);
        mockToPayload.mockReturnValue([]);
    });

    const defaultProps = {
        workspaceId: 'ws-1',
        workItemId: 'wi-1',
        workItemNumber: 7,
        title: 'Fix saved title',
        status: 'planning',
        type: 'bug',
        onClose: vi.fn(),
    };

    function setupHook(overrides: Record<string, unknown> = {}) {
        mockUseWorkItemChatBinding.mockReturnValue({
            taskId: null,
            loading: false,
            error: null,
            createChat: mockCreateChat,
            startFreshChat: mockStartFreshChat,
            startingFresh: false,
            ...overrides,
        });
    }

    it('renders the empty composer with Work Item title and normal chat controls', async () => {
        setupHook();

        await act(async () => { render(<WorkItemChatPanel {...defaultProps} />); });

        expect(screen.getByTestId('work-item-chat-panel')).toBeTruthy();
        expect(screen.getByText('Chat about this Work Item')).toBeTruthy();
        expect(screen.getByText('BUG-7 · Fix saved title')).toBeTruthy();
        expect(screen.getByTestId('work-item-chat-send-btn')).toBeTruthy();
        expect(screen.getByTestId('compact-ai-settings-chip')).toBeTruthy();
        expect(screen.queryByTestId('agent-selector-chip-btn')).toBeNull();
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('model-picker-chip')).toBeNull();
        expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
        expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
        expect(screen.getByTestId('work-item-chat-attach-btn')).toBeTruthy();
    });

    it('shows loading and error states from the binding hook', async () => {
        setupHook({ loading: true });
        const { rerender } = render(<WorkItemChatPanel {...defaultProps} />);

        expect(screen.getByText('Loading...')).toBeTruthy();

        setupHook({ loading: false, error: 'Network error' });
        rerender(<WorkItemChatPanel {...defaultProps} />);

        expect(screen.getByText('Network error')).toBeTruthy();
    });

    it('renders ChatDetail for an existing remembered chat session', async () => {
        setupHook({ taskId: 'task-123' });

        await act(async () => { render(<WorkItemChatPanel {...defaultProps} />); });

        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail.getAttribute('data-task-id')).toBe('task-123');
        expect(detail.getAttribute('data-variant')).toBe('floating');
        expect(detail.getAttribute('data-standalone')).toBe('true');
        expect(detail.getAttribute('data-title')).toContain('BUG-7');
        expect(detail.getAttribute('data-hide-mode-selector')).toBe('true');
        expect(detail.getAttribute('data-has-fresh-context-action')).toBe('true');
        expect(screen.queryByTestId('work-item-chat-close-btn')).toBeNull();
    });

    it('passes the fresh same-context action into the active Work Item chat window', async () => {
        setupHook({ taskId: 'task-123', startingFresh: true });

        await act(async () => { render(<WorkItemChatPanel {...defaultProps} />); });

        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail.getAttribute('data-starting-fresh')).toBe('true');
        expect(screen.getByTestId('mock-new-chat-same-context').textContent).toBe('New chat with same context');
    });

    it('starts a fresh same-context Work Item chat from the active chat window action', async () => {
        setupHook({ taskId: 'task-123' });

        await act(async () => { render(<WorkItemChatPanel {...defaultProps} />); });

        await act(async () => {
            fireEvent.click(screen.getByTestId('mock-new-chat-same-context'));
        });

        expect(mockStartFreshChat).toHaveBeenCalledOnce();
    });

    it('shows active-chat errors as a compact banner without replacing ChatDetail', async () => {
        setupHook({ taskId: 'task-123', error: 'Failed to start fresh work item chat' });

        await act(async () => { render(<WorkItemChatPanel {...defaultProps} />); });

        expect(screen.getByTestId('work-item-chat-error-banner').textContent).toBe('Failed to start fresh work item chat');
        expect(screen.getByTestId('activity-chat-detail').getAttribute('data-task-id')).toBe('task-123');
    });

    it('passes only saved Work Item labels to the binding hook and warns for unsaved edits', async () => {
        setupHook();

        await act(async () => {
            render(<WorkItemChatPanel {...defaultProps} hasUnsavedChanges />);
        });

        expect(mockUseWorkItemChatBinding).toHaveBeenCalledWith({
            workspaceId: 'ws-1',
            workItemId: 'wi-1',
            title: 'Fix saved title',
            status: 'planning',
            type: 'bug',
            workItemNumber: 7,
        });
        expect(screen.getByTestId('work-item-chat-unsaved-warning').textContent).toContain('saved state only');
    });

    it('submits through createChat and keeps draft state scoped by Work Item', async () => {
        setupHook();

        await act(async () => { render(<WorkItemChatPanel {...defaultProps} />); });
        fireEvent.change(screen.getByTestId('work-item-chat-input'), { target: { value: 'What next?' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('work-item-chat-send-btn'));
        });

        expect(mockCreateChat).toHaveBeenCalledWith('What next?', expect.objectContaining({ mode: 'ask' }));
        expect(mockClearAttachments).toHaveBeenCalled();
    });
});
