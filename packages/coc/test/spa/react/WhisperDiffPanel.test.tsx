/**
 * Tests for WhisperDiffPanel — the converged read-only whisper diff panel
 * (AC-01/02/03).
 *
 * One panel with a header dropdown selector: `All files` renders the stacked
 * whole-group view (a divider + diff per reconstructable file, then a "Not
 * shown" list), and picking a single file narrows the body to that file's diff
 * and switches the subtitle to its project-relative path. Deleted /
 * non-reconstructable files are listed-but-disabled in the dropdown. The entry
 * point (`focusPath`) sets the initial selection. The heavy `UnifiedDiffViewer`
 * is stubbed so the test stays focused on the panel's selection behavior.
 */
/* @vitest-environment jsdom */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

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
import type { CombinedWhisperDiffSection } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/buildWhisperCombinedDiff';
import type { FileEdit } from '../../../src/server/spa/client/react/features/chat/conversation/tool-calls/toolGroupUtils';

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

function section(path: string, diff: string, over: Partial<FileEdit> = {}): CombinedWhisperDiffSection {
    return { file: fileEdit(path, over), diff };
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

function makeState(over: Partial<WhisperDiffState> = {}): WhisperDiffState {
    const view = over.view ?? combinedView();
    const hasDiff = view.sections.length > 0;
    return {
        status: hasDiff ? 'success' : 'empty',
        view,
        files: over.files ?? [],
        focusPath: over.focusPath,
        error: hasDiff ? '' : 'No diff is available for these files.',
        ...over,
    };
}

// A representative multi-file group: two reconstructable files, one deleted, one
// non-reconstructable (Codex-style), in group order.
const A = section('/home/u/proj/src/a.ts', 'diff --git a/src/a.ts b/src/a.ts\n+A', { netInsertions: 5, netDeletions: 2 });
const B = section('/home/u/proj/src/sub/b.ts', 'diff --git a/src/sub/b.ts b/src/sub/b.ts\n+B', { netInsertions: 3, netDeletions: 0 });
const GONE = fileEdit('/home/u/proj/src/gone.ts', { isDeleted: true, netInsertions: 0, netDeletions: 7 });
const CODEX = fileEdit('/home/u/proj/src/codex.ts', { netInsertions: 4, netDeletions: 1 });

function multiFileState(over: Partial<WhisperDiffState> = {}): WhisperDiffState {
    return makeState({
        view: combinedView({
            sections: [A, B],
            deletedFiles: [GONE],
            nonReconstructableFiles: [CODEX],
            fileCount: 4,
            totalInsertions: 7,
            totalDeletions: 3,
        }),
        files: [A.file, B.file, GONE, CODEX],
        ...over,
    });
}

function openMenu() {
    fireEvent.click(screen.getByTestId('whisper-diff-file-select'));
    return screen.getByTestId('whisper-diff-file-select-menu');
}

function optionByPath(path: string): HTMLElement {
    const opts = screen.getAllByTestId('whisper-diff-file-option');
    const found = opts.find((o) => o.getAttribute('data-path') === path);
    if (!found) throw new Error(`no dropdown option for ${path}`);
    return found;
}

describe('WhisperDiffPanel — header dropdown selector (AC-01)', () => {
    it('defaults to "All files" and shows the N-files totals on the same row', () => {
        render(<WhisperDiffPanel state={multiFileState()} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        const headerMain = screen.getByTestId('whisper-diff-header-main');
        const filename = screen.getByTestId('whisper-diff-filename');
        const totals = screen.getByTestId('whisper-diff-totals');
        expect(filename).toHaveTextContent('All files');
        expect(totals).toHaveTextContent('4 files (+7 −3)');
        expect(headerMain).toHaveClass('flex', 'items-center');
        expect(headerMain).toContainElement(filename);
        expect(headerMain).toContainElement(totals);
        expect(screen.queryByTestId('whisper-diff-path')).toBeNull();
    });

    it('lists "All files" plus every file in group order with +/- stats', () => {
        render(<WhisperDiffPanel state={multiFileState()} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        const menu = openMenu();
        const opts = within(menu).getAllByTestId('whisper-diff-file-option');
        expect(opts.map((o) => o.getAttribute('data-value'))).toEqual([
            '__all_files__',
            '/home/u/proj/src/a.ts',
            '/home/u/proj/src/sub/b.ts',
            '/home/u/proj/src/gone.ts',
            '/home/u/proj/src/codex.ts',
        ]);
        // Basenames + stats mirror the files-popover rows.
        expect(opts[1]).toHaveTextContent('a.ts');
        expect(opts[1]).toHaveTextContent('+5');
        expect(opts[1]).toHaveTextContent('−2');
        expect(opts[2]).toHaveTextContent('b.ts');
    });

    it('disables deleted and non-reconstructable entries; enables reconstructable ones', () => {
        render(<WhisperDiffPanel state={multiFileState()} onClose={() => {}} />);
        openMenu();
        expect(optionByPath('/home/u/proj/src/a.ts')).toHaveAttribute('data-disabled', 'false');
        expect(optionByPath('/home/u/proj/src/sub/b.ts')).toHaveAttribute('data-disabled', 'false');
        expect(optionByPath('/home/u/proj/src/gone.ts')).toHaveAttribute('data-disabled', 'true');
        expect(optionByPath('/home/u/proj/src/gone.ts')).toBeDisabled();
        expect(optionByPath('/home/u/proj/src/codex.ts')).toHaveAttribute('data-disabled', 'true');
        expect(optionByPath('/home/u/proj/src/codex.ts')).toBeDisabled();
    });

    it('still shows the dropdown for a single-file group (All files + that one file)', () => {
        const state = makeState({
            view: combinedView({ sections: [A], fileCount: 1, totalInsertions: 5, totalDeletions: 2 }),
            files: [A.file],
        });
        render(<WhisperDiffPanel state={state} onClose={() => {}} />);
        const menu = openMenu();
        const opts = within(menu).getAllByTestId('whisper-diff-file-option');
        expect(opts.map((o) => o.getAttribute('data-value'))).toEqual([
            '__all_files__',
            '/home/u/proj/src/a.ts',
        ]);
    });
});

describe('WhisperDiffPanel — All files body (AC-02)', () => {
    it('renders a divider + viewer per reconstructable section, in order', () => {
        render(<WhisperDiffPanel state={multiFileState()} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        const dividers = screen.getAllByTestId('whisper-diff-file-divider');
        expect(dividers.map((d) => d.textContent)).toEqual(['src/a.ts', 'src/sub/b.ts']);
        const viewers = screen.getAllByTestId('whisper-diff-section-viewer');
        expect(viewers).toHaveLength(2);
        expect(viewers[0]).toHaveTextContent('+A');
        expect(viewers[1]).toHaveTextContent('+B');
        expect(viewers[0]).toHaveAttribute('data-hide-file-headers', 'true');
    });

    it('lists deleted and non-reconstructable files under "Not shown"', () => {
        render(<WhisperDiffPanel state={multiFileState()} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
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
        const state = makeState({
            view: combinedView({
                sections: [],
                fileCount: 1,
                nonReconstructableFiles: [CODEX],
            }),
            files: [CODEX],
        });
        render(<WhisperDiffPanel state={state} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        expect(screen.getByTestId('whisper-diff-empty')).toHaveTextContent('No diff is available for these files.');
        expect(screen.queryByTestId('whisper-diff-section-viewer')).toBeNull();
        expect(screen.getByTestId('whisper-diff-not-shown')).toHaveTextContent('src/codex.ts');
    });

    it('omits the "Not shown" section when every file reconstructed', () => {
        const state = makeState({
            view: combinedView({ sections: [A, B], fileCount: 2 }),
            files: [A.file, B.file],
        });
        render(<WhisperDiffPanel state={state} onClose={() => {}} />);
        expect(screen.queryByTestId('whisper-diff-not-shown')).toBeNull();
    });
});

describe('WhisperDiffPanel — single-file selection (AC-02)', () => {
    it('renders only the selected file\'s diff and switches the subtitle to its path', () => {
        render(<WhisperDiffPanel state={multiFileState()} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        openMenu();
        fireEvent.click(optionByPath('/home/u/proj/src/sub/b.ts'));

        // Only the one file's diff — no stacked dividers / section viewers.
        const viewer = screen.getByTestId('whisper-diff-viewer');
        expect(viewer).toHaveTextContent('+B');
        expect(viewer).toHaveAttribute('data-file-name', 'b.ts');
        expect(screen.queryByTestId('whisper-diff-section-viewer')).toBeNull();
        expect(screen.queryByTestId('whisper-diff-file-divider')).toBeNull();
        expect(screen.queryByTestId('whisper-diff-not-shown')).toBeNull();

        // Subtitle now shows the project-relative path (full path in the title).
        const pathEl = screen.getByTestId('whisper-diff-path');
        expect(pathEl).toHaveTextContent('src/sub/b.ts');
        expect(pathEl).toHaveAttribute('title', '/home/u/proj/src/sub/b.ts');
        expect(screen.queryByTestId('whisper-diff-totals')).toBeNull();
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('b.ts');
    });

    it('returns to the stacked view when "All files" is picked again', () => {
        render(<WhisperDiffPanel state={multiFileState()} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        openMenu();
        fireEvent.click(optionByPath('/home/u/proj/src/a.ts'));
        expect(screen.getByTestId('whisper-diff-viewer')).toBeInTheDocument();

        openMenu();
        fireEvent.click(within(screen.getByTestId('whisper-diff-file-select-menu')).getAllByTestId('whisper-diff-file-option')[0]);
        // Back to the stack.
        expect(screen.getAllByTestId('whisper-diff-section-viewer')).toHaveLength(2);
        expect(screen.getByTestId('whisper-diff-totals')).toBeInTheDocument();
        expect(screen.queryByTestId('whisper-diff-viewer')).toBeNull();
    });

    it('does not select a disabled (deleted / non-reconstructable) entry', () => {
        render(<WhisperDiffPanel state={multiFileState()} onClose={() => {}} />);
        openMenu();
        fireEvent.click(optionByPath('/home/u/proj/src/codex.ts'));
        // Still on All files — the disabled click was a no-op.
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('All files');
    });
});

describe('WhisperDiffPanel — entry points + re-focus (AC-03)', () => {
    it('footer entry (no focusPath) opens on "All files"', () => {
        render(<WhisperDiffPanel state={multiFileState({ focusPath: undefined })} onClose={() => {}} />);
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('All files');
        expect(screen.getByTestId('whisper-diff-totals')).toBeInTheDocument();
    });

    it('file-row entry (focusPath set) opens focused on that file', () => {
        render(<WhisperDiffPanel state={multiFileState({ focusPath: '/home/u/proj/src/sub/b.ts' })} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('b.ts');
        expect(screen.getByTestId('whisper-diff-viewer')).toHaveTextContent('+B');
        expect(screen.getByTestId('whisper-diff-path')).toHaveTextContent('src/sub/b.ts');
    });

    it('a focus on a non-reconstructable file falls back to "All files"', () => {
        render(<WhisperDiffPanel state={multiFileState({ focusPath: '/home/u/proj/src/codex.ts' })} onClose={() => {}} />);
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('All files');
    });

    it('re-focus: a new context identity with a different focusPath updates the selection', () => {
        const { rerender } = render(
            <WhisperDiffPanel state={multiFileState({ focusPath: '/home/u/proj/src/a.ts' })} workspaceRootPath="/home/u/proj" onClose={() => {}} />,
        );
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('a.ts');
        // A fresh open() re-clicking a different row hands the panel a NEW state
        // object → the selection resets to the new focus.
        rerender(<WhisperDiffPanel state={multiFileState({ focusPath: '/home/u/proj/src/sub/b.ts' })} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('b.ts');
        expect(screen.getByTestId('whisper-diff-viewer')).toHaveTextContent('+B');
    });

    it('keeps a manual dropdown selection across re-renders with the SAME state', () => {
        const state = multiFileState();
        const { rerender } = render(<WhisperDiffPanel state={state} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        openMenu();
        fireEvent.click(optionByPath('/home/u/proj/src/a.ts'));
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('a.ts');
        // Re-rendering with the same state object must NOT reset the selection.
        rerender(<WhisperDiffPanel state={state} workspaceRootPath="/home/u/proj" onClose={() => {}} />);
        expect(screen.getByTestId('whisper-diff-filename')).toHaveTextContent('a.ts');
    });
});

describe('WhisperDiffPanel — read-only contract', () => {
    it('exposes no copy / reveal / comment / save affordances in either mode', () => {
        render(<WhisperDiffPanel state={multiFileState()} onClose={() => {}} />);
        for (const testId of [
            'source-canvas-copy-btn',
            'source-canvas-reveal-btn',
            'whisper-diff-copy-btn',
            'whisper-diff-comment-btn',
            'whisper-diff-save-btn',
        ]) {
            expect(screen.queryByTestId(testId)).toBeNull();
        }
        // Switch to a single file and re-check.
        openMenu();
        fireEvent.click(optionByPath('/home/u/proj/src/a.ts'));
        expect(screen.queryByTestId('source-canvas-copy-btn')).toBeNull();
    });

    it('invokes onClose from the close button', () => {
        const onClose = vi.fn();
        render(<WhisperDiffPanel state={multiFileState()} onClose={onClose} />);
        fireEvent.click(screen.getByTestId('whisper-diff-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
