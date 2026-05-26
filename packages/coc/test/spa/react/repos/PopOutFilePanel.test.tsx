/**
 * Tests for PopOutFilePanel component.
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { PopOutFilePanel } from '../../../../src/server/spa/client/react/features/git/diff/PopOutFilePanel';
import type { FileChange } from '../../../../src/server/spa/client/react/features/git/diff/FileTree';

// Mock useFilesViewMode
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFilesViewMode', () => ({
    useFilesViewMode: () => ({
        mode: 'tree' as const,
        setMode: vi.fn(),
    }),
}));

// Mock useResizablePanel
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 280,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

const SAMPLE_FILES: FileChange[] = [
    { status: 'M', path: 'src/auth.ts', additions: 5, deletions: 2 },
    { status: 'A', path: 'src/login.ts', additions: 20, deletions: 0 },
    { status: 'D', path: 'tests/old.ts', additions: 0, deletions: 10 },
];

describe('PopOutFilePanel', () => {
    beforeEach(() => {
        try { localStorage.clear(); } catch { /* ignore */ }
    });

    it('renders file count', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        expect(screen.getByTestId('popout-file-panel-file-count').textContent).toBe('(3)');
    });

    it('renders file tree by default', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        expect(screen.getByTestId('popout-file-panel-list')).toBeTruthy();
    });

    it('calls onFileSelect when a file is clicked', () => {
        const handleSelect = vi.fn();
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={handleSelect}
            />
        );
        const fileBtn = screen.getByTestId('popout-file-src/auth.ts');
        fireEvent.click(fileBtn);
        expect(handleSelect).toHaveBeenCalledWith('src/auth.ts');
    });

    it('collapses panel when collapse button is clicked', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        // Initially expanded
        expect(screen.getByTestId('popout-file-panel')).toBeTruthy();

        // Click collapse
        fireEvent.click(screen.getByTestId('popout-file-panel-collapse-btn'));

        // Should now be collapsed
        expect(screen.getByTestId('popout-file-panel-collapsed')).toBeTruthy();
    });

    it('expands panel from collapsed state', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        // Collapse first
        fireEvent.click(screen.getByTestId('popout-file-panel-collapse-btn'));
        expect(screen.getByTestId('popout-file-panel-collapsed')).toBeTruthy();

        // Expand
        fireEvent.click(screen.getByTestId('popout-file-panel-expand-btn'));
        expect(screen.getByTestId('popout-file-panel')).toBeTruthy();
    });

    it('shows comment badges when fileCommentMap has entries', () => {
        const commentMap = new Map<string, number>([
            ['src/auth.ts', 3],
        ]);
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
                fileCommentMap={commentMap}
            />
        );
        const badge = screen.getByTestId('popout-file-comment-badge-src/auth.ts');
        expect(badge.textContent).toContain('3');
    });

    it('shows the files view toggle', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        expect(screen.getByTestId('popout-files-view-toggle')).toBeTruthy();
    });

    it('renders resize handle', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        expect(screen.getByTestId('popout-file-panel-resize-handle')).toBeTruthy();
    });

    it('shows collapsed file count in vertical text', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={SAMPLE_FILES}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        // Collapse
        fireEvent.click(screen.getByTestId('popout-file-panel-collapse-btn'));
        expect(screen.getByTestId('popout-file-panel-file-count-collapsed').textContent).toBe('3 files');
    });

    it('handles empty file list', () => {
        render(
            <PopOutFilePanel
                workspaceId="ws1"
                files={[]}
                selectedFilePath={null}
                onFileSelect={() => {}}
            />
        );
        expect(screen.getByTestId('popout-file-panel-file-count').textContent).toBe('(0)');
    });

    describe('classification-aware controls', () => {
        const badges = new Map<string, { category: 'logic' | 'mechanical' | 'test' | 'generated'; intensity: 'high' | 'low' }>([
            ['src/auth.ts', { category: 'logic', intensity: 'high' }],
            ['src/login.ts', { category: 'mechanical', intensity: 'low' }],
            ['tests/old.ts', { category: 'test', intensity: 'low' }],
        ]);
        const getFileBadge = (p: string) => badges.get(p);

        it('does not render the classification bar when no badge fn is given', () => {
            render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                />
            );
            expect(screen.queryByTestId('popout-file-panel-classification-bar')).toBeNull();
        });

        it('renders category counts when classification is available', () => {
            render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                />
            );
            expect(screen.getByTestId('popout-file-panel-classification-bar')).toBeTruthy();
            expect(screen.getByTestId('popout-file-panel-count-logic').textContent).toContain('1');
            expect(screen.getByTestId('popout-file-panel-count-mechanical').textContent).toContain('1');
            expect(screen.getByTestId('popout-file-panel-count-test').textContent).toContain('1');
            expect(screen.getByTestId('popout-file-panel-count-generated').textContent).toContain('0');
        });

        it('renders progress reviewed/total totals', () => {
            const reviewed = new Set(['src/auth.ts']);
            render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                    reviewedFiles={reviewed}
                />
            );
            expect(screen.getByTestId('popout-file-panel-progress').textContent).toBe('Reviewed 1/3');
            // Logic file 'src/auth.ts' is the only logic file; once reviewed, remaining = 0
            expect(screen.getByTestId('popout-file-panel-logic-remaining').textContent).toBe('Logic remaining 0');
        });

        it('renders priority sort toggle and fires handler on click', () => {
            const onToggle = vi.fn();
            render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                    onTogglePrioritySort={onToggle}
                />
            );
            fireEvent.click(screen.getByTestId('popout-file-panel-priority-sort-toggle'));
            expect(onToggle).toHaveBeenCalledOnce();
        });

        it('shows "Show all" button only when some filters are off', () => {
            const allOn = new Set(['logic', 'mechanical', 'test', 'generated'] as const);
            const partial = new Set(['logic'] as const);
            const onShowAll = vi.fn();

            const { rerender } = render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                    activeFilters={allOn}
                    onShowAll={onShowAll}
                />
            );
            expect(screen.queryByTestId('popout-file-panel-show-all')).toBeNull();

            rerender(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                    activeFilters={partial}
                    onShowAll={onShowAll}
                />
            );
            const showAll = screen.getByTestId('popout-file-panel-show-all');
            fireEvent.click(showAll);
            expect(onShowAll).toHaveBeenCalledOnce();
        });

        it('renders classification badge next to a file in tree view', () => {
            render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                />
            );
            // Tree view is the mocked default. Badge appears for each classified file.
            expect(screen.getByTestId('tree-file-category-badge-src/auth.ts').textContent).toBe('L');
            expect(screen.getByTestId('tree-file-category-badge-src/login.ts').textContent).toBe('M');
            expect(screen.getByTestId('tree-file-category-badge-tests/old.ts').textContent).toBe('T');
        });

        it('renders reviewed (✓) and visited (•) indicators distinctly', () => {
            const reviewed = new Set(['src/auth.ts']);
            const visited = new Set(['src/login.ts', 'src/auth.ts']);
            render(
                <PopOutFilePanel
                    workspaceId="ws1"
                    files={SAMPLE_FILES}
                    selectedFilePath={null}
                    onFileSelect={() => {}}
                    getFileBadge={getFileBadge}
                    reviewedFiles={reviewed}
                    visitedFiles={visited}
                />
            );
            // Reviewed wins over visited
            expect(screen.getByTestId('tree-file-reviewed-src/auth.ts').textContent).toContain('✓');
            expect(screen.queryByTestId('tree-file-visited-src/auth.ts')).toBeNull();
            // Visited-but-not-reviewed shows dot
            expect(screen.getByTestId('tree-file-visited-src/login.ts').textContent).toContain('•');
            expect(screen.queryByTestId('tree-file-reviewed-src/login.ts')).toBeNull();
            // Untouched file has neither
            expect(screen.queryByTestId('tree-file-reviewed-tests/old.ts')).toBeNull();
            expect(screen.queryByTestId('tree-file-visited-tests/old.ts')).toBeNull();
        });
    });
});
