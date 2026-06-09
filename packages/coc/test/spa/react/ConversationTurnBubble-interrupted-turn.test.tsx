import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, groupSingleLineMessages: true }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView', () => ({
    ToolCallView: ({ toolCall, children }: { toolCall: { id: string; toolName?: string; name?: string; status?: string }; children?: ReactNode }) => (
        <div
            data-testid="tool-call-view"
            data-tool-id={toolCall.id}
            data-tool-name={toolCall.toolName ?? toolCall.name}
            data-tool-status={toolCall.status}
        >
            {children}
        </div>
    ),
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: 'Partial answer before timeout.',
        timestamp: '2026-01-15T14:19:00Z',
        streaming: false,
        interrupted: true,
        interruptionReason: 'Request timed out after 90000ms',
        timeline: [
            {
                type: 'content',
                timestamp: '2026-01-15T14:19:01Z',
                content: 'Partial answer before timeout.',
            },
        ],
        ...overrides,
    };
}

describe('ConversationTurnBubble — interrupted assistant turns', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders a timeout banner without replacing the preserved partial transcript', () => {
        const { container, getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn()} />,
        );

        expect(getByTestId('interrupted-turn-banner')).toBeTruthy();
        expect(getByTestId('interrupted-turn-title').textContent).toBe('Partial response preserved');
        expect(getByTestId('interrupted-turn-reason').textContent).toContain('Request timed out');
        expect(container.querySelector('.chat-message.interrupted')).toBeTruthy();
        expect(container.querySelector('[data-testid="markdown-view"]')?.textContent).toContain('Partial answer before timeout.');
        expect(container.querySelector('[data-testid="error-strip"]')).toBeNull();
    });

    it('keeps already emitted tool-call history visible with the interrupted turn', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    timeline: [
                        {
                            type: 'content',
                            timestamp: '2026-01-15T14:19:01Z',
                            content: 'I will inspect the file.',
                        },
                        {
                            type: 'tool-start',
                            timestamp: '2026-01-15T14:19:02Z',
                            toolCall: {
                                id: 'tool-1',
                                toolName: 'bash',
                                args: { command: 'echo hi', description: 'Echo greeting' },
                                status: 'running',
                                startTime: '2026-01-15T14:19:02Z',
                            },
                        },
                        {
                            type: 'tool-complete',
                            timestamp: '2026-01-15T14:19:03Z',
                            toolCall: {
                                id: 'tool-1',
                                toolName: 'bash',
                                args: { command: 'echo hi', description: 'Echo greeting' },
                                result: 'hi',
                                status: 'completed',
                                startTime: '2026-01-15T14:19:02Z',
                                endTime: '2026-01-15T14:19:03Z',
                            },
                        },
                    ],
                })}
            />,
        );

        const toolView = getByTestId('tool-call-view');
        expect(toolView.getAttribute('data-tool-name')).toBe('bash');
        expect(toolView.getAttribute('data-tool-status')).toBe('completed');
        expect(getByTestId('interrupted-turn-banner')).toBeTruthy();
    });

    it('focuses the normal follow-up path when Continue / retry is clicked', async () => {
        const onContinue = vi.fn();
        const { getByTestId } = render(
            <ConversationTurnBubble turn={makeTurn()} onContinueInterrupted={onContinue} />,
        );

        await act(async () => {
            fireEvent.click(getByTestId('interrupted-turn-continue-btn'));
        });

        expect(onContinue).toHaveBeenCalledTimes(1);
    });

    it('does not render the interrupted banner for normal assistant turns or user turns', () => {
        const normal = render(<ConversationTurnBubble turn={makeTurn({ interrupted: false })} />);
        expect(normal.queryByTestId('interrupted-turn-banner')).toBeNull();
        normal.unmount();

        const user = render(<ConversationTurnBubble turn={makeTurn({ role: 'user' })} />);
        expect(user.queryByTestId('interrupted-turn-banner')).toBeNull();
    });
});
