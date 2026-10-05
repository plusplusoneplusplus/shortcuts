// @vitest-environment jsdom
/**
 * File-editor selection context (AC-03): the payload builder only accepts
 * repo-relative paths and real selections, payloads and chip items cap snippets,
 * formatAttachedContext emits a `<context from="file-selection">` block that
 * parses back into a chip, and duplicate selections are rejected.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
    createDiffSelectionContextItem,
    createFileSelectionContextItem,
    DIFF_SELECTION_TEXT_SIZE_LIMIT,
    formatAttachedContext,
    parseAttachedSessionContextBlocks,
    type AttachedContextItem,
} from '../../../src/server/spa/client/react/features/chat/hooks/useAttachedContext';
import {
    buildFileSelectionLabel,
    createDiffSelectionContextDragPayload,
    createFileSelectionContextPayload,
    FILE_SELECTION_CONTEXT_KIND,
    type FileSelectionContextPayload,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import {
    validateSessionContextAttachmentsForSend,
    validateSessionContextDrop,
} from '../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { AttachedContextPreviews } from '../../../src/server/spa/client/react/ui/AttachedContextPreviews';
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

function makePayload(overrides: Partial<Parameters<typeof createFileSelectionContextPayload>[0]> = {}): FileSelectionContextPayload {
    const payload = createFileSelectionContextPayload({
        sourceWorkspaceId: 'ws-1',
        filePath: 'src/status.rs',
        range: { start: 24, end: 35 },
        snippet: 'fn status() {\n    todo()\n}',
        ...overrides,
    });
    if (!payload) throw new Error('fixture payload is invalid');
    return payload;
}

function makeTurn(content: string): ClientConversationTurn {
    return { role: 'user', content, timestamp: '2026-10-04T10:30:00Z', streaming: false, timeline: [] };
}

describe('createFileSelectionContextPayload', () => {
    it.each([3999, 4000, 4001])('caps %i characters before routing and preserves truncation through validation', size => {
        const payload = makePayload({ snippet: 'x'.repeat(size) });
        expect(payload.snippet).toHaveLength(Math.min(size, DIFF_SELECTION_TEXT_SIZE_LIMIT));
        expect(payload.truncated === true).toBe(size > DIFF_SELECTION_TEXT_SIZE_LIMIT);
        const normalized = createFileSelectionContextPayload(payload);
        expect(normalized).toEqual(payload);
        const item = createFileSelectionContextItem(normalized!, 'ctx-capped');
        expect(item.truncated).toBe(size > DIFF_SELECTION_TEXT_SIZE_LIMIT);
        const parsed = parseAttachedSessionContextBlocks(formatAttachedContext([item]));
        expect(parsed.fileSelectionContexts[0].snippet).toBe(payload.snippet);
        expect(parsed.fileSelectionContexts[0].truncated).toBe(item.truncated);
    });

    it('rejects malformed truncation metadata', () => {
        expect(createFileSelectionContextPayload({ ...makePayload(), truncated: 'true' })).toBeNull();
    });

    it('builds a payload with a path:start-end label', () => {
        expect(makePayload()).toEqual({
            kind: FILE_SELECTION_CONTEXT_KIND,
            version: 1,
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/status.rs',
            range: { start: 24, end: 35 },
            snippet: 'fn status() {\n    todo()\n}',
            label: 'src/status.rs:24-35',
        });
    });

    it('uses a single line number for a one-line selection', () => {
        expect(buildFileSelectionLabel('a.ts', { start: 7, end: 7 })).toBe('a.ts:7');
        expect(makePayload({ range: { start: 7, end: 7 } }).label).toBe('src/status.rs:7');
    });

    it('strips a leading ./ from the path', () => {
        expect(makePayload({ filePath: './src/a.ts' }).filePath).toBe('src/a.ts');
    });

    it.each([
        ['/home/me/repo/src/a.ts'],
        ['~/repo/a.ts'],
        ['C:\\repo\\a.ts'],
        ['C:/repo/a.ts'],
        ['src\\a.ts'],
        [''],
        ['   '],
    ])('rejects non repo-relative path %j', (filePath) => {
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-1', filePath, range: { start: 1, end: 1 }, snippet: 'x' })).toBeNull();
    });

    it('rejects an empty or whitespace-only snippet', () => {
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-1', filePath: 'a.ts', range: { start: 1, end: 1 }, snippet: '' })).toBeNull();
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-1', filePath: 'a.ts', range: { start: 1, end: 2 }, snippet: '  \n ' })).toBeNull();
    });

    it('rejects a missing workspace and invalid ranges', () => {
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: '', filePath: 'a.ts', range: { start: 1, end: 1 }, snippet: 'x' })).toBeNull();
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-1', filePath: 'a.ts', range: { start: 0, end: 1 }, snippet: 'x' })).toBeNull();
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-1', filePath: 'a.ts', range: { start: 5, end: 4 }, snippet: 'x' })).toBeNull();
        expect(createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-1', filePath: 'a.ts', snippet: 'x' })).toBeNull();
    });
});

describe('createFileSelectionContextItem', () => {
    it('keeps a short snippet as-is', () => {
        const item = createFileSelectionContextItem(makePayload(), 'ctx-1');
        expect(item).toMatchObject({
            kind: 'file-selection',
            id: 'ctx-1',
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/status.rs',
            range: { start: 24, end: 35 },
            truncated: false,
            label: 'src/status.rs:24-35',
        });
        expect(item.snippet).toBe('fn status() {\n    todo()\n}');
    });

    it('caps the snippet at the size limit and flags it', () => {
        const item = createFileSelectionContextItem(makePayload({ snippet: 'z'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT + 10) }), 'ctx-1');
        expect(item.truncated).toBe(true);
        expect(item.snippet).toHaveLength(DIFF_SELECTION_TEXT_SIZE_LIMIT);
    });

    it('does not flag a snippet exactly at the limit', () => {
        const item = createFileSelectionContextItem(makePayload({ snippet: 'z'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT) }), 'ctx-1');
        expect(item.truncated).toBe(false);
    });
});

describe('file-selection context format + parse round-trip', () => {
    it('formats path, line range, and a fenced snippet', () => {
        const text = formatAttachedContext([createFileSelectionContextItem(makePayload({ filePath: 'src/a "b".ts' }), 'ctx-1')]);
        expect(text).toBe('<context from="file-selection" workspace_id="ws-1" path="src/a &quot;b&quot;.ts" lines="24-35">\n```\nfn status() {\n    todo()\n}\n```\n</context>\n\n');
    });

    it('parses the block back into the same fields and strips it from the message', () => {
        const item = createFileSelectionContextItem(makePayload(), 'ctx-1');
        const parsed = parseAttachedSessionContextBlocks(`${formatAttachedContext([item])}What does this do?`);

        expect(parsed.remainingContent).toBe('What does this do?');
        expect(parsed.fileSelectionContexts).toHaveLength(1);
        expect(parsed.attachedContexts).toEqual(parsed.fileSelectionContexts);
        expect(parsed.diffSelectionContexts).toHaveLength(0);
        expect(parsed.fileSelectionContexts[0]).toMatchObject({
            kind: 'file-selection',
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/status.rs',
            range: { start: 24, end: 35 },
            snippet: item.snippet,
            truncated: false,
            label: 'src/status.rs:24-35',
        });
    });

    it('keeps snippets that contain backtick fences and </context> intact', () => {
        const snippet = 'const s = `x`;\n```md\n</context>\n````\nend';
        const item = createFileSelectionContextItem(makePayload({ snippet }), 'ctx-1');
        const text = formatAttachedContext([item]);
        expect(text).toContain('`````\n');
        const parsed = parseAttachedSessionContextBlocks(`${text}after`);

        expect(parsed.fileSelectionContexts).toHaveLength(1);
        expect(parsed.fileSelectionContexts[0].snippet).toBe(snippet);
        expect(parsed.remainingContent).toBe('after');
    });

    it('carries the truncated flag through the block', () => {
        const item = createFileSelectionContextItem(makePayload({ snippet: 'x'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT + 1) }), 'ctx-1');
        const text = formatAttachedContext([item]);
        expect(text).toContain('truncated="true"');
        const [block] = parseAttachedSessionContextBlocks(text).fileSelectionContexts;
        expect(block.truncated).toBe(true);
        expect(block.snippet).toHaveLength(DIFF_SELECTION_TEXT_SIZE_LIMIT);
    });

    it('parses file and diff selections side by side in order', () => {
        const diffPayload = createDiffSelectionContextDragPayload({
            sourceWorkspaceId: 'ws-1',
            filePath: 'src/a.ts',
            newRange: { start: 1, end: 2 },
            ref: { type: 'working-tree' },
            snippet: '+a\n+b',
        });
        if (!diffPayload) throw new Error('bad diff fixture');
        const items: AttachedContextItem[] = [
            createFileSelectionContextItem(makePayload(), 'ctx-a'),
            createDiffSelectionContextItem(diffPayload, 'ctx-b'),
            createFileSelectionContextItem(makePayload({ range: { start: 1, end: 3 } }), 'ctx-c'),
        ];
        const parsed = parseAttachedSessionContextBlocks(`${formatAttachedContext(items)}Q`);
        expect(parsed.attachedContexts.map(context => context.kind)).toEqual(['file-selection', 'diff-selection', 'file-selection']);
        expect(parsed.fileSelectionContexts.map(context => context.label)).toEqual(['src/status.rs:24-35', 'src/status.rs:1-3']);
        expect(parsed.remainingContent).toBe('Q');
    });

    it('leaves a malformed file-selection block as raw text', () => {
        const raw = '<context from="file-selection" path="a.ts" lines="bogus">\n```\nx\n```\n</context>\n\nhi';
        const parsed = parseAttachedSessionContextBlocks(raw);
        expect(parsed.fileSelectionContexts).toHaveLength(0);
        expect(parsed.remainingContent).toBe(raw);
    });
});

describe('file-selection duplicate + workspace validation', () => {
    const base = { featureEnabled: true, activeWorkspaceId: 'ws-1', currentProcessId: null, canRetrieveConversations: true };

    it('preserves snippet-based validation for an explicitly targeted group composer', () => {
        const payload = makePayload();
        expect(validateSessionContextDrop({
            ...base, activeWorkspaceId: 'group-demo', payload, existingItems: [],
        })).toEqual({ ok: true, payload });
    });

    it('accepts a first selection and rejects the exact same file+range again', () => {
        expect(validateSessionContextDrop({ ...base, payload: makePayload(), existingItems: [] })).toEqual({ ok: true, payload: makePayload() });
        const existing = [createFileSelectionContextItem(makePayload(), 'ctx-1')];
        expect(validateSessionContextDrop({ ...base, payload: makePayload({ snippet: 'edited text' }), existingItems: existing }))
            .toEqual({ ok: false, error: 'This file selection is already attached to the message.' });
    });

    it('stacks different ranges or files as separate chips', () => {
        const existing = [createFileSelectionContextItem(makePayload(), 'ctx-1')];
        expect(validateSessionContextDrop({ ...base, payload: makePayload({ range: { start: 24, end: 36 } }), existingItems: existing }).ok).toBe(true);
        expect(validateSessionContextDrop({ ...base, payload: makePayload({ filePath: 'src/other.rs' }), existingItems: existing }).ok).toBe(true);
        expect(validateSessionContextDrop({ ...base, payload: makePayload({ sourceWorkspaceId: 'ws-2' }), existingItems: existing }).ok).toBe(true);
    });

    it('is rejected when the feature flag is off', () => {
        expect(validateSessionContextDrop({ ...base, featureEnabled: false, payload: makePayload(), existingItems: [] }).ok).toBe(false);
    });

    it('flags duplicate file selections on send', () => {
        const items = [createFileSelectionContextItem(makePayload(), 'ctx-1'), createFileSelectionContextItem(makePayload(), 'ctx-2')];
        expect(validateSessionContextAttachmentsForSend({ ...base, items })).toBe('This file selection is already attached to the message.');
        expect(validateSessionContextAttachmentsForSend({ ...base, items: items.slice(0, 1) })).toBeNull();
    });
});

describe('file-selection chips', () => {
    it('renders the composer chip with label and preview', () => {
        const onRemove = vi.fn();
        const item = createFileSelectionContextItem(makePayload(), 'ctx-1');
        render(<AttachedContextPreviews items={[item]} onRemove={onRemove} />);
        const chip = screen.getByTestId('attached-file-selection-context-chip');
        expect(chip.textContent).toContain('File');
        expect(chip.textContent).toContain('src/status.rs:24-35');
        expect(screen.queryByTestId('attached-file-selection-truncated')).toBeNull();
        fireEvent.click(screen.getByTestId('attached-context-remove'));
        expect(onRemove).toHaveBeenCalledWith('ctx-1');
    });

    it('shows the truncated badge on the composer chip', () => {
        const item = createFileSelectionContextItem(makePayload({ snippet: 'q'.repeat(DIFF_SELECTION_TEXT_SIZE_LIMIT + 1) }), 'ctx-1');
        render(<AttachedContextPreviews items={[item]} onRemove={() => {}} />);
        expect(screen.getByTestId('attached-file-selection-truncated')).toBeTruthy();
    });

    it('renders a card in the sent user turn instead of raw XML', () => {
        const item = createFileSelectionContextItem(makePayload(), 'ctx-1');
        render(<ConversationTurnBubble turn={makeTurn(`${formatAttachedContext([item])}Explain this.`)} />);

        expect(screen.getByTestId('attached-file-selection-context-summary').textContent).toBe('src/status.rs:24-35');
        fireEvent.click(screen.getByText('Attached file selection'));
        const card = screen.getByTestId('attached-file-selection-context-block');
        expect(card.textContent).toContain('24-35');
        expect(card.textContent).toContain('ws-1');
        expect(screen.getByTestId('attached-file-selection-context-snippet').textContent).toBe(item.snippet);

        const plain = screen.getByTestId('user-plain-text').textContent ?? '';
        expect(plain).toContain('Explain this.');
        expect(plain).not.toContain('file-selection');
    });
});
