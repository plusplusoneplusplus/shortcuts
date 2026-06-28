/**
 * Tests for WhisperDiffPanel — the inner chrome of the transient read-only
 * whisper diff panel (AC-03).
 *
 * Asserts the header (file name, project-relative path) and the four explicit
 * body states (loading / success / empty / error)
 * driven by `useWhisperDiffState`'s output, plus the read-only contract (no
 * copy/reveal/comment affordances). The heavy `UnifiedDiffViewer` is stubbed so
 * the test stays focused on the panel's state switch (same approach as the
 * SourceCanvas dock tests stubbing their heavy leaves).
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ diff, fileName, 'data-testid': testId }: any) => (
        <pre data-testid={testId} data-file-name={fileName}>{diff}</pre>
    ),
}));

import { WhisperDiffPanel } from '../../../src/server/spa/client/react/features/chat/whisper-diff/WhisperDiffPanel';
import type { WhisperDiffState } from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
import type { FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

const file: FileEdit = {
    path: '/home/u/proj/src/foo/bar.ts',
    insertions: 2,
    deletions: 1,
    netInsertions: 2,
    netDeletions: 1,
    isCreate: false,
    isDeleted: false,
};

function state(partial: Partial<WhisperDiffState>): WhisperDiffState {
    return { status: 'idle', diffText: '', file, error: '', ...partial };
}

describe('WhisperDiffPanel', () => {
    it('renders the file name and project-relative path', () => {
        render(
            <WhisperDiffPanel
                file={file}
                state={state({ status: 'success', diffText: 'diff --git a/x b/x' })}
                workspaceRootPath="/home/u/proj"
                onClose={() => {}}
            />,
        );
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('bar.ts');
        // Project-relative path (root stripped), absolute path kept in the title.
        const pathEl = screen.getByTestId('whisper-diff-path');
        expect(pathEl).toHaveTextContent('src/foo/bar.ts');
        expect(pathEl).toHaveAttribute('title', '/home/u/proj/src/foo/bar.ts');
        expect(screen.queryByTestId('whisper-diff-source-label')).toBeNull();
    });

    it('renders the unified diff in the success state', () => {
        render(
            <WhisperDiffPanel
                file={file}
                state={state({ status: 'success', diffText: 'diff --git a/bar b/bar\n+added' })}
                onClose={() => {}}
            />,
        );
        const viewer = screen.getByTestId('whisper-diff-viewer');
        expect(viewer).toHaveTextContent('+added');
        expect(viewer).toHaveAttribute('data-file-name', 'bar.ts');
        expect(screen.queryByTestId('whisper-diff-loading')).toBeNull();
        expect(screen.queryByTestId('whisper-diff-empty')).toBeNull();
        expect(screen.queryByTestId('whisper-diff-error')).toBeNull();
    });

    it('shows a spinner in the loading state', () => {
        render(
            <WhisperDiffPanel file={file} state={state({ status: 'loading' })} onClose={() => {}} />,
        );
        expect(screen.getByTestId('whisper-diff-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
    });

    it('treats idle as loading so the body never flashes blank', () => {
        render(
            <WhisperDiffPanel file={file} state={state({ status: 'idle' })} onClose={() => {}} />,
        );
        expect(screen.getByTestId('whisper-diff-loading')).toBeInTheDocument();
    });

    it('shows an explicit empty state with no diff viewer', () => {
        render(
            <WhisperDiffPanel
                file={file}
                state={state({ status: 'empty', error: 'No diff is available for this file.' })}
                onClose={() => {}}
            />,
        );
        expect(screen.getByTestId('whisper-diff-empty')).toHaveTextContent('No diff is available for this file.');
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
    });

    it('shows an explicit error state with the failure message', () => {
        render(
            <WhisperDiffPanel
                file={file}
                state={state({ status: 'error', error: 'network exploded' })}
                onClose={() => {}}
            />,
        );
        const err = screen.getByTestId('whisper-diff-error');
        expect(err).toHaveTextContent("Couldn't load the diff for bar.ts");
        expect(err).toHaveTextContent('network exploded');
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
    });

    it('invokes onClose from the close button', () => {
        const onClose = vi.fn();
        render(
            <WhisperDiffPanel file={file} state={state({ status: 'success', diffText: 'd' })} onClose={onClose} />,
        );
        fireEvent.click(screen.getByTestId('whisper-diff-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('is read-only: no copy, reveal, or comment affordances', () => {
        render(
            <WhisperDiffPanel file={file} state={state({ status: 'success', diffText: 'd' })} onClose={() => {}} />,
        );
        expect(screen.queryByTestId('source-canvas-copy-btn')).toBeNull();
        expect(screen.queryByTestId('source-canvas-reveal-btn')).toBeNull();
        // The only button in the panel chrome is Close.
        const panel = screen.getByTestId('whisper-diff-panel');
        expect(panel.querySelectorAll('button')).toHaveLength(1);
    });
});
