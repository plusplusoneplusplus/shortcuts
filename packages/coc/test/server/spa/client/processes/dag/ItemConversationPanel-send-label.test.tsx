/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

let mockModHeld = false;
vi.mock('../../../../../../src/server/spa/client/react/hooks/ui/useModifierKey', () => ({
    useModifierKey: () => mockModHeld,
}));

vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        processes: {
            get: vi.fn().mockResolvedValue({
                process: {
                    id: 'proc-1',
                    status: 'completed',
                    promptPreview: 'Hello',
                    result: 'World',
                    conversationTurns: [
                        { role: 'user', content: 'Hello', timeline: [] },
                        { role: 'assistant', content: 'World', timeline: [] },
                    ],
                },
            }),
            sendMessage: vi.fn().mockResolvedValue({}),
            stream: vi.fn(() => ({ close: vi.fn() })),
        },
    }),
}));

vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
}));

vi.mock('../../../../../../src/server/spa/client/react/utils/format', () => ({
    formatDuration: () => '1s',
    statusIcon: () => '✓',
    statusLabel: () => 'completed',
}));

vi.mock('../../../../../../src/server/spa/client/react/utils/workspace', () => ({
    getProcessWorkspaceId: () => 'ws-1',
}));

vi.mock('../../../../../../src/server/spa/client/react/ui', () => ({
    Badge: ({ children }: any) => <span>{children}</span>,
    Button: ({ children, className, title, disabled, onClick, ...rest }: any) => (
        <button
            className={className ?? ''}
            title={title}
            disabled={disabled}
            onClick={onClick}
            data-testid={rest['data-testid']}
        >
            {children}
        </button>
    ),
    Spinner: () => <span>loading...</span>,
    SendButton: ({ disabled, ctrlHeld, onSend, ...rest }: any) => {
        const testId = rest['data-testid'] ?? 'activity-chat-send-btn';
        const steering = ctrlHeld;
        return (
            <button
                disabled={disabled}
                className={steering ? 'bg-[#e8912d] hover:bg-[#c97a25]' : 'bg-[#0078d4] hover:bg-[#106ebe]'}
                onClick={() => onSend(steering ? 'immediate' : 'enqueue')}
                data-testid={testId}
                title={steering ? 'Release Ctrl to queue instead' : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
            >
                {steering ? '⚡ Steer' : 'Send'}
            </button>
        );
    },
}));

vi.mock('../../../../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble', () => ({
    ConversationTurnBubble: ({ turn }: any) => <div data-testid="turn">{turn.content}</div>,
}));

import { ItemConversationPanel } from '../../../../../../src/server/spa/client/react/processes/dag/ItemConversationPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSendButton() {
    return screen.getByTestId('item-conversation-send');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemConversationPanel – single send button', () => {
    beforeEach(() => {
        mockModHeld = false;
    });

    it('shows "Send" by default (not sending, no modifier)', async () => {
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().textContent).toBe('Send');
    });

    it('shows "⚡ Steer" when Ctrl is held (not sending)', async () => {
        mockModHeld = true;
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().textContent).toBe('⚡ Steer');
    });

    it('shows modifier-held tooltip when Ctrl is held', async () => {
        mockModHeld = true;
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().title).toBe('Release Ctrl to queue instead');
    });

    it('shows default tooltip when no modifier is held', async () => {
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().title).toBe('Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline');
    });

    it('applies orange class when Ctrl is held', async () => {
        mockModHeld = true;
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().className).toContain('bg-[#e8912d]');
    });

    it('no split-send-group is rendered', async () => {
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });
});
