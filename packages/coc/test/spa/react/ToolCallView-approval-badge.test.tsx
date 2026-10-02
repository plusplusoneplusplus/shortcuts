/**
 * @vitest-environment jsdom
 *
 * Tests for the LLM tool approval badge on a tool-call row: each settled
 * approval outcome renders its label in both row variants, a row without an
 * outcome renders no badge, and a running row's outcome survives the merge
 * with its terminal row in a rendered turn.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import { ToolCallVariantProvider, type ToolCallVariant } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallVariant';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

const START = '2026-01-02T15:04:05.000Z';

afterEach(() => cleanup());

function renderRow(overrides: Record<string, unknown> = {}, variant: ToolCallVariant = 'whisper-row') {
    return render(
        <ToolCallVariantProvider value={variant}>
            <ToolCallView
                toolCall={{
                    id: 'tc-1',
                    toolName: 'send_to_conversation',
                    args: { content: 'hi' },
                    status: 'completed',
                    startTime: START,
                    endTime: START,
                    result: 'ok',
                    ...overrides,
                }}
            />
        </ToolCallVariantProvider>
    );
}

describe('ToolCallView — approval badge', () => {
    it.each([
        ['approve-once', 'approved once'],
        ['approve-session', 'approved for session'],
        ['deny', 'denied'],
        ['auto-allowed', 'auto-allowed (no user present)'],
    ])('renders %s as "%s" in both variants', (outcome, label) => {
        for (const variant of ['whisper-row', 'card'] as const) {
            renderRow({ approvalOutcome: outcome }, variant);
            const badge = screen.getByTestId('tool-call-approval-badge');
            expect(badge.textContent).toBe(label);
            expect(badge.getAttribute('data-approval-outcome')).toBe(outcome);
            cleanup();
        }
    });

    it('renders no badge when the call was not gated', () => {
        renderRow();
        expect(screen.queryByTestId('tool-call-approval-badge')).toBeNull();
        cleanup();
        renderRow({}, 'card');
        expect(screen.queryByTestId('tool-call-approval-badge')).toBeNull();
    });
});

describe('ConversationTurnBubble — approval badge', () => {
    it('keeps the outcome when a terminal row merges into the running one', () => {
        const turn: ClientConversationTurn = {
            role: 'assistant',
            content: '',
            timestamp: START,
            streaming: false,
            timeline: [
                {
                    type: 'tool-start',
                    timestamp: START,
                    toolCall: { id: 'tc-9', toolName: 'send_to_conversation', args: { content: 'hi' }, status: 'running', startTime: START },
                },
                {
                    type: 'tool-failed',
                    timestamp: START,
                    toolCall: {
                        id: 'tc-9',
                        toolName: 'send_to_conversation',
                        args: {},
                        status: 'failed',
                        startTime: START,
                        endTime: START,
                        error: 'User denied this tool call.',
                        approvalOutcome: 'deny',
                    },
                },
            ],
        };
        render(<ConversationTurnBubble turn={turn} />);
        const badges = screen.getAllByTestId('tool-call-approval-badge');
        expect(badges).toHaveLength(1);
        expect(badges[0].textContent).toBe('denied');
    });
});
