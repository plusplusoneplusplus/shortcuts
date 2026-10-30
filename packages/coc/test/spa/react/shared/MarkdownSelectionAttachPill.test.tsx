// @vitest-environment jsdom
/**
 * Rendered Markdown "Attach as context" pill: raw-file line mapping, pill
 * visibility, attachment through the shared file-selection flow, stale
 * selections and owner routing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { renderMarkdownToHtml, strippedFrontmatterLineCount } from '../../../../src/server/spa/client/diff/markdown-renderer';
import { markdownPreviewSelectionLines } from '../../../../src/server/spa/client/react/shared/markdown-document/markdownSelectionContext';
import { MarkdownSelectionAttachPill } from '../../../../src/server/spa/client/react/shared/markdown-document/MarkdownSelectionAttachPill';
import { resetActiveChatAttach, subscribeActiveChatAttach } from '../../../../src/server/spa/client/react/features/chat/activeChatAttach';
import { drainNewChatSeedContext } from '../../../../src/server/spa/client/react/features/chat/newChatSeedContext';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

const SKILL = [
    '---',
    'name: delegate',
    '---',
    '',
    '# Delegate',
    '',
    'Users reach this skill through plain language.',
    'Second line of the paragraph.',
    '',
    '| Input | Outcome |',
    '|---|---|',
    '| a | b |',
    '',
    'After the table.',
].join('\n');

function Preview({ content = SKILL, workspaceId = 'ws-1', filePath = 'skills/delegate/SKILL.md', destinationId }: {
    content?: string; workspaceId?: string; filePath?: string; destinationId?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    return (
        <div className="relative">
            <div ref={ref} data-testid="preview-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(content, { stripFrontmatter: true }) }} />
            <MarkdownSelectionAttachPill containerRef={ref} content={content} workspaceId={workspaceId} filePath={filePath} destinationId={destinationId} />
        </div>
    );
}

function line(n: number): HTMLElement {
    return screen.getByTestId('preview-markdown').querySelector(`.md-line[data-line="${n}"]`)!;
}

function text(element: Element): Text {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    return walker.nextNode() as Text;
}

function rangeOf(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
}

function select(range: Range | null) {
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    if (range) selection.addRange(range);
    act(() => { document.dispatchEvent(new Event('selectionchange')); });
}

const pill = () => screen.queryByRole('button', { name: 'Attach as context' });

beforeEach(() => {
    _resetRuntimeConfig();
    applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
});
afterEach(() => {
    document.getSelection()?.removeAllRanges();
    cleanup();
    resetActiveChatAttach();
    drainNewChatSeedContext();
    _resetRuntimeConfig();
});

describe('markdownPreviewSelectionLines', () => {
    it('counts stripped frontmatter lines', () => {
        expect(strippedFrontmatterLineCount(SKILL)).toBe(4);
        expect(strippedFrontmatterLineCount('# No frontmatter')).toBe(0);
    });

    it('maps paragraph, multi-line, table and outside selections to raw-file lines', () => {
        render(<Preview />);
        const root = screen.getByTestId('preview-markdown');
        // Rendered line 3 is raw line 7 (four frontmatter lines stripped).
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(line(3)), 0, text(line(3)), 5))).toEqual({ start: 7, end: 7 });
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(line(3)), 6, text(line(4)), 6))).toEqual({ start: 7, end: 8 });
        // A triple-click selection ends at the start of the next line.
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(line(3)), 0, line(5), 0))).toEqual({ start: 7, end: 8 });
        // A table is one block; it resolves to its own source lines.
        const cell = root.querySelector('td')!;
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(cell), 0, text(cell), 1))).toEqual({ start: 10, end: 12 });
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(line(3)), 0, text(cell), 1))).toEqual({ start: 7, end: 12 });
        const outside = document.createElement('p');
        outside.textContent = 'outside';
        document.body.appendChild(outside);
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(outside), 0, text(outside), 3))).toBeNull();
        expect(markdownPreviewSelectionLines(SKILL, root, rangeOf(text(line(3)), 2, text(line(3)), 2))).toBeNull();
        outside.remove();
    });
});

describe('MarkdownSelectionAttachPill', () => {
    it('shows for a preview selection and hides when it collapses or leaves the preview', () => {
        render(<Preview />);
        expect(pill()).toBeNull();
        select(rangeOf(text(line(3)), 0, text(line(3)), 5));
        expect(pill()).not.toBeNull();
        expect(screen.getByRole('group', { name: 'Selection actions' })).toBeTruthy();
        select(rangeOf(text(line(3)), 2, text(line(3)), 2));
        expect(pill()).toBeNull();
        const outside = document.createElement('p');
        outside.textContent = 'outside';
        document.body.appendChild(outside);
        select(rangeOf(text(outside), 0, text(outside), 3));
        expect(pill()).toBeNull();
        outside.remove();
    });

    it('attaches the selected excerpt with its raw line range to the owner, without the whole file', () => {
        const handler = vi.fn(() => true);
        const sub = subscribeActiveChatAttach('ws-1', handler);
        render(<Preview />);
        select(rangeOf(text(line(3)), 0, text(line(4)), 6));
        // Pressing the pill keeps the selection it acts on.
        expect(fireEvent.mouseDown(pill()!)).toBe(false);
        fireEvent.click(pill()!);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith({
            kind: 'coc.file-selection-context', version: 1, sourceWorkspaceId: 'ws-1',
            filePath: 'skills/delegate/SKILL.md', range: { start: 7, end: 8 },
            snippet: 'Users reach this skill through plain language.\nSecond',
            label: expect.stringContaining('skills/delegate/SKILL.md'),
        });
        expect(document.getSelection()!.toString()).toBe('Users reach this skill through plain language.\nSecond');
        expect(pill()).toBeNull();
        sub.unsubscribe();
    });

    it('stays dismissed for the attached selection and returns for a new one', () => {
        const handler = vi.fn(() => true);
        subscribeActiveChatAttach('ws-1', handler);
        render(<Preview />);
        select(rangeOf(text(line(3)), 0, text(line(3)), 5));
        fireEvent.click(pill()!);
        select(rangeOf(text(line(3)), 0, text(line(3)), 5));
        expect(pill()).toBeNull();
        select(rangeOf(text(line(3)), 0, text(line(3)), 9));
        expect(pill()).not.toBeNull();
    });

    it('drops a stale selection when the previewed content changes', () => {
        const { rerender } = render(<Preview />);
        select(rangeOf(text(line(3)), 0, text(line(3)), 5));
        expect(pill()).not.toBeNull();
        rerender(<Preview content={SKILL.replace('Users reach', 'People reach')} />);
        expect(pill()).toBeNull();
    });

    it('routes to the concrete remote owner while the payload keeps the plain workspace id', () => {
        const local = vi.fn(() => true);
        const remote = vi.fn(() => true);
        subscribeActiveChatAttach('ws-1', local);
        subscribeActiveChatAttach('remote:server-b:ws-1', remote);
        render(<Preview destinationId="remote:server-b:ws-1" />);
        select(rangeOf(text(line(3)), 0, text(line(3)), 5));
        fireEvent.click(pill()!);
        expect(local).not.toHaveBeenCalled();
        expect(remote).toHaveBeenCalledWith(expect.objectContaining({ sourceWorkspaceId: 'ws-1', range: { start: 7, end: 7 }, snippet: 'Users' }));
    });

    it('stays hidden while session-context attachments are off', () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: false });
        render(<Preview />);
        select(rangeOf(text(line(3)), 0, text(line(3)), 5));
        expect(pill()).toBeNull();
    });
});
