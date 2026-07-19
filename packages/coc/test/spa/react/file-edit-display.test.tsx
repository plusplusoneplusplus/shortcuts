/**
 * Tests for improved file edit display:
 * - computeNetDiff (net line-level diff)
 * - computeFileEditTotals (aggregate totals)
 * - shortenPath (dir/basename path display)
 * - DiffBar (via FileHoverPopover rendering)
 * - FileHoverPopover footer (aggregate totals row)
 * - Header inline totals (FileHoverSpan shows +X −Y)
 * - Off-screen popover clamping
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import {
    computeNetDiff,
    computeFileEditTotals,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';
import type { FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';
import {
    WhisperCollapsedGroup,
    shortenPath,
} from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperSummary } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: string[]) => args.filter(Boolean).join(' '),
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

vi.mock('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        groupConsecutiveToolChunks: () => [],
    };
});

// ── Helpers ────────────────────────────────────────────────────────────────

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

function renderAndHoverFiles(fileEdits: FileEdit[]) {
    const { container } = renderHeader({
        toolCallCount: 3,
        messageCount: 0,
        fileEditCount: fileEdits.length,
        fileEdits,
    });
    const span = container.querySelector('[data-testid="whisper-file-hover"]') as HTMLElement;
    if (span) {
        fireEvent.mouseEnter(span);
    }
    return document.body;
}

// ── computeNetDiff tests ───────────────────────────────────────────────────

describe('computeNetDiff', () => {
    it('returns 0/0 for identical strings', () => {
        const result = computeNetDiff('line1\nline2\nline3', 'line1\nline2\nline3');
        expect(result.insertions).toBe(0);
        expect(result.deletions).toBe(0);
    });

    it('returns correct counts for completely different strings', () => {
        const result = computeNetDiff('old1\nold2', 'new1\nnew2\nnew3');
        expect(result.deletions).toBe(2);
        expect(result.insertions).toBe(3);
    });

    it('does not count unchanged context lines', () => {
        // Old: "context\nold_line\ncontext2"
        // New: "context\nnew_line\ncontext2"
        // Only 1 line changed each way — context lines excluded
        const result = computeNetDiff('context\nold_line\ncontext2', 'context\nnew_line\ncontext2');
        expect(result.insertions).toBe(1);
        expect(result.deletions).toBe(1);
    });

    it('handles empty old string (pure insertion)', () => {
        const result = computeNetDiff('', 'line1\nline2');
        expect(result.insertions).toBe(2);
        expect(result.deletions).toBe(0);
    });

    it('handles empty new string (pure deletion)', () => {
        const result = computeNetDiff('line1\nline2', '');
        expect(result.insertions).toBe(0);
        expect(result.deletions).toBe(2);
    });

    it('handles both strings empty', () => {
        const result = computeNetDiff('', '');
        expect(result.insertions).toBe(0);
        expect(result.deletions).toBe(0);
    });

    it('handles partial overlap correctly', () => {
        // Old: "a\nb\nc"  New: "a\nd\nc" => shared: a, c => ins=1 (d), del=1 (b)
        const result = computeNetDiff('a\nb\nc', 'a\nd\nc');
        expect(result.insertions).toBe(1);
        expect(result.deletions).toBe(1);
    });

    it('handles addition at end', () => {
        const result = computeNetDiff('a\nb', 'a\nb\nc');
        expect(result.insertions).toBe(1);
        expect(result.deletions).toBe(0);
    });

    it('handles deletion at end', () => {
        const result = computeNetDiff('a\nb\nc', 'a\nb');
        expect(result.insertions).toBe(0);
        expect(result.deletions).toBe(1);
    });

    it('handles single-line strings', () => {
        const result = computeNetDiff('old', 'new');
        expect(result.insertions).toBe(1);
        expect(result.deletions).toBe(1);
    });

    it('falls back to raw counts for very large inputs', () => {
        const bigOld = Array.from({ length: 600 }, (_, i) => `line${i}`).join('\n');
        const bigNew = Array.from({ length: 700 }, (_, i) => `other${i}`).join('\n');
        const result = computeNetDiff(bigOld, bigNew);
        // Fallback: raw line counts
        expect(result.deletions).toBe(600);
        expect(result.insertions).toBe(700);
    });
});

// ── computeFileEditTotals tests ────────────────────────────────────────────

describe('computeFileEditTotals', () => {
    it('sums net insertions/deletions across files', () => {
        const files: FileEdit[] = [
            { path: 'a.ts', insertions: 10, deletions: 5, netInsertions: 8, netDeletions: 3, isCreate: false },
            { path: 'b.ts', insertions: 20, deletions: 10, netInsertions: 15, netDeletions: 7, isCreate: false },
        ];
        const result = computeFileEditTotals(files);
        expect(result.totalInsertions).toBe(23);
        expect(result.totalDeletions).toBe(10);
    });

    it('returns 0/0 for empty array', () => {
        const result = computeFileEditTotals([]);
        expect(result.totalInsertions).toBe(0);
        expect(result.totalDeletions).toBe(0);
    });

    it('handles single file', () => {
        const files: FileEdit[] = [
            { path: 'x.ts', insertions: 5, deletions: 2, netInsertions: 4, netDeletions: 1, isCreate: false },
        ];
        const result = computeFileEditTotals(files);
        expect(result.totalInsertions).toBe(4);
        expect(result.totalDeletions).toBe(1);
    });

    it('handles create-only files', () => {
        const files: FileEdit[] = [
            { path: 'new.ts', insertions: 30, deletions: 0, netInsertions: 30, netDeletions: 0, isCreate: true },
        ];
        const result = computeFileEditTotals(files);
        expect(result.totalInsertions).toBe(30);
        expect(result.totalDeletions).toBe(0);
    });
});

// ── shortenPath tests ──────────────────────────────────────────────────────

describe('shortenPath', () => {
    it('returns last two segments for paths with multiple dirs', () => {
        expect(shortenPath('src/server/utils.ts')).toBe('server/utils.ts');
    });

    it('returns full path when only two segments', () => {
        expect(shortenPath('src/utils.ts')).toBe('src/utils.ts');
    });

    it('returns just filename for single-segment path', () => {
        expect(shortenPath('utils.ts')).toBe('utils.ts');
    });

    it('handles deeply nested paths', () => {
        expect(shortenPath('packages/coc/src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup'))
            .toBe('tool-calls/WhisperCollapsedGroup');
    });

    it('handles backslash paths', () => {
        expect(shortenPath('packages\\coc\\src\\utils.ts')).toBe('src/utils.ts');
    });

    it('truncates directory when result exceeds maxLen', () => {
        const result = shortenPath('packages/very-long-directory-name/utils.ts', 20);
        expect(result.length).toBeLessThanOrEqual(20);
        expect(result).toContain('…/');
        expect(result).toContain('utils.ts');
    });

    it('handles empty path gracefully', () => {
        expect(shortenPath('')).toBe('');
    });

    it('handles root-only path', () => {
        expect(shortenPath('file.ts')).toBe('file.ts');
    });
});

// ── FileHoverPopover — DiffBar rendering ──────────────────────────────────

describe('FileHoverPopover — DiffBar', () => {
    it('renders a diff-bar for each file row', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 10, deletions: 5, netInsertions: 8, netDeletions: 3, isCreate: false },
            { path: 'src/b.ts', insertions: 20, deletions: 0, netInsertions: 20, netDeletions: 0, isCreate: true },
        ]);
        const bars = container.querySelectorAll('[data-testid="diff-bar"]');
        expect(bars).toHaveLength(2);
    });

    it('diff-bar has green and red segments for mixed edits', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 10, deletions: 5, netInsertions: 6, netDeletions: 4, isCreate: false },
        ]);
        const bar = container.querySelector('[data-testid="diff-bar"]') as HTMLElement;
        expect(bar).not.toBeNull();
        // Bar should have two child spans (green + red)
        const segments = bar.querySelectorAll('span');
        expect(segments.length).toBe(2);
    });

    it('diff-bar is fully green for create-only files', () => {
        const container = renderAndHoverFiles([
            { path: 'src/new.ts', insertions: 15, deletions: 0, netInsertions: 15, netDeletions: 0, isCreate: true },
        ]);
        const bar = container.querySelector('[data-testid="diff-bar"]') as HTMLElement;
        expect(bar).not.toBeNull();
        // Only green segment (100% width)
        const segments = bar.querySelectorAll('span');
        expect(segments.length).toBe(1);
    });
});

// ── FileHoverPopover — path display ───────────────────────────────────────

describe('FileHoverPopover — path display', () => {
    it('shows dir/basename instead of just basename', () => {
        const container = renderAndHoverFiles([
            { path: 'packages/coc/src/utils.ts', insertions: 5, deletions: 2, netInsertions: 3, netDeletions: 1, isCreate: false },
        ]);
        const row = container.querySelector('[data-testid="file-popover-row"]');
        expect(row?.textContent).toContain('src/utils.ts');
    });

    it('shows full path in title attribute', () => {
        const container = renderAndHoverFiles([
            { path: 'packages/coc/src/utils.ts', insertions: 5, deletions: 2, netInsertions: 3, netDeletions: 1, isCreate: false },
        ]);
        const row = container.querySelector('[data-testid="file-popover-row"]');
        expect(row?.getAttribute('title')).toBe('packages/coc/src/utils.ts');
    });

    it('distinguishes two files with same basename in different dirs', () => {
        const container = renderAndHoverFiles([
            { path: 'src/chat/index.ts', insertions: 5, deletions: 2, netInsertions: 3, netDeletions: 1, isCreate: false },
            { path: 'src/shared/index.ts', insertions: 3, deletions: 1, netInsertions: 2, netDeletions: 1, isCreate: false },
        ]);
        const rows = container.querySelectorAll('[data-testid="file-popover-row"]');
        expect(rows[0].textContent).toContain('chat/index.ts');
        expect(rows[1].textContent).toContain('shared/index.ts');
    });
});

// ── FileHoverPopover — net counts display ─────────────────────────────────

describe('FileHoverPopover — net counts', () => {
    it('shows netInsertions/netDeletions instead of raw counts', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 20, deletions: 15, netInsertions: 5, netDeletions: 3, isCreate: false },
        ]);
        const row = container.querySelector('[data-testid="file-popover-row"]');
        expect(row?.textContent).toContain('+5');
        expect(row?.textContent).toContain('−3');
        // Should NOT show raw counts
        expect(row?.textContent).not.toContain('+20');
        expect(row?.textContent).not.toContain('−15');
    });
});

// ── FileHoverPopover — footer totals ──────────────────────────────────────

describe('FileHoverPopover — footer', () => {
    it('shows footer with totals when multiple files', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 10, deletions: 5, netInsertions: 8, netDeletions: 3, isCreate: false },
            { path: 'src/b.ts', insertions: 6, deletions: 2, netInsertions: 4, netDeletions: 1, isCreate: false },
        ]);
        const footer = container.querySelector('[data-testid="file-popover-footer"]');
        expect(footer).not.toBeNull();
        expect(footer?.textContent).toContain('2 files');
        expect(footer?.textContent).toContain('+12');
        expect(footer?.textContent).toContain('−4');
    });

    it('does not show footer for single file', () => {
        const container = renderAndHoverFiles([
            { path: 'src/a.ts', insertions: 5, deletions: 2, netInsertions: 3, netDeletions: 1, isCreate: false },
        ]);
        const footer = container.querySelector('[data-testid="file-popover-footer"]');
        expect(footer).toBeNull();
    });

    it('footer totals use net counts', () => {
        const container = renderAndHoverFiles([
            { path: 'a.ts', insertions: 100, deletions: 50, netInsertions: 10, netDeletions: 5, isCreate: false },
            { path: 'b.ts', insertions: 200, deletions: 100, netInsertions: 20, netDeletions: 10, isCreate: false },
        ]);
        const footer = container.querySelector('[data-testid="file-popover-footer"]');
        expect(footer?.textContent).toContain('+30');
        expect(footer?.textContent).toContain('−15');
    });
});

// ── Header inline totals ──────────────────────────────────────────────────

describe('FileHoverSpan — inline totals in header', () => {
    it('shows (+X −Y) after the files token', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            fileEditCount: 2,
            fileEdits: [
                { path: 'a.ts', insertions: 10, deletions: 5, netInsertions: 8, netDeletions: 3, isCreate: false },
                { path: 'b.ts', insertions: 6, deletions: 2, netInsertions: 4, netDeletions: 1, isCreate: false },
            ],
        });
        const inline = container.querySelector('[data-testid="file-total-inline"]');
        expect(inline).not.toBeNull();
        expect(inline?.textContent).toContain('+12');
        expect(inline?.textContent).toContain('−4');
    });

    it('omits inline totals when all counts are 0', () => {
        const { container } = renderHeader({
            toolCallCount: 5,
            messageCount: 1,
            fileEditCount: 1,
            fileEdits: [
                { path: 'a.ts', insertions: 0, deletions: 0, netInsertions: 0, netDeletions: 0, isCreate: false },
            ],
        });
        const inline = container.querySelector('[data-testid="file-total-inline"]');
        expect(inline).toBeNull();
    });

    it('shows only insertions when no deletions', () => {
        const { container } = renderHeader({
            toolCallCount: 2,
            messageCount: 0,
            fileEditCount: 1,
            fileEdits: [
                { path: 'new.ts', insertions: 15, deletions: 0, netInsertions: 15, netDeletions: 0, isCreate: true },
            ],
        });
        const inline = container.querySelector('[data-testid="file-total-inline"]');
        expect(inline).not.toBeNull();
        expect(inline?.textContent).toContain('+15');
        expect(inline?.textContent).not.toContain('−');
    });
});

// ── filterWhisperChunks — netInsertions/netDeletions population ────────────

describe('filterWhisperChunks — net diff fields', () => {
    // We need to import from the actual source (not the mocked version)
    // Since the mock only overrides groupConsecutiveToolChunks, filterWhisperChunks is untouched
    // But to avoid the mock, import via a separate path
    let filterWhisperChunks: typeof import('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils').filterWhisperChunks;

    beforeAll(async () => {
        const mod = await vi.importActual<typeof import('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils')>(
            '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils'
        );
        filterWhisperChunks = mod.filterWhisperChunks;
    });

    function makeMap(entries: Array<[string, any]>): Map<string, any> {
        return new Map(entries);
    }

    it('populates netInsertions/netDeletions with context-excluded counts', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'edit',
                status: 'completed',
                args: {
                    path: 'src/utils.ts',
                    old_str: 'context\nold_line\ncontext2',
                    new_str: 'context\nnew_line\ncontext2',
                },
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as any;
        expect(wg.summary.fileEdits).toHaveLength(1);
        const fe = wg.summary.fileEdits[0];
        // Raw counts include context lines
        expect(fe.insertions).toBe(3);
        expect(fe.deletions).toBe(3);
        // Net counts exclude context
        expect(fe.netInsertions).toBe(1);
        expect(fe.netDeletions).toBe(1);
    });

    it('net counts for create are same as raw', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'content', key: 'c1', html: '<p>Created.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'create',
                status: 'completed',
                args: { path: 'src/new.ts', file_text: 'a\nb\nc' },
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as any;
        const fe = wg.summary.fileEdits[0];
        expect(fe.netInsertions).toBe(3);
        expect(fe.netDeletions).toBe(0);
        expect(fe.insertions).toBe(3);
    });

    it('merges a Codex `/dev/null` create and a later edit to the same file into one row (no absolute-path duplicate)', () => {
        const createPatch = [
            'diff --git /dev/null b/packages/coc/src/sanitizeSvg.ts',
            'index e69de29bb..50661e98b 100644',
            '--- /dev/null',
            '+++ b/packages/coc/src/sanitizeSvg.ts',
            '@@ -0,0 +1,3 @@',
            '+import createDOMPurify from "dompurify";',
            '+export const sanitize = (s: string) => s;',
            '+export default sanitize;',
        ].join('\n');
        const editPatch = [
            'diff --git a/packages/coc/src/sanitizeSvg.ts b/packages/coc/src/sanitizeSvg.ts',
            'index 50661e98b..60771f00c 100644',
            '--- a/packages/coc/src/sanitizeSvg.ts',
            '+++ b/packages/coc/src/sanitizeSvg.ts',
            '@@ -1,3 +1,4 @@',
            ' import createDOMPurify from "dompurify";',
            '-export const sanitize = (s: string) => s;',
            '+export const sanitize = (s: string) => s.trim();',
            '+const DOMPurify = createDOMPurify();',
            ' export default sanitize;',
        ].join('\n');
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', { toolName: 'apply_patch', status: 'completed', args: { diff: createPatch } }],
            ['t2', { toolName: 'apply_patch', status: 'completed', args: { diff: editPatch } }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as any;
        // Exactly one FileEdit — no absolute-path fallback duplicate.
        expect(wg.summary.fileEdits).toHaveLength(1);
        const fe = wg.summary.fileEdits[0];
        expect(fe.path).toBe('packages/coc/src/sanitizeSvg.ts');
        // Insertions include the 3 created lines plus the 2 added by the edit.
        expect(fe.insertions).toBe(5);
        // Merged row is created + edited, so it is not a pure create.
        expect(fe.isCreate).toBe(false);
    });

    it('accumulates net diffs across multiple edits to same file', () => {
        const chunks = [
            { kind: 'tool', key: 'k-t1', toolId: 't1' },
            { kind: 'tool', key: 'k-t2', toolId: 't2' },
            { kind: 'content', key: 'c1', html: '<p>Done.</p>' },
        ];
        const toolById = makeMap([
            ['t1', {
                toolName: 'edit',
                status: 'completed',
                args: { path: 'src/a.ts', old_str: 'ctx\nold1\nctx', new_str: 'ctx\nnew1\nnew2\nctx' },
            }],
            ['t2', {
                toolName: 'edit',
                status: 'completed',
                args: { path: 'src/a.ts', old_str: 'remove_me', new_str: '' },
            }],
        ]);

        const result = filterWhisperChunks(chunks, toolById);
        const wg = result[0] as any;
        const fe = wg.summary.fileEdits[0];
        // First edit: LCS of [ctx,old1,ctx] vs [ctx,new1,new2,ctx] = ctx,ctx (len 2)
        // ins = 4-2 = 2, del = 3-2 = 1
        // Second edit: LCS of [remove_me] vs [] = 0, ins=0, del=1
        expect(fe.netInsertions).toBe(2);
        expect(fe.netDeletions).toBe(2);
    });
});
