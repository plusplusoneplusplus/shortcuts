/**
 * Tests for CommitChatPanel — commit chat sidebar component.
 *
 * Validates rendering in all states (empty, loading, error, active chat),
 * user interactions (send, close, Enter key), and prop-driven behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockCreateChat = vi.fn();
const mockUseCommitChatBinding = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitChatBinding', () => ({
    useCommitChatBinding: (...args: any[]) => mockUseCommitChatBinding(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetail', () => ({
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

vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: vi.fn().mockImplementation(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ onChange, onKeyDown, onPaste, placeholder, 'data-testid': testId, ...rest }: any) => (
            <input
                data-testid={testId ?? 'commit-chat-input'}
                placeholder={placeholder}
                onChange={(e: any) => onChange?.(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
            />
        ),
    ),
}));

// Mock AttachmentPreviews as a no-op
vi.mock('../../../../src/server/spa/client/react/ui/AttachmentPreviews', () => ({
    AttachmentPreviews: () => null,
}));

// Mock useFileAttachments
const mockCommitAddFromPaste = vi.fn();
const mockCommitClearAttachments = vi.fn();
const mockCommitToPayload = vi.fn(() => []);

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useFileAttachments', () => ({
    useFileAttachments: () => ({
        attachments: [],
        addFromPaste: mockCommitAddFromPaste,
        removeAttachment: vi.fn(),
        clearAttachments: mockCommitClearAttachments,
        error: null,
        toPayload: mockCommitToPayload,
    }),
}));

import { CommitChatPanel } from '../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel';

describe('CommitChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateChat.mockResolvedValue('new-task-id');
        mockCommitToPayload.mockReturnValue([]);
    });

    const defaultProps = {
        workspaceId: 'ws1',
        commitHash: 'abc123def456789012345678901234567890abcd',
        onClose: vi.fn(),
    };

    function setupHook(overrides: Record<string, unknown> = {}) {
        mockUseCommitChatBinding.mockReturnValue({
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
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();
        expect(screen.getByText('Chat about this commit')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-send-btn')).toBeTruthy();
        expect(screen.getByTestId('agent-selector-chip-btn')).toBeTruthy();
        expect(screen.getByTestId('mode-selector')).toBeTruthy();
        expect(screen.getByTestId('model-picker-chip')).toBeTruthy();
        expect(screen.getByTestId('effort-pill-selector')).toBeTruthy();
        expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeTruthy();
        expect(screen.getByTestId('commit-chat-attach-btn')).toBeTruthy();
    });

    // ========================================================================
    // Loading state
    // ========================================================================

    it('shows loading text when loading is true', async () => {
        setupHook({ loading: true });
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        expect(screen.getByText('Loading...')).toBeTruthy();
    });

    // ========================================================================
    // Error state
    // ========================================================================

    it('shows error message when hook returns an error', async () => {
        setupHook({ error: 'Network error' });
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        expect(screen.getByText('Network error')).toBeTruthy();
    });

    // ========================================================================
    // Active chat (taskId present)
    // ========================================================================

    it('renders ChatDetail when taskId is present', async () => {
        setupHook({ taskId: 'task-123' });
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail).toBeTruthy();
        expect(detail.getAttribute('data-task-id')).toBe('task-123');
        expect(detail.getAttribute('data-variant')).toBe('floating');
        expect(detail.getAttribute('data-standalone')).toBe('true');
        expect(detail.getAttribute('data-hide-mode-selector')).toBe('true');
    });

    it('hides header when taskId is present', async () => {
        setupHook({ taskId: 'task-123' });
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        expect(screen.queryByTestId('commit-chat-close-btn')).toBeNull();
    });

    // ========================================================================
    // Commit hash display
    // ========================================================================

    it('displays commit short hash in panel header', async () => {
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        // The header shows the first 7 chars of the hash
        expect(screen.getByText('abc123d')).toBeTruthy();
    });

    it('displays short hash in ChatDetail title', async () => {
        setupHook({ taskId: 'task-123' });
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const detail = screen.getByTestId('activity-chat-detail');
        expect(detail.getAttribute('data-title')).toContain('abc123d');
    });

    // ========================================================================
    // Close button
    // ========================================================================

    it('calls onClose when close button is clicked', async () => {
        setupHook();
        const onClose = vi.fn();
        await act(async () => { render(<CommitChatPanel {...defaultProps} onClose={onClose} />); });

        await act(async () => { fireEvent.click(screen.getByTestId('commit-chat-close-btn')); });
        expect(onClose).toHaveBeenCalledOnce();
    });

    // ========================================================================
    // Send button
    // ========================================================================

    it('send button is disabled when input is empty', async () => {
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const sendBtn = screen.getByTestId('commit-chat-send-btn');
        expect(sendBtn.hasAttribute('disabled')).toBe(true);
    });

    // ========================================================================
    // Hook invocation
    // ========================================================================

    it('passes correct options to useCommitChatBinding', async () => {
        setupHook();
        await act(async () => {
            render(
                <CommitChatPanel
                    workspaceId="ws-test"
                    commitHash="deadbeef"
                    commitMessage="fix: null check"
                    onClose={vi.fn()}
                />,
            );
        });

        expect(mockUseCommitChatBinding).toHaveBeenCalledWith({
            workspaceId: 'ws-test',
            commitHash: 'deadbeef',
            commitMessage: 'fix: null check',
        });
    });

    // ========================================================================
    // Image paste support
    // ========================================================================

    it('wires onPaste handler from useFileAttachments to input', async () => {
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('commit-chat-input');
        fireEvent.paste(input);

        expect(mockCommitAddFromPaste).toHaveBeenCalled();
    });

    it('clears attachments after sending', async () => {
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('commit-chat-input');
        fireEvent.change(input, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('commit-chat-send-btn'));
        });

        expect(mockCommitClearAttachments).toHaveBeenCalled();
    });

    it('passes attachments to createChat when present', async () => {
        const fakePayload = [{ type: 'image', data: 'data:image/png;base64,abc', name: 'img.png' }];
        mockCommitToPayload.mockReturnValue(fakePayload);
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('commit-chat-input');
        fireEvent.change(input, { target: { value: 'check this' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('commit-chat-send-btn'));
        });

        expect(mockCreateChat).toHaveBeenCalledWith('check this', expect.objectContaining({
            mode: 'ask',
            attachments: fakePayload,
            provider: 'copilot',
        }));
    });

    it('does not pass attachments when toPayload returns empty', async () => {
        mockCommitToPayload.mockReturnValue([]);
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} />); });

        const input = screen.getByTestId('commit-chat-input');
        fireEvent.change(input, { target: { value: 'hello' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('commit-chat-send-btn'));
        });

        expect(mockCreateChat).toHaveBeenCalledWith('hello', expect.objectContaining({
            mode: 'ask',
            attachments: undefined,
            provider: 'copilot',
        }));
    });

    it('sends the first hidden-header lens message through the existing binding exactly once', async () => {
        setupHook();
        await act(async () => { render(<CommitChatPanel {...defaultProps} hideEmptyHeader />); });

        expect(screen.queryByTestId('commit-chat-close-btn')).toBeNull();
        expect(mockUseCommitChatBinding).toHaveBeenCalledWith({
            workspaceId: defaultProps.workspaceId,
            commitHash: defaultProps.commitHash,
            commitMessage: undefined,
        });

        const input = screen.getByTestId('commit-chat-input');
        fireEvent.change(input, { target: { value: 'summarize the risky changes' } });

        await act(async () => {
            fireEvent.click(screen.getByTestId('commit-chat-send-btn'));
        });

        expect(mockCreateChat).toHaveBeenCalledTimes(1);
        expect(mockCreateChat).toHaveBeenCalledWith('summarize the risky changes', expect.objectContaining({
            mode: 'ask',
            attachments: undefined,
            provider: 'copilot',
        }));
    });
});
