/**
 * Tests for ConversationTurnBubble — run-script (terminal) rendering.
 *
 * Verifies that when `processType === 'run-script'` the bubble renders a dark
 * terminal block with a window-style title bar and the exit code is displayed
 * in the header — matching the conversation redesign design.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';
import { formatScriptResponse } from '../../../src/server/task-strategies/run-script-strategy';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: 0, groupSingleLineMessages: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makeTurn(overrides: Partial<ClientConversationTurn> = {}): ClientConversationTurn {
    return {
        role: 'assistant',
        content: '',
        timestamp: '2026-01-15T10:30:00Z',
        streaming: false,
        timeline: [],
        ...overrides,
    };
}

const SUCCESS_BODY = formatScriptResponse(
    'npm test -- ConversationArea',
    '/repo',
    true,
    'PASS  test/spa/react/repos/ConversationArea-sort-order.test.tsx\nPASS  test/spa/react/ConversationTurnBubble.test.tsx\n\nTest Suites: 3 passed, 3 total\nTests:       42 passed, 42 total\nTime:        4.812 s',
    '',
    0,
    false,
    4812,
);

const FAILED_BODY = formatScriptResponse('bad-cmd', undefined, false, '', 'fatal: oops', 127, false, 50);

const TIMEOUT_BODY = formatScriptResponse('sleep 100', undefined, false, '', '', null, true, 200);

describe('ConversationTurnBubble — script output (run-script)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders the terminal block instead of plain markdown for run-script turns', () => {
        const { getByTestId, queryByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: SUCCESS_BODY })}
                processType="run-script"
            />
        );
        expect(getByTestId('script-terminal-block')).toBeTruthy();
        // Markdown body should not be the primary script output.
        expect(queryByTestId('markdown-view')).toBeNull();
    });

    it('shows the script command in the term-bar label', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: SUCCESS_BODY })}
                processType="run-script"
            />
        );
        expect(getByTestId('script-terminal-label').textContent).toBe('npm test -- ConversationArea');
    });

    it('renders captured stdout inside the terminal pre', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: SUCCESS_BODY })}
                processType="run-script"
            />
        );
        const pre = getByTestId('script-terminal-pre');
        expect(pre.textContent).toContain('PASS');
        expect(pre.textContent).toContain('Tests:       42 passed, 42 total');
    });

    it('shows "exit 0" with success palette in the bubble header', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: SUCCESS_BODY })}
                processType="run-script"
            />
        );
        const exitLabel = getByTestId('script-exit-label');
        expect(exitLabel.textContent).toBe('exit 0');
        expect(exitLabel.className).toContain('text-[#15703a]');
    });

    it('shows "exit 127" with failure palette for non-zero exits', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: FAILED_BODY })}
                processType="run-script"
            />
        );
        const exitLabel = getByTestId('script-exit-label');
        expect(exitLabel.textContent).toBe('exit 127');
        expect(exitLabel.className).toContain('text-[#cf222e]');
    });

    it('shows "timed out" with failure palette for timeouts', () => {
        const { getByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: TIMEOUT_BODY })}
                processType="run-script"
            />
        );
        const exitLabel = getByTestId('script-exit-label');
        expect(exitLabel.textContent).toBe('timed out');
        expect(exitLabel.className).toContain('text-[#cf222e]');
    });

    it('uses the dark $_ avatar for script turns', () => {
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: SUCCESS_BODY })}
                processType="run-script"
            />
        );
        const avatar = container.querySelector('.turn-avatar') as HTMLElement;
        expect(avatar).toBeTruthy();
        expect(avatar.textContent).toBe('$_');
        expect(avatar.className).toContain('bg-[#1e1e1e]');
        expect(avatar.title).toBe('Script Output');
    });

    it('falls back to standard markdown rendering when content is not the formatScriptResponse shape', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: '# regular markdown\n\nHello world.' })}
                processType="run-script"
            />
        );
        // No terminal block when the script header is missing.
        expect(queryByTestId('script-terminal-block')).toBeNull();
        // Markdown view should render the regular content.
        expect(queryByTestId('markdown-view')).not.toBeNull();
        // No exit label either.
        expect(queryByTestId('script-exit-label')).toBeNull();
    });

    it('does not render the terminal block for assistant turns without processType=run-script', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ content: SUCCESS_BODY })}
            />
        );
        expect(queryByTestId('script-terminal-block')).toBeNull();
        expect(queryByTestId('script-exit-label')).toBeNull();
    });

    it('does not render the terminal block for user turns even with processType=run-script', () => {
        const { queryByTestId } = render(
            <ConversationTurnBubble
                turn={makeTurn({ role: 'user', content: SUCCESS_BODY })}
                processType="run-script"
            />
        );
        expect(queryByTestId('script-terminal-block')).toBeNull();
    });
});
