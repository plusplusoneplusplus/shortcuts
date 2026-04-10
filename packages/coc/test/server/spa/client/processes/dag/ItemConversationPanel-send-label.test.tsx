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

    it('shows "⚡ Send Now" when Ctrl is held (not sending)', async () => {
        mockModHeld = true;
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().textContent).toBe('⚡ Send Now');
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

    it('does not apply orange class when not sending', async () => {
        mockModHeld = true;
        render(<ItemConversationPanel processId="proc-1" onClose={vi.fn()} isDark={false} />);
        await waitFor(() => expect(getSendButton()).toBeTruthy());
        expect(getSendButton().className).not.toContain('bg-[#e8912d]');
    });
});
