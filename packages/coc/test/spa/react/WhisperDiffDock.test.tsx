/**
 * Tests for WhisperDiffDock — the mobile-vs-desktop host shell for the converged
 * read-only whisper diff panel (AC-03).
 *
 * Mobile (`isMobile`) → the panel renders inside a `BottomSheet` (the existing
 * source-canvas bottom-sheet style). Desktop → a resizable sibling column with
 * a drag handle. The real `WhisperDiffPanel` is rendered so the composition is
 * exercised end-to-end; only the heavy `UnifiedDiffViewer` leaf is stubbed.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, 'data-testid': testId }: any) => (
        <pre data-testid={testId}>{diff}</pre>
    ),
}));

import { WhisperDiffDock } from '../../../src/server/spa/client/react/features/chat/whisper-diff/WhisperDiffDock';
import type { WhisperDiffState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
import type { FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

const file: FileEdit = {
    path: '/home/u/proj/src/foo.ts',
    insertions: 1,
    deletions: 0,
    netInsertions: 1,
    netDeletions: 0,
    isCreate: false,
    isDeleted: false,
};

const successState: WhisperDiffState = {
    status: 'success',
    view: {
        sections: [{ file, diff: 'diff --git a/foo b/foo\n+x' }],
        deletedFiles: [],
        nonReconstructableFiles: [],
        fileCount: 1,
        totalInsertions: 1,
        totalDeletions: 0,
    },
    files: [file],
    error: '',
};

const resize = { width: 560, handleMouseDown: vi.fn(), handleTouchStart: vi.fn() };

describe('WhisperDiffDock', () => {
    it('hosts the panel inside a BottomSheet at the mobile breakpoint', () => {
        render(
            <WhisperDiffDock
                state={successState}
                workspaceRootPath="/home/u/proj"
                isMobile
                onClose={() => {}}
                resize={resize}
            />,
        );
        const sheet = screen.getByTestId('bottomsheet-panel');
        const panel = screen.getByTestId('whisper-diff-panel');
        expect(sheet.contains(panel)).toBe(true);
        // The desktop column is NOT rendered on mobile.
        expect(screen.queryByTestId('whisper-diff-column')).toBeNull();
        expect(screen.queryByTestId('whisper-diff-resize-handle')).toBeNull();
    });

    it('uses the resizable desktop column (not a BottomSheet) when not mobile', () => {
        render(
            <WhisperDiffDock
                state={successState}
                workspaceRootPath="/home/u/proj"
                isMobile={false}
                onClose={() => {}}
                resize={resize}
            />,
        );
        const column = screen.getByTestId('whisper-diff-column');
        expect(column).toBeTruthy();
        expect((column as HTMLElement).style.width).toBe('560px');
        expect(screen.getByTestId('whisper-diff-resize-handle')).toBeTruthy();
        expect(column.contains(screen.getByTestId('whisper-diff-panel'))).toBe(true);
        expect(screen.queryByTestId('bottomsheet-panel')).toBeNull();
    });

    it('forwards resize handlers from the desktop drag handle', () => {
        render(
            <WhisperDiffDock
                state={successState}
                isMobile={false}
                onClose={() => {}}
                resize={resize}
            />,
        );
        fireEvent.mouseDown(screen.getByTestId('whisper-diff-resize-handle'));
        expect(resize.handleMouseDown).toHaveBeenCalled();
    });

    it('titles the mobile sheet with the whole-group file count and defaults to "All files"', () => {
        render(
            <WhisperDiffDock
                state={successState}
                isMobile
                onClose={() => {}}
                resize={resize}
            />,
        );
        // Sheet chrome shows the group count; the panel header dropdown defaults
        // to the stacked "All files" view.
        expect(screen.getByText('1 file changed')).toBeInTheDocument();
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('All files');
    });

    it('pluralizes the sheet title for a multi-file group', () => {
        const multi: WhisperDiffState = {
            ...successState,
            view: { ...successState.view, fileCount: 3 },
        };
        render(
            <WhisperDiffDock state={multi} isMobile onClose={() => {}} resize={resize} />,
        );
        expect(screen.getByText('3 files changed')).toBeInTheDocument();
    });
});
