/**
 * Tests for PullRequestChatPanel — PR chat side-panel component.
 *
 * Validates rendering in all states (empty, loading, error, active chat),
 * user interactions (send, close, Enter key), and prop-driven behavior.
 * Mirrors the CommitChatPanel test contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mockCreateChat = vi.fn();
const mockUsePullRequestChatBinding = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/pull-requests/hooks/usePullRequestChatBinding', () => ({
    usePullRequestChatBinding: (...args: any[]) => mockUsePullRequestChatBinding(...args),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/ChatDetail', () => ({
    ChatDetail: (props: any) => (
        <div data-testid="activity-chat-detail"
             data-task-id={props.taskId}
             data-variant={props.variant}
             data-standalone={props.standalone ? 'true' : undefined}
             data-title={props.title}
             data-hide-mode-selector={props.hideModeSelector ? 'true' : undefined}
        />
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: forwardRef<unknown, any>(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ onChange, onKeyDown, onPaste, placeholder, 'data-testid': testId, ...rest }, _ref) => (
            <input
                data-testid={testId ?? 'pr-chat-input'}
                placeholder={placeholder}
                onChange={(e: any) => onChange?.(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
            />
        ),
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

const mockAddFromPaste = vi.fn();
const mockClearAttachments = vi.fn();
const mockToPayload = vi.fn(() => []);

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        addFromPaste: mockAddFromPaste,
        removeAttachment: vi.fn(),
        clearAttachments: mockClearAttachments,
        error: null,
        toPayload: mockToPayload,
    }),
}));

import { PullRequestChatPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestChatPanel';

describe('PullRequestChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateChat.mockResolvedValue('new-task-id');
        mockToPayload.mockReturnValue([]);
    });

    const defaultProps = {
        workspaceId: 'ws1',
        prId: '142',
        prNumber: 142,
        prTitle: 'Add retry logic',
        repoId: 'ws1',
        onClose: vi.fn(),
    };

    function setupHook(overrides: Record<string, unknown> = {}) {
        mockUsePullRequestChatBinding.mockReturnValue({
            taskId: null,
            loading: false,
            error: null,
            createChat: mockCreateChat,
            ...overrides,
        });
    }

    // ========================================================================
    // Empty state
    // ========================================================================

    it('renders empty state when no conversation exists', async () => {
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        expect(screen.getByTestId('pr-chat-panel')).toBeTruthy();
        expect(screen.getByText('Chat about this PR')).toBeTruthy();
        expect(screen.getByTestId('pr-chat-send-btn')).toBeTruthy();
        expect(screen.getByTestId('compact-ai-settings-chip')).toBeTruthy();
        expect(screen.queryByTestId('agent-selector-chip-btn')).toBeNull();
        expect(screen.queryByTestId('mode-selector')).toBeNull();
        expect(screen.queryByTestId('model-picker-chip')).toBeNull();
        expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
        expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
        expect(screen.getByTestId('pr-chat-attach-btn')).toBeTruthy();
    });

    it('hides the empty-state panel header for framed review-chat lenses', async () => {
        setupHook();
        await act(async () => {
            render(<PullRequestChatPanel {...defaultProps} hideEmptyHeader />);
        });

        expect(screen.queryByTestId('pr-chat-close-btn')).toBeNull();
        expect(screen.queryByText('#142')).toBeNull();
        expect(screen.getByTestId('compact-ai-settings-chip')).toBeTruthy();
        expect(screen.getByTestId('pr-chat-send-btn')).toBeTruthy();
    });

    // ========================================================================
    // Loading state
    // ========================================================================

    it('shows loading text when loading is true', async () => {
        setupHook({ loading: true });
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        expect(screen.getByText('Loading...')).toBeTruthy();
    });

    // ========================================================================
    // Error state
    // ========================================================================

    it('shows error message when hook returns an error', async () => {
        setupHook({ error: 'Network error' });
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        expect(screen.getByText('Network error')).toBeTruthy();
    });

    // ========================================================================
    // Active chat (taskId present)
    // ========================================================================

    it('renders ChatDetail when taskId is present', async () => {
        setupHook({ taskId: 'task-123' });
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail).toBeTruthy();
        expect(detail.getAttribute('data-task-id')).toBe('task-123');
        expect(detail.getAttribute('data-variant')).toBe('floating');
        expect(detail.getAttribute('data-standalone')).toBe('true');
        expect(detail.getAttribute('data-hide-mode-selector')).toBe('true');
    });

    it('hides empty-state header when taskId is present', async () => {
        setupHook({ taskId: 'task-123' });
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        expect(screen.queryByTestId('pr-chat-close-btn')).toBeNull();
    });

    // ========================================================================
    // PR label display
    // ========================================================================

    it('shows #prNumber in panel header when prNumber is set', async () => {
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        expect(screen.getByText('#142')).toBeTruthy();
    });

    it('falls back to prId when prNumber is missing', async () => {
        setupHook();
        await act(async () => {
            render(
                <PullRequestChatPanel
                    workspaceId="ws1"
                    prId="PR-ABC"
                    repoId="ws1"
                    onClose={vi.fn()}
                />,
            );
        });
        expect(screen.getByText('PR-ABC')).toBeTruthy();
    });

    it('displays prNumber in ChatDetail title', async () => {
        setupHook({ taskId: 'task-123' });
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail.getAttribute('data-title')).toContain('#142');
    });

    // ========================================================================
    // Close button
    // ========================================================================

    it('calls onClose when close button is clicked', async () => {
        setupHook();
        const onClose = vi.fn();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} onClose={onClose} />); });

        await act(async () => { fireEvent.click(screen.getByTestId('pr-chat-close-btn')); });
        expect(onClose).toHaveBeenCalledOnce();
    });

    // ========================================================================
    // Send button
    // ========================================================================

    it('send button is disabled when input is empty', async () => {
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const sendBtn = screen.getByTestId('pr-chat-send-btn');
        expect(sendBtn.hasAttribute('disabled')).toBe(true);
    });

    // ========================================================================
    // Hook invocation
    // ========================================================================

    it('passes correct options to usePullRequestChatBinding', async () => {
        setupHook();
        await act(async () => {
            render(
                <PullRequestChatPanel
                    workspaceId="ws-test"
                    prId="999"
                    prNumber={999}
                    prTitle="My PR"
                    repoId="ws-test"
                    onClose={vi.fn()}
                />,
            );
        });

        expect(mockUsePullRequestChatBinding).toHaveBeenCalledWith({
            workspaceId: 'ws-test',
            prId: '999',
            prNumber: 999,
            prTitle: 'My PR',
            repoId: 'ws-test',
        });
    });

    // ========================================================================
    // Image paste support
    // ========================================================================

    it('wires onPaste handler from useFileAttachments to input', async () => {
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('pr-chat-input');
        fireEvent.paste(input);

        expect(mockAddFromPaste).toHaveBeenCalled();
    });

    it('clears attachments after sending', async () => {
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('pr-chat-input');
        fireEvent.change(input, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-chat-send-btn'));
        });

        expect(mockClearAttachments).toHaveBeenCalled();
    });

    it('passes attachments to createChat when present', async () => {
        const fakePayload = [{ type: 'image', data: 'data:image/png;base64,abc', name: 'img.png' }];
        mockToPayload.mockReturnValue(fakePayload);
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('pr-chat-input');
        fireEvent.change(input, { target: { value: 'check this' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-chat-send-btn'));
        });

        expect(mockCreateChat).toHaveBeenCalledWith('check this', expect.objectContaining({
            mode: 'ask',
            attachments: fakePayload,
            provider: 'copilot',
        }));
    });

    it('does not pass attachments when toPayload returns empty', async () => {
        mockToPayload.mockReturnValue([]);
        setupHook();
        await act(async () => { render(<PullRequestChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('pr-chat-input');
        fireEvent.change(input, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('pr-chat-send-btn'));
        });

        expect(mockCreateChat).toHaveBeenCalledWith('hello', expect.objectContaining({
            mode: 'ask',
            attachments: undefined,
            provider: 'copilot',
        }));
    });
});
