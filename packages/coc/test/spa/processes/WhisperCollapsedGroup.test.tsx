import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { WhisperCollapsedGroup } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/WhisperCollapsedGroup';
import type { WhisperSummary } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';
import type { DetectedCommit } from '../../../src/server/spa/client/react/features/chat/conversation/commitDetection';

function makeToolMap(entries: Array<[string, any]>): Map<string, any> {
    return new Map(entries);
}

const defaultProps = {
    precedingChunks: [],
    toolById: new Map() as any,
    toolsWithChildren: new Set<string>(),
    toolParentById: new Map<string, string>(),
    groupSingleLineMessages: false,
    renderToolTree: () => null,
};

function makeSummary(overrides: Partial<WhisperSummary> = {}): WhisperSummary {
    return {
        toolCallCount: 5,
        messageCount: 2,
        ...overrides,
    };
}

function makeCommit(overrides: Partial<DetectedCommit> = {}): DetectedCommit {
    return {
        shortHash: 'abc1234',
        subject: 'feat: add feature',
        toolCallId: 't1',
        isFixup: false,
        ...overrides,
    };
}

describe('WhisperCollapsedGroup', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders commit count in header', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 3, commits: [
                    makeCommit({ shortHash: 'aaa1111' }),
                    makeCommit({ shortHash: 'bbb2222' }),
                    makeCommit({ shortHash: 'ccc3333' }),
                ] })}
            />,
        );
        expect(screen.getByTestId('whisper-header-text').textContent).toContain('3 commits');
    });

    it('renders commit hover span with dotted underline for commit text', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverSpan = screen.getByTestId('whisper-commit-hover');
        expect(hoverSpan).toBeDefined();
        expect(hoverSpan.textContent).toBe('1 commit');
        expect(hoverSpan.className).toContain('underline');
    });

    it('shows commit popover on hover', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 2, commits: [
                    makeCommit({ shortHash: 'abc1234', subject: 'feat: first' }),
                    makeCommit({ shortHash: 'def5678', subject: 'fix: second' }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const popover = screen.getByTestId('commit-hover-popover');
        expect(popover).toBeDefined();
        expect(screen.getByTestId('commit-popover-row-abc1234')).toBeDefined();
        expect(screen.getByTestId('commit-popover-row-def5678')).toBeDefined();
        expect(popover.textContent).toContain('abc1234');
        expect(popover.textContent).toContain('feat: first');
        expect(popover.textContent).toContain('def5678');
        expect(popover.textContent).toContain('fix: second');
    });

    it('renders commit popover in a document.body portal at viewport coordinates', () => {
        const { container } = render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        vi.spyOn(hoverTarget, 'getBoundingClientRect').mockReturnValue({
            top: 140,
            bottom: 164,
            left: 64,
            right: 132,
            width: 68,
            height: 24,
            x: 64,
            y: 140,
            toJSON: () => ({}),
        } as DOMRect);

        fireEvent.mouseEnter(hoverTarget);

        const popover = screen.getByTestId('commit-hover-popover');
        expect(popover).toBeDefined();
        expect(container.querySelector('[data-testid="commit-hover-popover"]')).toBeNull();
        expect(popover.style.top).toBe('168px');
        expect(popover.style.left).toBe('64px');
    });

    it('dismisses commit popover on Escape', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);
        expect(screen.getByTestId('commit-hover-popover')).toBeDefined();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByTestId('commit-hover-popover')).toBeNull();
    });

    it('hides commit popover on mouse leave after grace timer', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);
        expect(screen.getByTestId('commit-hover-popover')).toBeDefined();

        fireEvent.mouseLeave(hoverTarget);
        act(() => { vi.advanceTimersByTime(200); });
        expect(screen.queryByTestId('commit-hover-popover')).toBeNull();
    });

    it('commit popover rows show correct emoji for regular vs fixup commits', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ fixupCommitCount: 1, fixupCommits: [
                    makeCommit({ shortHash: 'fix1234', subject: 'fixup! feat: auth', isFixup: true }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-fixup-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-fix1234');
        expect(row.textContent).toContain('🔧');
    });

    it('commit popover row navigates to git tab on click when workspaceId provided', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                workspaceId="my-workspace"
                summary={makeSummary({ commitCount: 1, commits: [
                    makeCommit({ shortHash: 'abc1234', fullHash: 'abc1234567890' }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-abc1234');
        fireEvent.click(row);
        expect(location.hash).toBe('#repos/my-workspace/git/abc1234567890');
    });

    it('commit popover row is not clickable when workspaceId is absent', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-abc1234');
        expect(row.getAttribute('role')).toBeNull();
        expect(row.className).not.toContain('cursor-pointer');
    });

    it('shows fixup hover span separately from commit hover span', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary({
                    commitCount: 1,
                    commits: [makeCommit({ shortHash: 'aaa1111' })],
                    fixupCommitCount: 1,
                    fixupCommits: [makeCommit({ shortHash: 'bbb2222', isFixup: true })],
                })}
            />,
        );
        expect(screen.getByTestId('whisper-commit-hover').textContent).toBe('1 commit');
        expect(screen.getByTestId('whisper-fixup-hover').textContent).toBe('1 fixup');
    });

    it('no hover span when commitCount is zero or absent', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                summary={makeSummary()}
            />,
        );
        expect(screen.queryByTestId('whisper-commit-hover')).toBeNull();
        expect(screen.queryByTestId('whisper-fixup-hover')).toBeNull();
    });

    it('uses shortHash for navigation when fullHash is absent', () => {
        render(
            <WhisperCollapsedGroup
                {...defaultProps}
                workspaceId="ws1"
                summary={makeSummary({ commitCount: 1, commits: [
                    makeCommit({ shortHash: 'abc1234', fullHash: undefined }),
                ] })}
            />,
        );
        const hoverTarget = screen.getByTestId('whisper-commit-hover');
        fireEvent.mouseEnter(hoverTarget);

        const row = screen.getByTestId('commit-popover-row-abc1234');
        fireEvent.click(row);
        expect(location.hash).toBe('#repos/ws1/git/abc1234');
    });

    describe('commit popover pop-out button', () => {
        let originalOpen: typeof window.open;

        beforeEach(() => {
            originalOpen = window.open;
        });

        afterEach(() => {
            window.open = originalOpen;
        });

        it('renders pop-out button in commit popover row when workspaceId is set', () => {
            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    workspaceId="ws1"
                    summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-commit-hover');
            fireEvent.mouseEnter(hoverTarget);
            const btn = screen.getByTestId('commit-popover-popout-abc1234');
            expect(btn).toBeDefined();
            expect(btn.getAttribute('title')).toBe('Open in new window');
            expect(btn.textContent).toContain('↗️');
        });

        it('does not render pop-out button when workspaceId is missing', () => {
            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    summary={makeSummary({ commitCount: 1, commits: [makeCommit()] })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-commit-hover');
            fireEvent.mouseEnter(hoverTarget);
            expect(screen.queryByTestId('commit-popover-popout-abc1234')).toBeNull();
        });

        it('opens commit in dedicated window on pop-out button click', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    workspaceId="ws1"
                    summary={makeSummary({ commitCount: 1, commits: [
                        makeCommit({ shortHash: 'abc1234', fullHash: 'abc12340000000000000000000000000000000de' }),
                    ] })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-commit-hover');
            fireEvent.mouseEnter(hoverTarget);
            const btn = screen.getByTestId('commit-popover-popout-abc1234');
            fireEvent.click(btn);

            expect(openSpy).toHaveBeenCalledTimes(1);
            const [url, name, features] = openSpy.mock.calls[0];
            expect(url).toBe('/?workspace=ws1#popout/git-review/abc12340000000000000000000000000000000de');
            expect(name).toBe('coc-git-review-abc12340000000000000000000000000000000de');
            expect(features).toContain('width=');
            expect(features).toContain('height=');
        });

        it('pop-out click stops propagation so row navigation does not occur', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    workspaceId="ws1"
                    summary={makeSummary({ commitCount: 1, commits: [
                        makeCommit({ shortHash: 'abc1234', fullHash: 'abc1234567890' }),
                    ] })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-commit-hover');
            fireEvent.mouseEnter(hoverTarget);

            const prevHash = location.hash;
            const btn = screen.getByTestId('commit-popover-popout-abc1234');
            fireEvent.click(btn);

            expect(location.hash).toBe(prevHash);
        });

        it('uses shortHash for pop-out when fullHash is absent', () => {
            const openSpy = vi.fn().mockReturnValue({} as unknown as Window);
            window.open = openSpy as unknown as typeof window.open;

            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    workspaceId="ws1"
                    summary={makeSummary({ commitCount: 1, commits: [
                        makeCommit({ shortHash: 'abc1234', fullHash: undefined }),
                    ] })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-commit-hover');
            fireEvent.mouseEnter(hoverTarget);

            const btn = screen.getByTestId('commit-popover-popout-abc1234');
            fireEvent.click(btn);

            const [, name] = openSpy.mock.calls[0];
            expect(name).toBe('coc-git-review-abc1234');
        });
    });

    // ── Expanded inline commit detection (bash tool) ──────────────────────────
    describe('bash tool commit detection when expanded', () => {
        it('shows CommitStrip for a bash tool call with git commit output when expanded', () => {
            // Regression: WhisperCollapsedGroup was missing 'bash' from its shell-tool
            // check, so commits from Bash tools were never shown even when the group
            // was expanded (toolCompactness=3 is the default).
            const toolId = 'bash-commit-t1';
            const toolByIdMap = makeToolMap([[
                toolId,
                {
                    toolName: 'bash',
                    args: { command: 'git add -A && git commit -m "fix: persist setting"' },
                    result: '[main 3fe0d631] fix: persist setting\n 2 files changed, 10 insertions(+), 1 deletion(-)',
                    status: 'completed',
                },
            ]]);
            const precedingChunks = [{ kind: 'tool', key: 'chunk-t1', toolId }] as any[];

            const { container } = render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    precedingChunks={precedingChunks}
                    toolById={toolByIdMap}
                    summary={makeSummary()}
                    renderToolTree={() => <div data-testid="tool-node" />}
                />,
            );

            // Before expanding: no CommitStrip
            expect(container.querySelector('[data-testid="commit-strip"]')).toBeNull();

            fireEvent.click(screen.getByTestId('whisper-toggle'));

            // After expanding: CommitStrip should appear with the detected commit
            const strip = container.querySelector('[data-testid="commit-strip"]');
            expect(strip).toBeTruthy();
            expect(strip!.textContent).toContain('3fe0d631');
            expect(strip!.textContent).toContain('fix: persist setting');
        });

        it('also detects Bash (PascalCase) tool name after normalisation', () => {
            // normalizeToolName('Bash') → 'bash'; the condition must include 'bash'
            const toolId = 'Bash-commit-t2';
            const toolByIdMap = makeToolMap([[
                toolId,
                {
                    toolName: 'Bash',
                    args: { command: 'git commit -m "chore: update deps"' },
                    result: '[main abc1234] chore: update deps\n 1 file changed, 5 insertions(+)',
                    status: 'completed',
                },
            ]]);
            const precedingChunks = [{ kind: 'tool', key: 'chunk-t2', toolId }] as any[];

            const { container } = render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    precedingChunks={precedingChunks}
                    toolById={toolByIdMap}
                    summary={makeSummary()}
                    renderToolTree={() => <div data-testid="tool-node" />}
                />,
            );

            fireEvent.click(screen.getByTestId('whisper-toggle'));

            const strip = container.querySelector('[data-testid="commit-strip"]');
            expect(strip).toBeTruthy();
            expect(strip!.textContent).toContain('abc1234');
        });

        it('does not show CommitStrip for powershell with read-only git command', () => {
            // Ensure the fix does not break the existing false-positive guard
            const toolId = 'ps-log-t3';
            const toolByIdMap = makeToolMap([[
                toolId,
                {
                    toolName: 'powershell',
                    args: { command: 'git log --oneline' },
                    result: '[main abc1234] Some old commit',
                    status: 'completed',
                },
            ]]);
            const precedingChunks = [{ kind: 'tool', key: 'chunk-t3', toolId }] as any[];

            const { container } = render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    precedingChunks={precedingChunks}
                    toolById={toolByIdMap}
                    summary={makeSummary()}
                    renderToolTree={() => <div data-testid="tool-node" />}
                />,
            );

            fireEvent.click(screen.getByTestId('whisper-toggle'));

            // commitDetection.ts filters out git log output
            expect(container.querySelector('[data-testid="commit-strip"]')).toBeNull();
        });
    });

    // ── File deletion display ──────────────────────────────────────────────

    describe('deleted file display', () => {
        function makeFileEdit(overrides: Partial<import('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils').FileEdit> = {}): import('../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils').FileEdit {
            return {
                path: 'src/file.ts',
                insertions: 10,
                deletions: 0,
                netInsertions: 10,
                netDeletions: 0,
                isCreate: true,
                isDeleted: false,
                ...overrides,
            };
        }

        it('shows "N removed" in header when deletedFileCount > 0', () => {
            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    summary={makeSummary({
                        fileEditCount: 2,
                        deletedFileCount: 1,
                        fileEdits: [
                            makeFileEdit({ path: 'src/keep.ts' }),
                            makeFileEdit({ path: 'src/removed.ts', isDeleted: true }),
                        ],
                    })}
                />,
            );
            const header = screen.getByTestId('whisper-header-text').textContent!;
            expect(header).toContain('1 file');
            expect(header).toContain('1 removed');
        });

        it('shows only "N removed" when all files are deleted', () => {
            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    summary={makeSummary({
                        fileEditCount: 1,
                        deletedFileCount: 1,
                        fileEdits: [
                            makeFileEdit({ path: 'src/gone.ts', isDeleted: true }),
                        ],
                    })}
                />,
            );
            const header = screen.getByTestId('whisper-header-text').textContent!;
            expect(header).toContain('1 removed');
            // Should not show "0 files"
            expect(header).not.toContain('0 file');
        });

        it('shows deleted file with trash icon and strikethrough in popover', () => {
            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    summary={makeSummary({
                        fileEditCount: 2,
                        deletedFileCount: 1,
                        fileEdits: [
                            makeFileEdit({ path: 'src/keep.ts' }),
                            makeFileEdit({ path: 'src/removed.ts', isDeleted: true }),
                        ],
                    })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-file-hover');
            fireEvent.mouseEnter(hoverTarget);

            // Should have one regular row and one deleted row
            const regularRows = screen.getAllByTestId('file-popover-row');
            const deletedRows = screen.getAllByTestId('file-popover-row-deleted');
            expect(regularRows).toHaveLength(1);
            expect(deletedRows).toHaveLength(1);

            // Deleted row should show "removed" text
            expect(deletedRows[0].textContent).toContain('removed');
        });

        it('excludes deleted files from inline totals', () => {
            render(
                <WhisperCollapsedGroup
                    {...defaultProps}
                    summary={makeSummary({
                        fileEditCount: 2,
                        deletedFileCount: 1,
                        fileEdits: [
                            makeFileEdit({ path: 'src/keep.ts', netInsertions: 5, netDeletions: 2 }),
                            makeFileEdit({ path: 'src/removed.ts', netInsertions: 100, netDeletions: 0, isDeleted: true }),
                        ],
                    })}
                />,
            );
            const hoverTarget = screen.getByTestId('whisper-file-hover');
            fireEvent.mouseEnter(hoverTarget);

            // Inline totals should only count the non-deleted file
            const inline = screen.getByTestId('file-total-inline');
            expect(inline.textContent).toContain('+5');
            expect(inline.textContent).toContain('−2');
            expect(inline.textContent).not.toContain('+105');
        });
    });
});
