/**
 * Tests for ConversationTurnBubble — compact tool-group rendering
 * (wired in commit 005).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

// ── Mocks ──────────────────────────────────────────────────────────────────────

// Controllable toolCompactness
let mockToolCompactness: 0 | 1 | 2 | 3 = 0;
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false, toolCompactness: mockToolCompactness }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

// Track ToolCallView renders
vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView', () => ({
    ToolCallView: ({ toolCall, children }: { toolCall: { id: string; toolName: string }; children?: React.ReactNode }) => (
        <div data-testid="tool-call-view" data-tool-id={toolCall.id} data-tool-name={toolCall.toolName}>
            {children}
        </div>
    ),
}));

// Track ToolCallGroupView renders
vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView', () => ({
    ToolCallGroupView: ({
        category,
        toolCalls,
        isStreaming,
        compactness,
    }: {
        category: string;
        toolCalls: Array<{ id: string }>;
        isStreaming: boolean;
        compactness: number;
    }) => (
        <div
            data-testid="tool-call-group-view"
            data-category={category}
            data-tool-count={toolCalls.length}
            data-is-streaming={String(isStreaming)}
            data-compactness={String(compactness)}
        />
    ),
}));

// Track WhisperCollapsedGroup renders
vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup', () => ({
    WhisperCollapsedGroup: ({
        summary,
    }: {
        summary: { toolCallCount: number; messageCount: number; commitCount?: number; prCount?: number };
    }) => (
        <div
            data-testid="whisper-collapsed-group"
            data-tool-count={String(summary.toolCallCount)}
            data-message-count={String(summary.messageCount)}
            data-commit-count={String(summary.commitCount ?? 0)}
            data-pr-count={String(summary.prCount ?? 0)}
        />
    ),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

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

/** Build a timeline with N consecutive leaf read tool calls. */
function makeLeafReadTimeline(ids: string[]) {
    return ids.map(id => ({
        type: 'tool-start' as const,
        toolCall: { id, toolName: 'view', args: { path: `/file-${id}` }, status: 'completed' },
    }));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('ConversationTurnBubble — compact tool grouping', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mockToolCompactness = 0;
    });

    it('does not group when toolCompactness === 0 (flat mode)', () => {
        mockToolCompactness = 0;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ timeline: makeLeafReadTimeline(['t1', 't2', 't3']) })}
            />
        );
        // No group view
        expect(container.querySelector('[data-testid="tool-call-group-view"]')).toBeNull();
    });

    it('renders ToolCallGroupView for 2+ consecutive leaf tool calls when toolCompactness === 1', () => {
        mockToolCompactness = 1;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ timeline: makeLeafReadTimeline(['t1', 't2', 't3']) })}
            />
        );
        const groupView = container.querySelector('[data-testid="tool-call-group-view"]');
        expect(groupView).toBeTruthy();
        expect(groupView?.getAttribute('data-category')).toBe('read');
        expect(groupView?.getAttribute('data-tool-count')).toBe('3');
    });

    it('renders ToolCallGroupView for 2+ consecutive leaf tool calls when toolCompactness === 2', () => {
        mockToolCompactness = 2;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ timeline: makeLeafReadTimeline(['t1', 't2']) })}
            />
        );
        const groupView = container.querySelector('[data-testid="tool-call-group-view"]');
        expect(groupView).toBeTruthy();
    });

    it('passes isStreaming=true when turn.streaming is true', () => {
        mockToolCompactness = 1;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    streaming: true,
                    timeline: makeLeafReadTimeline(['t1', 't2']),
                })}
            />
        );
        const groupView = container.querySelector('[data-testid="tool-call-group-view"]');
        expect(groupView?.getAttribute('data-is-streaming')).toBe('true');
    });

    it('passes isStreaming=false when turn.streaming is false', () => {
        mockToolCompactness = 1;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    streaming: false,
                    timeline: makeLeafReadTimeline(['t1', 't2']),
                })}
            />
        );
        const groupView = container.querySelector('[data-testid="tool-call-group-view"]');
        expect(groupView?.getAttribute('data-is-streaming')).toBe('false');
    });

    it('forwards compactness value to ToolCallGroupView', () => {
        mockToolCompactness = 2;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ timeline: makeLeafReadTimeline(['t1', 't2']) })}
            />
        );
        const groupView = container.querySelector('[data-testid="tool-call-group-view"]');
        expect(groupView?.getAttribute('data-compactness')).toBe('2');
    });

    it('does not group parent (task) tool calls', () => {
        mockToolCompactness = 1;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    timeline: [
                        {
                            type: 'tool-start',
                            toolCall: {
                                id: 'task-1',
                                toolName: 'task',
                                args: { agent_type: 'explore', description: 'explore' },
                                status: 'running',
                            },
                        },
                        {
                            type: 'tool-start',
                            toolCall: {
                                id: 'view-child',
                                toolName: 'view',
                                args: { path: '/file.ts' },
                                status: 'completed',
                                parentToolCallId: 'task-1',
                            },
                        },
                        {
                            type: 'tool-complete',
                            toolCall: { id: 'task-1', toolName: 'task', status: 'completed', args: {} },
                        },
                    ],
                })}
            />
        );
        // task call should render as individual ToolCallView, not absorbed into a group
        expect(container.querySelector('[data-testid="tool-call-group-view"]')).toBeNull();
    });

    it('excludes parent tools from grouping even with groupable toolName (regression: toolsWithChildren)', () => {
        // Bug: ConversationTurnBubble passed toolParentById.keys() (child IDs) instead of
        // toolsWithChildren (parent IDs). This meant parent tools were not excluded from grouping.
        mockToolCompactness = 1;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    timeline: [
                        // Two top-level view calls
                        { type: 'tool-start', toolCall: { id: 'v1', toolName: 'view', args: { path: '/a.ts' }, status: 'completed' } },
                        { type: 'tool-start', toolCall: { id: 'v2', toolName: 'view', args: { path: '/b.ts' }, status: 'completed' } },
                        // A view tool that is also a parent (has children)
                        { type: 'tool-start', toolCall: { id: 'parent-v', toolName: 'view', args: { path: '/dir' }, status: 'completed' } },
                        // Child of parent-v — makes parent-v a "parent tool"
                        { type: 'tool-start', toolCall: { id: 'child-g', toolName: 'glob', args: { pattern: '*.ts' }, status: 'completed', parentToolCallId: 'parent-v' } },
                        // Two more top-level view calls
                        { type: 'tool-start', toolCall: { id: 'v4', toolName: 'view', args: { path: '/c.ts' }, status: 'completed' } },
                        { type: 'tool-start', toolCall: { id: 'v5', toolName: 'view', args: { path: '/d.ts' }, status: 'completed' } },
                    ],
                })}
            />
        );
        // parent-v has children so it must NOT be grouped. v1+v2 form one group, v4+v5 another.
        const groups = container.querySelectorAll('[data-testid="tool-call-group-view"]');
        expect(groups.length).toBe(2);
    });

    it('does not group a single leaf tool call (run of 1 is never collapsed)', () => {
        mockToolCompactness = 1;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({ timeline: makeLeafReadTimeline(['t1']) })}
            />
        );
        expect(container.querySelector('[data-testid="tool-call-group-view"]')).toBeNull();
    });

    it('renders WhisperCollapsedGroup when toolCompactness === 3', () => {
        mockToolCompactness = 3;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Final answer',
                    timeline: [
                        ...makeLeafReadTimeline(['t1', 't2', 't3']),
                        {
                            type: 'tool-start' as const,
                            toolCall: { id: 'tc', toolName: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        const whisper = container.querySelector('[data-testid="whisper-collapsed-group"]');
        expect(whisper).toBeTruthy();
        expect(whisper?.getAttribute('data-tool-count')).toBe('3');
    });

    it('does not render WhisperCollapsedGroup when toolCompactness === 2', () => {
        mockToolCompactness = 2;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Final answer',
                    timeline: [
                        ...makeLeafReadTimeline(['t1', 't2', 't3']),
                        {
                            type: 'tool-start' as const,
                            toolCall: { id: 'tc', toolName: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        expect(container.querySelector('[data-testid="whisper-collapsed-group"]')).toBeNull();
    });

    it('no whisper group when turn is just text + task_complete', () => {
        mockToolCompactness = 3;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Just text',
                    timeline: [
                        {
                            type: 'tool-start' as const,
                            toolCall: { id: 'tc', toolName: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        expect(container.querySelector('[data-testid="whisper-collapsed-group"]')).toBeNull();
    });

    it('whisper summary includes commitCount when shell tools produce git commits', () => {
        mockToolCompactness = 3;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Done',
                    timeline: [
                        ...makeLeafReadTimeline(['t1', 't2']),
                        {
                            type: 'tool-start' as const,
                            toolCall: {
                                id: 'sh1',
                                toolName: 'powershell',
                                args: { command: 'git commit -m "feat: add feature"' },
                                status: 'completed',
                                result: '[main abc1234] feat: add feature\n 1 file changed, 10 insertions(+)',
                            },
                        },
                        {
                            type: 'tool-start' as const,
                            toolCall: { id: 'tc', toolName: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        const whisper = container.querySelector('[data-testid="whisper-collapsed-group"]');
        expect(whisper).toBeTruthy();
        expect(whisper?.getAttribute('data-commit-count')).toBe('1');
    });

    it('whisper summary includes prCount when shell tools create pull requests', () => {
        mockToolCompactness = 3;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Done',
                    timeline: [
                        ...makeLeafReadTimeline(['t1', 't2']),
                        {
                            type: 'tool-start' as const,
                            toolCall: {
                                id: 'sh1',
                                toolName: 'powershell',
                                args: { command: 'gh pr create --title "feat" --body "body"' },
                                status: 'completed',
                                result: 'https://github.com/plusplusoneplusplus/shortcuts/pull/99',
                            },
                        },
                        {
                            type: 'tool-start' as const,
                            toolCall: { id: 'tc', toolName: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        const whisper = container.querySelector('[data-testid="whisper-collapsed-group"]');
        expect(whisper).toBeTruthy();
        expect(whisper?.getAttribute('data-pr-count')).toBe('1');
    });

    it('whisper summary has commitCount 0 when no commits are detected', () => {
        mockToolCompactness = 3;
        const { container } = render(
            <ConversationTurnBubble
                turn={makeTurn({
                    content: 'Final answer',
                    timeline: [
                        ...makeLeafReadTimeline(['t1', 't2', 't3']),
                        {
                            type: 'tool-start' as const,
                            toolCall: { id: 'tc', toolName: 'task_complete', args: { summary: 'Done' }, status: 'completed' },
                        },
                    ],
                })}
            />
        );
        const whisper = container.querySelector('[data-testid="whisper-collapsed-group"]');
        expect(whisper).toBeTruthy();
        expect(whisper?.getAttribute('data-commit-count')).toBe('0');
        expect(whisper?.getAttribute('data-pr-count')).toBe('0');
    });
});
