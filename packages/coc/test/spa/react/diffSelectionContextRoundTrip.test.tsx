// @vitest-environment jsdom
/**
 * Sending a Git diff selection chip (AC-03): formatAttachedContext emits a
 * `<context from="diff-selection">` block with a fenced diff, the block parses
 * back into the same fields, and the sent user turn shows a chip instead of XML.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
    createDiffSelectionContextItem,
    DIFF_SELECTION_TEXT_SIZE_LIMIT,
    formatAttachedContext,
    parseAttachedSessionContextBlocks,
    type AttachedContextItem,
} from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import {
    createDiffSelectionContextDragPayload,
    type DiffSelectionContextDragPayload,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { ConversationTurnBubble } from '../../../src/server/spa/client/react/features/chat/conversation/ConversationTurnBubble';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => <div data-testid="markdown-view" className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />,
}));

vi.mock('../../../src/server/spa/client/diff/markdown-renderer', () => ({
    renderMarkdownToHtml: (s: string) => `<p>${s}</p>`,
}));

function makePayload(overrides: Partial<Parameters<typeof createDiffSelectionContextDragPayload>[0]> = {}): DiffSelectionContextDragPayload {
    const payload = createDiffSelectionContextDragPayload({
        sourceWorkspaceId: 'ws-other',
        filePath: 'src/a "b".ts',
        oldRange: { start: 10, end: 11 },
        newRange: { start: 10, end: 12 },
        ref: { type: 'commit', commitHash: '585e64d1234567890abcdef' },
        snippet: ' context\n-old line\n+new line\n+another',
        ...overrides,
    });
    if (!payload) throw new Error('fixture payload is invalid');
    return payload;
}

function makeTurn(content: string): ClientConversationTurn {
    return { role: 'user', content, timestamp: '2026-09-27T10:30:00Z', streaming: false, timeline: [] };
}

describe('diff-selection context format + parse round-trip', () => {
    it('formats path, line ranges, ref, and a fenced diff snippet', () => {
        const item = createDiffSelectionContextItem(makePayload(), 'ctx-1');
        const text = formatAttachedContext([item]);

        expect(text).toContain('<context from="diff-selection" workspace_id="ws-other" path="src/a &quot;b&quot;.ts" old_lines="10-11" new_lines="10-12" ref_type="commit" commit_hash="585e64d1234567890abcdef" ref="585e64d">');
        expect(text).toContain('```diff\n context\n-old line\n+new line\n+another\n```\n</context>');
        expect(text).not.toContain('truncated=');
    });

    it('parses the block back into the same fields and strips it from the message', () => {
        const item = createDiffSelectionContextItem(makePayload(), 'ctx-1');
        const parsed = parseAttachedSessionContextBlocks(`${formatAttachedContext([item])}Explain this change.`);

        expect(parsed.remainingContent).toBe('Explain this change.');
        expect(parsed.diffSelectionContexts).toHaveLength(1);
        expect(parsed.attachedContexts).toEqual(parsed.diffSelectionContexts);
        const [block] = parsed.diffSelectionContexts;
        expect(block).toMatchObject({
            kind: 'diff-selection',
            sourceWorkspaceId: 'ws-other',
            filePath: 'src/a "b".ts',
            oldRange: { start: 10, end: 11 },
            newRange: { start: 10, end: 12 },
            ref: { type: 'commit', commitHash: '585e64d1234567890abcdef' },
            snippet: item.snippet,
            truncated: false,
            label: item.label,
        });
    });

    it.each([
        [{ type: 'range', baseRef: 'origin/main', headRef: 'feature' } as const],
        [{ type: 'working-tree' } as const],
        [{ type: 'staged' } as const],
    ])('round-trips a %o ref', (ref) => {
        const item = createDiffSelectionContextItem(makePayload({ ref }), 'ctx-1');
        const [block] = parseAttachedSessionContextBlocks(formatAttachedContext([item])).diffSelectionContexts;
        expect(block.ref).toEqual(ref);
        expect(block.label).toBe(item.label);
    });

    it('round-trips a one-sided (old-only) selection', () => {
        const item = createDiffSelectionContextItem(makePayload({ newRange: undefined, snippet: '-gone\n-also gone' }), 'ctx-1');
        const [block] = parseAttachedSessionContextBlocks(formatAttachedContext([item])).diffSelectionContexts;
        expect(block.oldRange).toEqual({ start: 10, end: 11 });
        expect(block.newRange).toBeUndefined();
        expect(block.label).toBe('src/a "b".ts:L10-L11 @ 585e64d');
    });

    it('keeps snippets that contain backtick fences and </context> intact', () => {
        const snippet = '+const s = `x`;\n+```md\n+</context>\n+````\n context';
        const item = createDiffSelectionContextItem(makePayload({ snippet }), 'ctx-1');
        const parsed = parseAttachedSessionContextBlocks(`${formatAttachedContext([item])}after`);

        expect(parsed.diffSelectionContexts).toHaveLength(1);
        expect(parsed.diffSelectionContexts[0].snippet).toBe(snippet);
        expect(parsed.remainingContent).toBe('after');
    });

    it('carries the truncated flag through the block', () => {
        const item = createDiffSelectionContextItem(makePayload({ snippet: `+${'x'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT + 50)}` }), 'ctx-1');
        const text = formatAttachedContext([item]);
        expect(text).toContain('truncated="true"');
        const [block] = parseAttachedSessionContextBlocks(text).diffSelectionContexts;
        expect(block.truncated).toBe(true);
        expect(block.snippet).toHaveLength(DIFF_SELECTION_TEXT_SIZE_LIMIT);
    });

    it('parses diff blocks alongside other attached context kinds in order', () => {
        const items: AttachedContextItem[] = [
            {
                kind: 'commit',
                id: 'ctx-a',
                sourceWorkspaceId: 'ws-1',
                commitHash: 'abcdef1234567890',
                shortHash: 'abcdef1',
                label: 'abcdef1',
                subject: 'Fix it',
                preview: 'abcdef1',
            },
            createDiffSelectionContextItem(makePayload(), 'ctx-b'),
        ];
        const parsed = parseAttachedSessionContextBlocks(`${formatAttachedContext(items)}Question`);
        expect(parsed.attachedContexts.map(context => context.kind)).toEqual(['commit', 'diff-selection']);
        expect(parsed.remainingContent).toBe('Question');
    });

    it('leaves a malformed diff-selection block as raw text', () => {
        const raw = '<context from="diff-selection" path="a.ts" ref_type="bogus">\n```diff\n+x\n```\n</context>\n\nhi';
        const parsed = parseAttachedSessionContextBlocks(raw);
        expect(parsed.diffSelectionContexts).toHaveLength(0);
        expect(parsed.remainingContent).toBe(raw);
    });

    it('does not treat turn-snippet <context> blocks as diff selections', () => {
        const raw = '<context from="assistant" turn="2">\nsome text\n</context>\n\nhi';
        const parsed = parseAttachedSessionContextBlocks(raw);
        expect(parsed.attachedContexts).toHaveLength(0);
        expect(parsed.remainingContent).toBe(raw);
    });
});

describe('diff-selection context in the sent user turn', () => {
    it('renders a chip with label, location, and snippet instead of raw XML', () => {
        const item = createDiffSelectionContextItem(makePayload(), 'ctx-1');
        render(<ConversationTurnBubble turn={makeTurn(`${formatAttachedContext([item])}Explain this change.`)} />);

        const card = screen.getByTestId('attached-diff-selection-context-block') as HTMLDetailsElement;
        expect(card.open).toBe(false);
        expect(screen.getByTestId('attached-diff-selection-context-summary').textContent).toBe('src/a "b".ts:L10-L12 @ 585e64d');
        expect(screen.queryByTestId('attached-diff-selection-context-truncated')).toBeNull();

        fireEvent.click(screen.getByText('Attached diff selection'));
        expect(card.textContent).toContain('10-11');
        expect(card.textContent).toContain('585e64d1234567890abcdef');
        expect(card.textContent).toContain('ws-other');
        expect(screen.getByTestId('attached-diff-selection-context-snippet').textContent).toBe(item.snippet);

        const plain = screen.getByTestId('user-plain-text').textContent ?? '';
        expect(plain).toContain('Explain this change.');
        expect(plain).not.toContain('diff-selection');
        expect(plain).not.toContain('</context>');
    });

    it('shows the truncated badge for a cut snippet', () => {
        const item = createDiffSelectionContextItem(makePayload({ snippet: `+${'y'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT + 1)}` }), 'ctx-1');
        render(<ConversationTurnBubble turn={makeTurn(`${formatAttachedContext([item])}Why?`)} />);
        expect(screen.getByTestId('attached-diff-selection-context-truncated')).toBeTruthy();
    });
});
