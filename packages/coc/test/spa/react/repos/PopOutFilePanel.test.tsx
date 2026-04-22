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
});
