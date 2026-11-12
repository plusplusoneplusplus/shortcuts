/**
 * @vitest-environment jsdom
 *
 * Tests for the Whisper header's live subagent chip: the running count in the
 * collapsed header, the plain total once agents finish, and the hover list.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperSummary, WhisperAgent } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

vi.mock('../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: () => null,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView', () => ({
    ToolCallGroupView: () => null,
}));

afterEach(() => cleanup());

function renderHeader(summary: WhisperSummary) {
    return render(
        <WhisperCollapsedGroup
            precedingChunks={[]}
            summary={summary}
            toolById={new Map()}
            toolsWithChildren={new Set()}
            toolParentById={new Map()}
            isStreaming
            groupSingleLineMessages={false}
            workspaceId="test-ws"
            renderToolTree={() => null}
        />,
    );
}

const agents: WhisperAgent[] = [
    { id: 'a', label: '[explore] Find SSE code', running: false, startTime: 1_000, endTime: 6_000 },
    { id: 'b', label: 'Review the tests', running: true, startTime: 2_000 },
];

describe('Whisper subagent chip', () => {
    it('shows the running count and updates when an agent finishes', () => {
        const { getByTestId, rerender } = renderHeader({ toolCallCount: 2, messageCount: 0, agents, agentRunningCount: 1 });
        expect(getByTestId('whisper-agent-hover').textContent).toContain('1 agent running (1 done)');

        rerender(
            <WhisperCollapsedGroup
                precedingChunks={[]}
                summary={{ toolCallCount: 2, messageCount: 0, agents: agents.map(a => ({ ...a, running: false, endTime: 9_000 })), agentRunningCount: 0 }}
                toolById={new Map()}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                groupSingleLineMessages={false}
                renderToolTree={() => null}
            />,
        );
        expect(getByTestId('whisper-agent-hover').textContent).toBe('2 agents');
    });

    it('hides the chip when the turn has no subagents', () => {
        const { queryByTestId } = renderHeader({ toolCallCount: 2, messageCount: 0 });
        expect(queryByTestId('whisper-agent-hover')).toBeNull();
    });

    it('lists running agents first with elapsed time on hover', () => {
        const { getByTestId } = renderHeader({ toolCallCount: 2, messageCount: 0, agents, agentRunningCount: 1 });
        fireEvent.mouseEnter(getByTestId('whisper-agent-hover'));
        const popover = document.body.querySelector('[data-testid="agent-hover-popover"]') as HTMLElement;
        expect(popover).not.toBeNull();
        const rows = Array.from(popover.querySelectorAll('[data-testid^="agent-popover-row-"]'));
        expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['agent-popover-row-running', 'agent-popover-row-done']);
        expect(rows[0].textContent).toContain('Review the tests');
        expect(rows[1].textContent).toContain('[explore] Find SSE code');
        expect(rows[1].textContent).toContain('5.0s');
    });
});
