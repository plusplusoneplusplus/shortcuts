/**
 * Tests that WhisperCollapsedGroup wires the ToolCallVariantProvider
 * around its expanded body, so that nested ToolCallView / ToolCallGroupView
 * adopt the "whisper-row" variant. Also asserts the expanded body uses the
 * white surface background per the reference design.
 */

import { describe, it, expect } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import { ToolCallView } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallView';
import type { WhisperSummary } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

function makeSummary(): WhisperSummary {
    return {
        toolCallCount: 2,
        messageCount: 0,
        startTime: undefined,
        endTime: undefined,
    };
}

const toolById = new Map<string, any>([
    [
        'a',
        {
            toolName: 'view',
            args: { path: '/repo/foo.ts' },
            result: 'l1\nl2\nl3',
            status: 'completed',
        },
    ],
    [
        'b',
        {
            toolName: 'grep',
            args: { pattern: 'x' },
            result: 'a.ts:1:x\nb.ts:2:x',
            status: 'completed',
        },
    ],
]);

const precedingChunks = [
    { kind: 'tool', key: 'k-a', toolId: 'a' },
    { kind: 'tool', key: 'k-b', toolId: 'b' },
];

function renderToolTree(toolId: string): React.ReactNode {
    const tool = toolById.get(toolId);
    if (!tool) return null;
    return <ToolCallView toolCall={{ id: toolId, ...tool }} />;
}

describe('WhisperCollapsedGroup — variant wiring', () => {
    it('does not render any tool-call-row elements while collapsed', () => {
        const { container } = render(
            <WhisperCollapsedGroup
                precedingChunks={precedingChunks as any}
                summary={makeSummary()}
                toolById={toolById}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                renderToolTree={renderToolTree}
            />
        );
        expect(container.querySelector('.tool-call-row-header')).toBeNull();
    });

    it('propagates whisper-row variant to nested ToolCallGroupView once expanded', () => {
        const { container, getByTestId } = render(
            <WhisperCollapsedGroup
                precedingChunks={precedingChunks as any}
                summary={makeSummary()}
                toolById={toolById}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                renderToolTree={renderToolTree}
            />
        );
        const toggle = getByTestId('whisper-toggle');
        act(() => {
            fireEvent.click(toggle);
        });
        const expanded = getByTestId('whisper-expanded-content');
        // The view+grep pair is categorized 'read' and gets grouped into one
        // ToolCallGroupView. The group card must adopt the whisper variant.
        const groupCard = expanded.querySelector('[data-tool-variant="whisper-row"]');
        expect(groupCard).toBeTruthy();
        expect(groupCard?.classList.contains('tool-call-group--whisper')).toBe(true);
        // No legacy tool-call-card remains inside the expanded body.
        expect(expanded.querySelector('.tool-call-card')).toBeNull();
    });

    it('renders nested ToolCallViews as compact rows when the inner group is expanded', () => {
        const { container, getByTestId } = render(
            <WhisperCollapsedGroup
                precedingChunks={precedingChunks as any}
                summary={makeSummary()}
                toolById={toolById}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                renderToolTree={renderToolTree}
            />
        );
        // 1) Expand the whisper.
        act(() => { fireEvent.click(getByTestId('whisper-toggle')); });
        // 2) Expand the inner ToolCallGroupView.
        const innerToggle = getByTestId('whisper-group-toggle');
        act(() => { fireEvent.click(innerToggle.parentElement!); });
        // 3) The nested ToolCallViews should now render as whisper rows
        //    (kind pill present, no .tool-call-card legacy wrapper).
        const kinds = container.querySelectorAll('[data-testid="tool-call-kind"]');
        expect(kinds.length).toBeGreaterThanOrEqual(2);
        expect(container.querySelector('.tool-call-card')).toBeNull();
    });

    it('paints the expanded body with white surface', () => {
        const { getByTestId } = render(
            <WhisperCollapsedGroup
                precedingChunks={precedingChunks as any}
                summary={makeSummary()}
                toolById={toolById}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                renderToolTree={renderToolTree}
            />
        );
        act(() => {
            fireEvent.click(getByTestId('whisper-toggle'));
        });
        const expanded = getByTestId('whisper-expanded-content');
        expect(expanded.className).toContain('bg-white');
    });

    it('keeps the collapsed header (with hover counts) untouched in card variant', () => {
        const { container } = render(
            <WhisperCollapsedGroup
                precedingChunks={precedingChunks as any}
                summary={{
                    ...makeSummary(),
                    skillCount: 2,
                    skillNames: ['skill-a', 'skill-b'],
                }}
                toolById={toolById}
                toolsWithChildren={new Set()}
                toolParentById={new Map()}
                isStreaming={false}
                groupSingleLineMessages={false}
                renderToolTree={renderToolTree}
            />
        );
        // The "2 skills" hover span lives in the header — must remain present
        // and untouched (no whisper-row data attribute).
        const skillSpan = container.querySelector('[data-testid="whisper-skill-hover"]');
        expect(skillSpan).toBeTruthy();
        expect(skillSpan?.getAttribute('data-tool-variant')).toBeNull();
    });
});
