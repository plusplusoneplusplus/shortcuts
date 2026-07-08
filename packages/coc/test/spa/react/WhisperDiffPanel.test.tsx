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
    UnifiedDiffViewer: ({ diff, fileName, hideFileHeaders, 'data-testid': testId }: any) => (
        <pre data-testid={testId} data-file-name={fileName} data-hide-file-headers={hideFileHeaders ? 'true' : 'false'}>{diff}</pre>
    ),
}));

import { WhisperDiffPanel } from '../../../src/server/spa/client/react/features/chat/whisper-diff/WhisperDiffPanel';
import type {
    CombinedWhisperDiffView,
    WhisperDiffState,
} from '../../../src/server/spa/client/react/features/chat/whisper-diff/useWhisperDiffState';
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

function fileEdit(path: string, over: Partial<FileEdit> = {}): FileEdit {
    return {
        path,
        insertions: 1,
        deletions: 0,
        netInsertions: 1,
        netDeletions: 0,
        isCreate: false,
        isDeleted: false,
        ...over,
    };
}

function combinedView(over: Partial<CombinedWhisperDiffView> = {}): CombinedWhisperDiffView {
    return {
        sections: [],
        deletedFiles: [],
        nonReconstructableFiles: [],
        fileCount: 0,
        totalInsertions: 0,
        totalDeletions: 0,
        ...over,
    };
}

function combinedState(view: CombinedWhisperDiffView): WhisperDiffState {
    const hasDiff = view.sections.length > 0;
    return {
        status: hasDiff ? 'success' : 'empty',
        diffText: view.sections.map((s) => s.diff).join('\n'),
        file: null,
        error: hasDiff ? '' : 'No diff is available for these files.',
        combined: view,
    };
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
        expect(viewer).toHaveAttribute('data-hide-file-headers', 'true');
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

describe('WhisperDiffPanel — combined "All changes" mode (AC-03)', () => {
    const sections = [
        { file: fileEdit('/home/u/proj/src/a.ts'), diff: 'diff --git a/src/a.ts b/src/a.ts\n+A' },
        { file: fileEdit('/home/u/proj/src/sub/b.ts'), diff: 'diff --git a/src/sub/b.ts b/src/sub/b.ts\n+B' },
    ];

    it('shows the "All changes" header with the N-files totals instead of a filename', () => {
        render(
            <WhisperDiffPanel
                state={combinedState(combinedView({
                    sections,
                    fileCount: 2,
                    totalInsertions: 7,
                    totalDeletions: 3,
                }))}
                workspaceRootPath="/home/u/proj"
                onClose={() => {}}
            />,
        );
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('All changes');
        expect(screen.getByTestId('whisper-diff-totals')).toHaveTextContent('2 files (+7 −3)');
        // No single-file path subtitle in combined mode.
        expect(screen.queryByTestId('whisper-diff-path')).toBeNull();
    });

    it('renders a filename divider before each file section, in order', () => {
        render(
            <WhisperDiffPanel
                state={combinedState(combinedView({ sections, fileCount: 2 }))}
                workspaceRootPath="/home/u/proj"
                onClose={() => {}}
            />,
        );
        const dividers = screen.getAllByTestId('whisper-diff-file-divider');
        expect(dividers.map((d) => d.textContent)).toEqual(['src/a.ts', 'src/sub/b.ts']);
        // One diff viewer per section, with the section's diff content.
        const viewers = screen.getAllByTestId('whisper-diff-section-viewer');
        expect(viewers).toHaveLength(2);
        expect(viewers[0]).toHaveTextContent('+A');
        expect(viewers[1]).toHaveTextContent('+B');
        expect(viewers[0]).toHaveAttribute('data-hide-file-headers', 'true');
        expect(viewers[1]).toHaveAttribute('data-hide-file-headers', 'true');
        // No empty message when there are reconstructable sections.
        expect(screen.queryByTestId('whisper-diff-empty')).toBeNull();
    });

    it('lists deleted and non-reconstructable files in the "not shown" section', () => {
        render(
            <WhisperDiffPanel
                state={combinedState(combinedView({
                    sections: [sections[0]],
                    fileCount: 3,
                    deletedFiles: [fileEdit('/home/u/proj/src/gone.ts', { isDeleted: true })],
                    nonReconstructableFiles: [fileEdit('/home/u/proj/src/codex.ts')],
                }))}
                workspaceRootPath="/home/u/proj"
                onClose={() => {}}
            />,
        );
        const notShown = screen.getByTestId('whisper-diff-not-shown');
        expect(notShown).toHaveTextContent('Not shown');
        const items = screen.getAllByTestId('whisper-diff-not-shown-item');
        expect(items.map((i) => i.getAttribute('data-path'))).toEqual([
            '/home/u/proj/src/gone.ts',
            '/home/u/proj/src/codex.ts',
        ]);
        expect(notShown).toHaveTextContent('src/gone.ts — deleted');
        expect(notShown).toHaveTextContent('src/codex.ts — no diff available');
    });

    it('shows the no-diff message (not a blank body) when nothing is reconstructable', () => {
        render(
            <WhisperDiffPanel
                state={combinedState(combinedView({
                    sections: [],
                    fileCount: 1,
                    nonReconstructableFiles: [fileEdit('/home/u/proj/src/codex.ts')],
                }))}
                workspaceRootPath="/home/u/proj"
                onClose={() => {}}
            />,
        );
        expect(screen.getByTestId('whisper-diff-empty')).toHaveTextContent('No diff is available for these files.');
        expect(screen.queryByTestId('whisper-diff-section-viewer')).toBeNull();
        // The non-reconstructable file is still listed so the body is not blank.
        expect(screen.getByTestId('whisper-diff-not-shown')).toHaveTextContent('src/codex.ts');
    });

    it('omits the "not shown" section when every file reconstructed', () => {
        render(
            <WhisperDiffPanel
                state={combinedState(combinedView({ sections, fileCount: 2 }))}
                onClose={() => {}}
            />,
        );
        expect(screen.queryByTestId('whisper-diff-not-shown')).toBeNull();
    });

    it('stays read-only in combined mode — Close is the only button', () => {
        render(
            <WhisperDiffPanel
                state={combinedState(combinedView({
                    sections,
                    fileCount: 2,
                    deletedFiles: [fileEdit('/home/u/proj/src/gone.ts', { isDeleted: true })],
                }))}
                onClose={() => {}}
            />,
        );
        const panel = screen.getByTestId('whisper-diff-panel');
        expect(panel.querySelectorAll('button')).toHaveLength(1);
        expect(screen.queryByTestId('source-canvas-copy-btn')).toBeNull();
        expect(screen.queryByTestId('source-canvas-reveal-btn')).toBeNull();
    });
});
