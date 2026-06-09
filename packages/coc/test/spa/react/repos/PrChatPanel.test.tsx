/**
 * Tests for PrChatPanel — PR chat panel in the pop-out review window.
 *
 * Validates rendering in all states (empty, loading, error, active chat),
 * user interactions (send, close, Enter key), and PR-specific context.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

const mockCreateChat = vi.fn();
const mockUsePrChatBinding = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/usePrChatBinding', () => ({
    usePrChatBinding: (...args: any[]) => mockUsePrChatBinding(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/ChatDetail', () => ({
    ChatDetail: (props: any) => (
        <div data-testid="activity-chat-detail"
             data-task-id={props.taskId}
             data-variant={props.variant}
             data-standalone={props.standalone ? 'true' : undefined}
             data-title={props.title}
             data-hide-mode-selector={props.hideModeSelector ? 'true' : undefined}
             data-workspace-id={props.workspaceId}
        />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPreferencesProvider: ({ children }: any) => <div data-testid="chat-prefs-provider">{children}</div>,
}));

vi.mock('../../../../src/server/spa/client/react/shared/RichTextInput', () => ({
    RichTextInput: vi.fn().mockImplementation(
        ({ onChange, onKeyDown, onPaste, placeholder, 'data-testid': testId, ...rest }: any) => (
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
        removeAttachment: vi.fn(),
        clearAttachments: mockClearAttachments,
        error: null,
        toPayload: mockToPayload,
    }),
}));

import { PrChatPanel } from '../../../../src/server/spa/client/react/features/git/commits/PrChatPanel';

describe('PrChatPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCreateChat.mockResolvedValue('new-task-id');
        mockToPayload.mockReturnValue([]);
    });

    const defaultProps = {
        workspaceId: 'ws1',
        prId: '42',
        filePath: 'src/app.ts',
        onClose: vi.fn(),
    };

    function setBindingState(overrides: Partial<{
        taskId: string | null;
        loading: boolean;
        error: string | null;
        createChat: typeof mockCreateChat;
    }> = {}) {
        mockUsePrChatBinding.mockReturnValue({
            taskId: null,
            loading: false,
            error: null,
            createChat: mockCreateChat,
            ...overrides,
        });
    }

    describe('empty state (no chat yet)', () => {
        it('renders empty state UI with input', () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.getByTestId('pr-chat-panel')).toBeDefined();
            expect(screen.getByText('Chat about this PR')).toBeDefined();
            expect(screen.getByText('Ask questions about the changes')).toBeDefined();
            expect(screen.getByTestId('compact-ai-settings-chip')).toBeDefined();
            expect(screen.queryByTestId('agent-selector-chip-btn')).toBeNull();
            expect(screen.queryByTestId('mode-selector')).toBeNull();
            expect(screen.queryByTestId('model-picker-chip')).toBeNull();
            expect(screen.queryByTestId('effort-pill-selector')).toBeNull();
            expect(screen.getByTestId('chat-toolbar-slash-btn')).toBeDefined();
            expect(screen.queryByTestId('chat-toolbar-mention-btn')).toBeNull();
            expect(screen.getByTestId('pr-chat-attach-btn')).toBeDefined();
            expect(screen.getByTestId('pr-chat-send-btn')).toBeDefined();
        });

        it('shows PR ID badge', () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.getByText('#42')).toBeDefined();
        });

        it('shows current file name', () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.getByText('· app.ts')).toBeDefined();
        });

        it('does not show file name when filePath is undefined', () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} filePath={undefined} />);
            expect(screen.queryByText('· app.ts')).toBeNull();
        });

        it('has a disabled send button when input is empty', () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);
            const sendBtn = screen.getByTestId('pr-chat-send-btn');
            expect(sendBtn.hasAttribute('disabled')).toBe(true);
        });
    });

    describe('sending a message', () => {
        it('calls createChat with prompt text', async () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);

            const input = screen.getByTestId('pr-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Explain this change' } });
            await act(async () => {
                fireEvent.click(screen.getByTestId('pr-chat-send-btn'));
            });

            expect(mockCreateChat).toHaveBeenCalledWith('Explain this change', expect.objectContaining({
                mode: 'ask',
                attachments: undefined,
                provider: 'copilot',
            }));
        });

        it('sends on Enter key (without Shift)', async () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);

            const input = screen.getByTestId('pr-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });
            await act(async () => {
                fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
            });

            expect(mockCreateChat).toHaveBeenCalledWith('Hello', expect.objectContaining({
                mode: 'ask',
                attachments: undefined,
                provider: 'copilot',
            }));
        });

        it('does not send on Shift+Enter', async () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);

            const input = screen.getByTestId('pr-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Hello' } });
            await act(async () => {
                fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
            });

            expect(mockCreateChat).not.toHaveBeenCalled();
        });

        it('clears input and attachments after send', async () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);

            const input = screen.getByTestId('pr-chat-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'Test' } });
            await act(async () => {
                fireEvent.click(screen.getByTestId('pr-chat-send-btn'));
            });

            expect(mockClearAttachments).toHaveBeenCalled();
        });
    });

    describe('loading state', () => {
        it('shows loading indicator', () => {
            setBindingState({ loading: true });
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.getByText('Loading...')).toBeDefined();
        });
    });

    describe('error state', () => {
        it('shows error message', () => {
            setBindingState({ error: 'Network error' });
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.getByText('Network error')).toBeDefined();
        });
    });

    describe('active chat state', () => {
        it('renders ChatDetail when taskId is present', () => {
            setBindingState({ taskId: 'task-abc' });
            render(<PrChatPanel {...defaultProps} />);
            const detail = screen.getByTestId('activity-chat-detail');
            expect(detail.getAttribute('data-task-id')).toBe('task-abc');
            expect(detail.getAttribute('data-variant')).toBe('floating');
            expect(detail.getAttribute('data-standalone')).toBe('true');
            expect(detail.getAttribute('data-title')).toBe('PR Chat · #42');
            expect(detail.getAttribute('data-hide-mode-selector')).toBe('true');
            expect(detail.getAttribute('data-workspace-id')).toBe('ws1');
        });

        it('wraps ChatDetail in ChatPreferencesProvider', () => {
            setBindingState({ taskId: 'task-abc' });
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.getByTestId('chat-prefs-provider')).toBeDefined();
        });

        it('does not show empty state when taskId is set', () => {
            setBindingState({ taskId: 'task-abc' });
            render(<PrChatPanel {...defaultProps} />);
            expect(screen.queryByText('Chat about this PR')).toBeNull();
        });
    });

    describe('close button', () => {
        it('calls onClose when close button is clicked', () => {
            setBindingState();
            const onClose = vi.fn();
            render(<PrChatPanel {...defaultProps} onClose={onClose} />);
            fireEvent.click(screen.getByTestId('pr-chat-close-btn'));
            expect(onClose).toHaveBeenCalledOnce();
        });
    });

    describe('usePrChatBinding options', () => {
        it('passes workspaceId, prId, and filePath to hook', () => {
            setBindingState();
            render(<PrChatPanel {...defaultProps} />);
            expect(mockUsePrChatBinding).toHaveBeenCalledWith({
                workspaceId: 'ws1',
                prId: '42',
                filePath: 'src/app.ts',
            });
        });
    });
});
