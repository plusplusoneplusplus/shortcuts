/**
 * Tests for WhisperDiffDock — the mobile-vs-desktop host shell for the
 * transient read-only whisper diff panel (AC-03).
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
    diffText: 'diff --git a/foo b/foo\n+x',
    file,
    error: '',
};

const resize = { width: 560, handleMouseDown: vi.fn(), handleTouchStart: vi.fn() };

describe('WhisperDiffDock', () => {
    it('hosts the panel inside a BottomSheet at the mobile breakpoint', () => {
        render(
            <WhisperDiffDock
                file={file}
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
                file={file}
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
                file={file}
                state={successState}
                isMobile={false}
                onClose={() => {}}
                resize={resize}
            />,
        );
        fireEvent.mouseDown(screen.getByTestId('whisper-diff-resize-handle'));
        expect(resize.handleMouseDown).toHaveBeenCalled();
    });

    it('titles the mobile sheet with the file basename', () => {
        render(
            <WhisperDiffDock
                file={file}
                state={successState}
                isMobile
                onClose={() => {}}
                resize={resize}
            />,
        );
        // The basename shows in both the sheet title chrome and the panel header.
        expect(screen.getAllByText('foo.ts').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('foo.ts');
    });
});
