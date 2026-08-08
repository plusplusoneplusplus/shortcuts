/**
 * CommitDetail — in-diff Ctrl/Cmd+F find (AC-01).
 *
 * CommitDetail's right-side commit diff had no find at all; this covers the
 * wiring that gives it the same widget FileDiffPanel already has:
 *   - Ctrl+F inside the commit diff scroll container opens DiffFindWidget
 *   - Ctrl+F from outside the container stays inert (no preventDefault, so the
 *     desktop/browser native find bar still opens elsewhere in the app)
 *   - typing a query counts matches across the whole commit diff model
 *   - next wraps at the end
 *   - Esc closes the widget and clears highlights
 *   - split view mode has the same behaviour
 *
 * The real diff viewers are used (not mocked) so `matchRangesByLine` actually
 * has to reach them for the `<mark>` assertions to pass.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

// ── Fixture diff: "needle" appears 3 times across two files ──
const COMMIT_DIFF = [
    'diff --git a/one.ts b/one.ts',
    'index 1111111..2222222 100644',
    '--- a/one.ts',
    '+++ b/one.ts',
    '@@ -1,2 +1,2 @@',
    ' const needle = needle;',
    '+const other = 1;',
    'diff --git a/two.ts b/two.ts',
    'index 3333333..4444444 100644',
    '--- a/two.ts',
    '+++ b/two.ts',
    '@@ -1,1 +1,1 @@',
    '+const two = Needle;',
].join('\n');

vi.mock('../../../src/server/spa/client/react/features/git/hooks/useCommitDiffCache', () => ({
    useCachedDiff: () => ({ diff: COMMIT_DIFF, loading: false, error: null, retry: vi.fn() }),
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/features/git/hooks/useAllCommitComments', () => ({
    useAllCommitComments: () => ({
        comments: [], loading: false,
        resolveComment: vi.fn(), unresolveComment: vi.fn(), deleteComment: vi.fn(),
        updateComment: vi.fn(), copyAllCommentsAsPrompt: vi.fn(),
        resolveWithAI: vi.fn(), fixWithAI: vi.fn(),
        aiLoadingIds: new Set(), aiErrors: new Map(), clearAiError: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: { status: 'idle', activeFilters: new Set(), error: undefined, result: undefined },
        classify: vi.fn(), toggleFilter: vi.fn(), setFilters: vi.fn(),
        isFileDimmed: () => false, getFileBadge: () => undefined, getHunkClassification: () => null,
        provider: 'copilot', setProvider: vi.fn(), model: undefined, setModel: vi.fn(),
    }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({
        providers: [], loading: false, error: null, reload: vi.fn(),
        copilot: undefined, codex: undefined,
    }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

vi.mock('../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: () => null,
}));

vi.mock('../../../src/server/spa/client/react/repos/cloneRegistry', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        getCocClientForWorkspace: () => ({
            git: { commitDiffPath: () => '/api/diff' },
            preferences: {
                getRepo: () => Promise.resolve({}),
                setRepo: () => Promise.resolve({}),
            },
        }),
        lookupCloneBaseUrl: () => undefined,
    };
});

import { CommitDetail } from '../../../src/server/spa/client/react/features/git/commits/CommitDetail';
import {
    MATCH_HIGHLIGHT_CLASS,
    ACTIVE_MATCH_HIGHLIGHT_CLASS,
} from '../../../src/server/spa/client/react/features/git/diff/diffFindModel';

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

async function renderDetail() {
    let utils: ReturnType<typeof render>;
    await act(async () => {
        utils = render(<CommitDetail workspaceId="ws1" hash="abc123" />);
    });
    return utils!;
}

/** Fire Ctrl+F from `el` and report whether the default was prevented. */
function pressCtrlF(el: HTMLElement): boolean {
    const evt = new KeyboardEvent('keydown', {
        key: 'f', ctrlKey: true, bubbles: true, cancelable: true,
    });
    act(() => { el.dispatchEvent(evt); });
    return evt.defaultPrevented;
}

async function openFind() {
    const section = screen.getByTestId('diff-section');
    makeVisible(section);
    expect(pressCtrlF(section)).toBe(true);
    return section;
}

beforeEach(() => {
    vi.clearAllMocks();
    if (!HTMLElement.prototype.scrollTo) {
        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true, writable: true, value: () => {},
        });
    }
    localStorage.clear();
});
afterEach(cleanup);

describe('CommitDetail — Ctrl+F find widget', () => {
    it('opens the find widget on Ctrl+F inside the commit diff container', async () => {
        await renderDetail();
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
        await openFind();
        expect(screen.getByTestId('diff-find-widget')).toBeTruthy();
    });

    it('stays inert when Ctrl+F fires outside the diff container', async () => {
        await renderDetail();
        const section = screen.getByTestId('diff-section');
        makeVisible(section);

        // The classification toolbar lives outside the diff scroll container.
        const outside = screen.getByTestId('commit-classify-bar');
        expect(pressCtrlF(outside)).toBe(false);
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
    });

    it('counts matches across the whole commit diff model', async () => {
        await renderDetail();
        await openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        // 2 on one.ts's context line + 1 "Needle" on two.ts (case-insensitive).
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 3');
    });

    it('highlights matches with exactly one active match', async () => {
        const { container } = await renderDetail();
        await openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });

        const marks = findMarks(container);
        expect(marks.length).toBe(3);
        expect(
            marks.filter(m => (m.getAttribute('class') ?? '').includes(ACTIVE_MATCH_HIGHLIGHT_CLASS)).length,
        ).toBe(1);
    });

    it('next wraps at the last match', async () => {
        await renderDetail();
        await openFind();
        const input = screen.getByTestId('diff-find-input');
        fireEvent.change(input, { target: { value: 'needle' } });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 3');

        fireEvent.click(screen.getByTestId('diff-find-next'));
        expect(screen.getByTestId('diff-find-count').textContent).toBe('2 of 3');
        fireEvent.click(screen.getByTestId('diff-find-next'));
        expect(screen.getByTestId('diff-find-count').textContent).toBe('3 of 3');
        fireEvent.click(screen.getByTestId('diff-find-next'));
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 3');
    });

    it('the case toggle recomputes the match set', async () => {
        await renderDetail();
        await openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'Needle' } });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 3');

        fireEvent.click(screen.getByTestId('diff-find-case-toggle'));
        // Only two.ts's capital-N "Needle" survives.
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 1');
    });

    it('Esc closes the widget and clears the highlights', async () => {
        const { container } = await renderDetail();
        await openFind();
        const input = screen.getByTestId('diff-find-input');
        fireEvent.change(input, { target: { value: 'needle' } });
        expect(findMarks(container).length).toBe(3);

        fireEvent.keyDown(input, { key: 'Escape' });
        expect(screen.queryByTestId('diff-find-widget')).toBeNull();
        expect(findMarks(container).length).toBe(0);
    });

    it('works in split view mode', async () => {
        const { container } = await renderDetail();
        // DiffViewToggle persists the mode; flip to split.
        await act(async () => { fireEvent.click(screen.getByTestId('diff-view-toggle-split')); });

        await openFind();
        fireEvent.change(screen.getByTestId('diff-find-input'), { target: { value: 'needle' } });
        expect(screen.getByTestId('diff-find-count').textContent).toBe('1 of 3');
        expect(findMarks(container).length).toBeGreaterThanOrEqual(3);
    });
});
