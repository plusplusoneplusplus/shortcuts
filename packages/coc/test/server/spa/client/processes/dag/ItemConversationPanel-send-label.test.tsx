/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

let mockModHeld = false;
vi.mock('../../../../../../src/server/spa/client/react/hooks/useModifierKey', () => ({
    useModifierKey: () => mockModHeld,
}));

vi.mock('../../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({
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
}));

vi.mock('../../../../../../src/server/spa/client/react/utils/config', () => ({
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

vi.mock('../../../../../../src/server/spa/client/react/shared', () => ({
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
    SplitSendButton: ({ sending, disabled, ctrlHeld, onSend, ...rest }: any) => {
        const testId = rest['data-testid'] ?? 'activity-chat-send-btn';
        if (!sending) {
            return (
                <button
                    disabled={disabled}
                    className={ctrlHeld ? 'bg-[#e8912d] hover:bg-[#c97a25]' : 'bg-[#0078d4] hover:bg-[#106ebe]'}
                    onClick={() => onSend()}
                    data-testid={testId}
                    title={ctrlHeld ? 'Release Ctrl to queue instead' : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
                >
                    {ctrlHeld ? '⚡ Steer' : 'Send'}
                </button>
            );
        }
        return (
            <span data-testid="split-send-group">
                <button disabled={disabled} onClick={() => onSend('enqueue')} data-testid={testId} title="Queue after current response (Enter)">Queue</button>
                <button disabled={disabled} onClick={() => onSend('immediate')} data-testid="split-send-steer-btn" title="Inject into running session now (Ctrl+Enter)" className={ctrlHeld ? 'ring-2 ring-white' : ''}>⚡ Steer</button>
            </span>
        );
    },
}));

vi.mock('../../../../../../src/server/spa/client/react/processes/ConversationTurnBubble', () => ({
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

describe('ItemConversationPanel – dynamic send button label', () => {
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

    it('applies orange class when not sending and Ctrl is held', async () => {
        mockModHeld = true;
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().className).toContain('bg-[#e8912d]');
    });
});
