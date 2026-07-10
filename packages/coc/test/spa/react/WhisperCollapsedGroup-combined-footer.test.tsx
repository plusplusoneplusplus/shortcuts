/* @vitest-environment jsdom */
/**
 * AC-02/03 — Open the converged whisper diff panel from the files popover.
 *
 * Both popover triggers dispatch the SAME whole-group context (all files + the
 * group's tool calls + workspaceId): the multi-file summary footer ("N files +X
 * −Y") opens it with no `focusPath` (the "All files" view), while a per-file row
 * opens it focused on that file (`focusPath` set). Single-file groups never
 * render the footer at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperSummary, FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

// ── Mocks (mirror WhisperCollapsedGroup-header.test.tsx) ───────────────────────

vi.mock('../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('../../../src/server/spa/client/react/shared/MarkdownView', () => ({
    MarkdownView: ({ html }: { html: string }) => (
        <div data-testid="markdown-view" dangerouslySetInnerHTML={{ __html: html }} />
    ),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/commitDetection', () => ({
    detectCommitsInToolGroup: () => [],
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/CommitStrip', () => ({
    CommitStrip: () => null,
}));

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/ToolCallGroupView', () => ({
    ToolCallGroupView: () => <div data-testid="tool-call-group-view" />,
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

function fe(path: string, over: Partial<FileEdit> = {}): FileEdit {
    return {
        path,
        insertions: 4,
        deletions: 2,
        netInsertions: 4,
        netDeletions: 2,
        isCreate: false,
        isDeleted: false,
        ...over,
    };
}

function renderGroup(
    fileEdits: FileEdit[],
    opts: {
        onOpenFileDiff?: (ctx: unknown) => void;
        precedingChunks?: unknown[];
        toolById?: Map<string, unknown>;
        commits?: unknown[];
    } = {},
) {
    const { container } = render(
        <WhisperCollapsedGroup
            precedingChunks={(opts.precedingChunks ?? []) as never}
            summary={{
                toolCallCount: 3,
                messageCount: 0,
                fileEditCount: fileEdits.length,
                fileEdits,
                ...(opts.commits ? { commitCount: opts.commits.length, commits: opts.commits } : {}),
            } as WhisperSummary}
            toolById={(opts.toolById ?? new Map()) as never}
            toolsWithChildren={new Set()}
            toolParentById={new Map()}
            isStreaming={false}
            groupSingleLineMessages={false}
            workspaceId="test-ws"
            renderToolTree={() => null}
            onOpenFileDiff={opts.onOpenFileDiff}
        />,
    );
    // Hovering the "N files" header span mounts the files popover (a portal).
    const span = container.querySelector('[data-testid="whisper-file-hover"]') as HTMLElement;
    if (span) fireEvent.mouseEnter(span);
    return container;
}

function getFooter(): HTMLElement | null {
    return document.body.querySelector('[data-testid="file-popover-footer"]');
}

const TWO_FILES = [fe('src/a.ts'), fe('src/b.ts')];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WhisperCollapsedGroup — combined-diff footer (AC-02)', () => {
    it('marks the multi-file footer as a keyboard-accessible button when a handler is wired', () => {
        renderGroup(TWO_FILES, { onOpenFileDiff: vi.fn() });
        const footer = getFooter()!;
        expect(footer).not.toBeNull();
        expect(footer.getAttribute('role')).toBe('button');
        expect(footer.getAttribute('tabindex')).toBe('0');
        expect(footer.getAttribute('aria-label')).toBe('Open combined diff for all files');
    });

    it('leaves the footer non-interactive when no handler is provided', () => {
        renderGroup(TWO_FILES);
        const footer = getFooter()!;
        expect(footer).not.toBeNull();
        expect(footer.getAttribute('role')).toBeNull();
        expect(footer.getAttribute('tabindex')).toBeNull();
    });

    it('never renders the footer for a single-file group (no combined entry point)', () => {
        const onOpenFileDiff = vi.fn();
        renderGroup([fe('src/only.ts')], { onOpenFileDiff });
        expect(getFooter()).toBeNull();
    });

    it('dispatches the whole-group context (all files + tool calls + workspaceId, no focus) on click', () => {
        const onOpenFileDiff = vi.fn();
        const toolById = new Map<string, unknown>([
            ['t1', { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'old', new_str: 'new' } }],
            ['t2', { toolName: 'create', args: { path: 'src/b.ts', file_text: 'hello\nworld' } }],
        ]);
        const precedingChunks = [
            { kind: 'tool', key: 'k1', toolId: 't1' },
            { kind: 'tool', key: 'k2', toolId: 't2' },
        ];
        renderGroup(TWO_FILES, { onOpenFileDiff, toolById, precedingChunks });

        fireEvent.click(getFooter()!);

        expect(onOpenFileDiff).toHaveBeenCalledTimes(1);
        const ctx = onOpenFileDiff.mock.calls[0][0];
        expect(ctx.workspaceId).toBe('test-ws');
        expect(ctx.files.map((f: FileEdit) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(ctx.toolCalls).toEqual([
            { toolName: 'edit', args: { path: 'src/a.ts', old_str: 'old', new_str: 'new' } },
            { toolName: 'create', args: { path: 'src/b.ts', file_text: 'hello\nworld' } },
        ]);
        // The footer opens the "All files" view — no focused file.
        expect(ctx.focusPath).toBeUndefined();
    });

    it('activates the footer on Enter and Space keys', () => {
        const onOpenFileDiff = vi.fn();
        renderGroup(TWO_FILES, { onOpenFileDiff });
        const footer = getFooter()!;
        fireEvent.keyDown(footer, { key: 'Enter' });
        fireEvent.keyDown(footer, { key: ' ' });
        expect(onOpenFileDiff).toHaveBeenCalledTimes(2);
        // Footer entries never carry a focus target (they open on "All files").
        expect(onOpenFileDiff.mock.calls.every((c) => c[0].focusPath === undefined)).toBe(true);
        expect(onOpenFileDiff.mock.calls.every((c) => Array.isArray(c[0].files))).toBe(true);
    });

    it('carries deleted files through in the combined context (the builder lists them as "not shown")', () => {
        const onOpenFileDiff = vi.fn();
        const files = [fe('src/a.ts'), fe('src/gone.ts', { isDeleted: true, isCreate: false, netInsertions: 0, netDeletions: 5 })];
        renderGroup(files, { onOpenFileDiff });
        fireEvent.click(getFooter()!);
        const ctx = onOpenFileDiff.mock.calls[0][0];
        expect(ctx.files.map((f: FileEdit) => f.path)).toEqual(['src/a.ts', 'src/gone.ts']);
        expect(ctx.files.find((f: FileEdit) => f.path === 'src/gone.ts').isDeleted).toBe(true);
    });

    it('per-file rows dispatch the same whole-group context, focused on the clicked file', () => {
        const onOpenFileDiff = vi.fn();
        renderGroup(TWO_FILES, { onOpenFileDiff });
        const row = document.body.querySelector('[data-testid="file-popover-row"]') as HTMLElement;
        fireEvent.click(row);
        expect(onOpenFileDiff).toHaveBeenCalledTimes(1);
        const ctx = onOpenFileDiff.mock.calls[0][0];
        // Same converged payload as the footer, but with the clicked file focused.
        expect(ctx.files.map((f: FileEdit) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
        expect(ctx.focusPath).toBe('src/a.ts');
        expect(ctx.file).toBeUndefined();
    });

    it('activating the footer opens the combined diff without expanding the group', () => {
        const onOpenFileDiff = vi.fn();
        const container = renderGroup(TWO_FILES, { onOpenFileDiff });
        fireEvent.click(getFooter()!);
        const toggle = container.querySelector('[data-testid="whisper-toggle"]') as HTMLElement;
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('[data-testid="whisper-expanded-content"]')).toBeNull();
    });
});
