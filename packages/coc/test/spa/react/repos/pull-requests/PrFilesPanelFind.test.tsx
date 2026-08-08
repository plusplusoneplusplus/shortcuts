/**
 * PrFilesPanel — in-diff Ctrl/Cmd+F find (AC-02).
 *
 * The PR "Files changed" inline diff panel had no find at all; this covers the
 * wiring that gives it the same widget FileDiffPanel and CommitDetail have:
 *   - Ctrl+F inside `pr-diff-panel-scroll` opens DiffFindWidget
 *   - Ctrl+F from outside the container stays inert (no preventDefault, so the
 *     desktop/browser native find bar still opens elsewhere in the app)
 *   - the match count is scoped to the *selected* file only
 *   - switching files resets find state — no stale highlights
 *   - next wraps, and Esc closes + clears highlights
 *
 * The real SideBySideDiffViewer is used (not mocked) so `matchRangesByLine`
 * actually has to reach it for the `<mark>` assertions to pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { PrFilesPanel } from '../../../../../src/server/spa/client/react/features/pull-requests/PrFilesPanel';
import { parseDiffFileList } from '../../../../../src/server/spa/client/react/features/git/diff';
import {
    MATCH_HIGHLIGHT_CLASS,
    ACTIVE_MATCH_HIGHLIGHT_CLASS,
} from '../../../../../src/server/spa/client/react/features/git/diff/diffFindModel';

vi.mock('../../../../../src/server/spa/client/react/shared/ModalJobAiControls', () => ({
    useModalJobAiSelection: () => ({ resolved: { provider: 'copilot' } }),
    isChatProvider: () => true,
    isSelectableProvider: () => true,
}));

// ── Fixture: "needle" occurs twice in one.ts and once (as "Needle") in two.ts ──

const diffText = [
    'diff --git a/one.ts b/one.ts',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -1,2 +1,2 @@',
    ' const needle = needle;',
    '+const other = 1;',
    'diff --git a/two.ts b/two.ts',
    '--- a/two.ts',
    '+++ b/two.ts',
    '@@ -1,1 +1,1 @@',
    '+const two = Needle;',
].join('\n');

const parsedFiles = parseDiffFileList(diffText);

/** Make the diff container report a truthy offsetParent (jsdom returns null). */
function makeVisible(el: HTMLElement) {
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => el.parentElement });
}

function findMarks(container: HTMLElement) {
    return Array.from(container.querySelectorAll('mark')).filter(m => {
        const cls = m.getAttribute('class') ?? '';
        return cls.includes(MATCH_HIGHLIGHT_CLASS) || cls.includes(ACTIVE_MATCH_HIGHLIGHT_CLASS);
    });
}

/** Fire Ctrl+F from `el` and report whether the default was prevented. */
function pressCtrlF(el: HTMLElement): boolean {
    const evt = new KeyboardEvent('keydown', {
        key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
    });
    act(() => { el.dispatchEvent(evt); });
    return evt.defaultPrevented;
}

function renderPanel() {
    return render(<PrFilesPanel files={parsedFiles} diffText={diffText} />);
}

function openFind() {
    const scroll = screen.getByTestId('pr-diff-panel-scroll');
    makeVisible(scroll);
    expect(pressCtrlF(scroll)).toBe(true);
    return scroll;
}

function selectFile(path: string) {
    const row = screen
        .getAllByTestId('pr-file-row')
        .find(el => (el.getAttribute('title') ?? el.textContent ?? '').includes(path));
    expect(row).toBeTruthy();
    fireEvent.click(row!);
}

beforeEach(() => {
    vi.clearAllMocks();
    if (!HTMLElement.prototype.scrollTo) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true, writable: true, value: () => {},
        });
    }
});
afterEach(cleanup);

describe('PrFilesPanel — Ctrl+F find widget', () => {
    it('opens the find widget on Ctrl+F inside the PR diff container', () => {
        renderPanel();
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
        openFind();
        expect(screen.getByTestId('diff-find-widget')).toBeTruthy();
    });

    it('stays inert when Ctrl+F fires outside the diff container', () => {
        renderPanel();
        makeVisible(screen.getByTestId('pr-diff-panel-scroll'));

        // The file-path filter input lives outside the diff scroll container.
        const outside = screen.getByTestId('pr-file-search');
        expect(pressCtrlF(outside)).toBe(false);
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
    });

    it('scopes the match count to the selected file only', () => {
        renderPanel();
        // one.ts is selected by default; "needle" appears twice there and once
        // in two.ts. The count must ignore the unselected file.
        expect(screen.getByTestId('pr-diff-panel-path').textContent).toContain('one.ts');
        openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 2');
    });

    it('highlights matches with exactly one active match', () => {
        const { container } = renderPanel();
        openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });

        // Split view renders a context line in BOTH columns, so each of the two
        // matches yields two <mark>s — and the single active match yields two.
        const marks = findMarks(container);
        expect(marks.length).toBe(4);
        expect(
            marks.filter(m => (m.getAttribute('class') ?? '').includes(ACTIVE_MATCH_HIGHLIGHT_CLASS)).length,
        ).toBe(2);
    });

    it('next wraps at the last match', () => {
        renderPanel();
        openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 2');

        fireEvent.click(screen.getByTestId('diff-find-next'));
        expect(screen.getByTestId('diff-find-count').textContent).toBe('2 of 2');
        fireEvent.click(screen.getByTestId('diff-find-next'));
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 2');
    });

    it('closes and clears highlights on Esc', () => {
        const { container } = renderPanel();
        const scroll = openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        expect(findMarks(container).length).toBeGreaterThan(0);

        fireEvent.keyDown(screen.getByTestId('diff-find-input'), { key: 'Escape' });
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
        expect(findMarks(container).length).toBe(0);
        expect(scroll).toBeTruthy();
    });

    it('resets find state when a different file is selected', () => {
        const { container } = renderPanel();
        openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        expect(findMarks(container).length).toBeGreaterThan(0);

        selectFile('two.ts');
        // Widget and highlights are gone — nothing carried over from one.ts.
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
        expect(findMarks(container).length).toBe(0);

        // Searching the newly selected file works and is scoped to it.
        openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 1');
    });
});
