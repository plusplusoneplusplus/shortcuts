/**
 * Tests for WhisperCollapsedGroup — commit count in collapsed header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/processes/WhisperCollapsedGroup';
import type { WhisperSummary } from '../../../src/server/spa/client/react/processes/toolGroupUtils';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/shared', () => ({
    cn: (...args: string[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../src/server/spa/client/react/processes/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/processes/commitDetection', () => ({
    detectCommitsInToolGroup: () => [],
}));

vi.mock('../../../src/server/spa/client/react/processes/CommitStrip', () => ({
    CommitStrip: () => null,
}));

vi.mock('../../../src/server/spa/client/react/processes/ToolCallGroupView', () => ({
    ToolCallGroupView: () => <div data-testid="tool-call-group-view" />,
}));

vi.mock('../../../src/server/spa/client/react/processes/toolGroupUtils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        groupConsecutiveToolChunks: () => [],
    };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderHeader(summary: WhisperSummary) {
    return render(
        <WhisperCollapsedGroup
            precedingChunks={[]}
            summary={summary}
            toolById={new Map()}
            toolsWithChildren={new Set()}
            toolParentById={new Map()}
            isStreaming={false}
            groupSingleLineMessages={false}
            workspaceId="test-ws"
            renderToolTree={() => null}
        />
    );
}

function getHeaderText(container: HTMLElement): string {
    const btn = container.querySelector('button');
    return btn?.textContent?.trim() ?? '';
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WhisperCollapsedGroup — header text', () => {
    it('shows commit count when commitCount > 1 (plural)', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            commitCount: 3,
            startTime: 1000,
            endTime: 3500,
        });
        const text = getHeaderText(container);
        expect(text).toContain('3 commits');
        expect(text).toContain('5 tool calls');
        expect(text).toContain('1 message');
    });

    it('shows singular "commit" when commitCount === 1', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 0,
            commitCount: 1,
            startTime: 1000,
            endTime: 2000,
        });
        const text = getHeaderText(container);
        expect(text).toContain('1 commit');
        expect(text).not.toContain('1 commits');
    });

    it('omits commit segment when commitCount is 0', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
            commitCount: 0,
        });
        const text = getHeaderText(container);
        expect(text).not.toContain('commit');
    });

    it('omits commit segment when commitCount is undefined', () => {
        const { container } = renderHeader({
            toolCallCount: 3,
            messageCount: 1,
        });
        const text = getHeaderText(container);
        expect(text).not.toContain('commit');
    });

    it('dot-separates all parts: tool calls · messages · commits', () => {
        const { container } = renderHeader({
            toolCallCount: 4,
            messageCount: 2,
            commitCount: 2,
        });
        const text = getHeaderText(container);
        // Should have "4 tool calls · 2 messages · 2 commits"
        expect(text).toMatch(/4 tool calls\s*·\s*2 messages\s*·\s*2 commits/);
    });

    it('shows duration when start and end times are set', () => {
        const { container } = renderHeader({
            toolCallCount: 1,
            messageCount: 0,
            commitCount: 1,
            startTime: 1000,
            endTime: 3500,
        });
        const text = getHeaderText(container);
        expect(text).toContain('(2.5s)');
    });
});
