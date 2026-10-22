/**
 * Tests for CommitDetail — classification toolbar, filter bar, and
 * session-local review-progress features (AC-05).
 *
 * Validates that the embedded CommitDetail:
 *   - Renders the classification toolbar with Classify button
 *   - Shows the reviewed count badge
 *   - Reveals the filter bar once classification is 'ready'
 *   - Shows next/prev priority buttons when classification is ready
 *   - Reviewed count updates when review progress advances
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useAllCommitComments', () => ({
    useAllCommitComments: () => ({
        comments: [],
        loading: false,
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        deleteComment: vi.fn(),
        updateComment: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(),
        resolveWithAI: vi.fn(),
        fixWithAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
    }),
}));

const TWO_FILE_DIFF = {
    diff: 'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/src/bar.ts b/src/bar.ts\n--- a/src/bar.ts\n+++ b/src/bar.ts\n@@ -1 +1 @@\n-old\n+new',
};

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve(TWO_FILE_DIFF),
}));

// AC-07: CommitDetail's diff is now fetched through useCachedDiff →
// requestForWorkspace (cloneRegistry → getCocClientFor + stub.request), so the
// commit diff must come from the routed client, not just fetchApi. The
// commitDiffPath builder stays pure.
const cocStub = {
    git: {
        commitDiffPath: (workspaceId: string, hash: string) =>
            `/workspaces/${encodeURIComponent(workspaceId)}/git/commits/${hash}/diff`,
    },
    preferences: {
        getRepo: vi.fn().mockResolvedValue({}),
        patchRepo: vi.fn().mockResolvedValue({}),
    },
    agentProviders: {
        getReasoningEfforts: vi.fn().mockResolvedValue({ reasoningEfforts: {} }),
        getEffortTiers: vi.fn().mockResolvedValue({ effortTiers: {}, defaults: {} }),
    },
    request: () => Promise.resolve(TWO_FILE_DIFF),
};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => cocStub,
    getCocClientFor: () => cocStub,
    toSpaCocRequestOptions: (opts?: unknown) => opts,
    translateSpaCocClientError: (e: unknown) => { throw e; },
}));

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { dialogLaunchMode: 'default', dialogMode: 'task' }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitReviewFiles', () => ({
    useCommitReviewFiles: () => ({ files: MOCK_FILES, loading: false, retry: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/GitFileReview', async () => {
    // Render the real single-row toolbar so header slots stay observable.
    const { GitReviewToolbar } = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/git/diff/GitReviewToolbar')>('../../../../src/server/spa/client/react/features/git/diff/GitReviewToolbar');
    return { GitFileReview: (props: any) => <div data-testid="git-file-review"><GitReviewToolbar header={props.header} /></div> };
});

// Stub UnifiedDiffViewer with parseDiffFileList returning a predictable list
const MOCK_FILES = [
    { path: 'src/foo.ts', status: 'M', additions: 1, deletions: 1 },
    { path: 'src/bar.ts', status: 'M', additions: 1, deletions: 1 },
];

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'}>diff content</div>
    ),
    HunkNavButtons: () => null,
    parseDiffFileList: () => MOCK_FILES,
}));

// Controllable classification mock
const mockClassify = vi.fn();
const mockToggleFilter = vi.fn();
let mockClassificationStatus = 'idle';
let mockClassificationError: string | undefined;
beforeEach(() => { mockClassificationError = undefined; });
let mockActiveFilters = new Set<string>();

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: {
            status: mockClassificationStatus,
            activeFilters: mockActiveFilters,
            error: mockClassificationError,
            result: undefined,
        },
        classify: mockClassify,
        toggleFilter: mockToggleFilter,
        setFilters: vi.fn(),
        isFileDimmed: () => false,
        getFileBadge: () => undefined,
        getHunkClassification: () => null,
        provider: 'copilot',
        setProvider: vi.fn(),
        model: undefined,
        setModel: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useAgentProviders', () => ({
    useAgentProviders: () => ({
        providers: [{ id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true }],
        loading: false,
        error: null,
        reload: vi.fn(),
        copilot: { id: 'copilot', label: 'Copilot', enabled: true, available: true, locked: true },
        codex: undefined,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useModels', () => ({
    useModels: () => ({ models: [], loading: false, error: null, reload: vi.fn() }),
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderDetail(props: Record<string, unknown> = {}) {
    await act(async () => {
        render(<CommitDetail workspaceId="ws1" hash="abc1234" {...(props as any)} />);
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CommitDetail — classification toolbar (AC-05)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClassificationStatus = 'idle';
        mockActiveFilters = new Set(['logic', 'mechanical', 'test', 'simple', 'generated']);
    });

    it('renders Classify as a split button inside the single review toolbar', async () => {
        await renderDetail();
        const toolbar = screen.getByTestId('git-review-toolbar');
        expect(screen.getAllByTestId('git-review-toolbar')).toHaveLength(1);
        expect(toolbar.contains(screen.getByTestId('commit-classify-split'))).toBe(true);
        expect(screen.getByTestId('commit-classify-button').getAttribute('aria-label')).toBe('Classify');
        expect(screen.getByTestId('commit-classify-settings-toggle').getAttribute('aria-haspopup')).toBe('dialog');
    });

    it('renders the Classify button when status is idle', async () => {
        await renderDetail();
        const btn = screen.getByTestId('commit-classify-button');
        expect(btn.textContent).toBe('Classify');
    });

    it('renders Re-classify button when classification is ready', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        const btn = screen.getByTestId('commit-classify-button');
        expect(btn.textContent).toBe('Re-classify');
    });

    it('shows classification failures outside the control groups without opening settings', async () => {
        mockClassificationError = 'Could not classify the diff. Try again.';
        await renderDetail();
        const error = screen.getByRole('alert');
        expect(error.textContent).toBe(mockClassificationError);
        expect(screen.getByTestId('git-review-toolbar').contains(error)).toBe(false);
        expect(screen.queryByTestId('commit-classify-settings')).toBeNull();
    });

    it('Classify button is disabled when status is loading', async () => {
        mockClassificationStatus = 'loading';
        await renderDetail();
        const btn = screen.getByTestId('commit-classify-button') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('reveals the existing model picker through an accessible settings toggle', async () => {
        await renderDetail();
        const toggle = screen.getByRole('button', { name: 'Classification settings' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('commit-classify-model-picker-chip')).toBeNull();
        await act(async () => { fireEvent.click(toggle); });
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('commit-classify-settings').id).toBe(toggle.getAttribute('aria-controls'));
        expect(screen.getByTestId('commit-classify-model-picker-chip')).toBeTruthy();
        await act(async () => { fireEvent.click(toggle); });
        expect(screen.queryByTestId('commit-classify-settings')).toBeNull();
    });

    it('keeps AI settings disabled while classification is running', async () => {
        mockClassificationStatus = 'loading';
        await renderDetail();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Classification settings' })); });
        expect((screen.getByTestId('commit-classify-model-picker-chip') as HTMLButtonElement).disabled).toBe(true);
    });

    it('still runs classification from the primary button', async () => {
        await renderDetail();
        await act(async () => { fireEvent.click(screen.getByTestId('commit-classify-button')); });
        expect(mockClassify).toHaveBeenCalledOnce();
    });

    it('names icon actions and reports the comments panel state', async () => {
        await renderDetail();
        const comments = screen.getByRole('button', { name: 'All comments in this commit' });
        expect(comments.getAttribute('aria-pressed')).toBe('false');
        await act(async () => { fireEvent.click(comments); });
        expect(comments.getAttribute('aria-pressed')).toBe('true');
        for (const name of ['All comments in this commit', 'Toggle AI chat', 'Open in new window']) {
            expect(screen.getByRole('button', { name }).querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
        }
    });

    it('resets settings when changing workspace even if the commit hash is the same', async () => {
        let view: ReturnType<typeof render>;
        await act(async () => { view = render(<CommitDetail workspaceId="ws1" hash="abc1234" />); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Classification settings' })); });
        await act(async () => { view!.rerender(<CommitDetail workspaceId="ws2" hash="abc1234" />); });
        expect(screen.queryByTestId('commit-classify-settings')).toBeNull();
    });

    it('keeps every commit control in one toolbar row', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        const toolbar = screen.getByTestId('git-review-toolbar');
        for (const id of ['commit-classify-button', 'commit-classify-settings-toggle', 'commit-prev-priority-btn', 'commit-next-priority-btn', 'toggle-comments-btn', 'toggle-chat-btn', 'commit-popout-btn', 'git-review-more']) {
            expect(toolbar.contains(screen.getByTestId(id))).toBe(true);
        }
        expect(screen.getByTestId('git-review-header').contains(screen.getByTestId('commit-filter-bar'))).toBe(true);
        expect(toolbar.contains(screen.getByTestId('commit-filter-bar'))).toBe(false);
    });

    it('compacts labels and moves secondary actions to an accessible overflow menu', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        expect(screen.getByTestId('commit-classify-button').querySelector('span:last-child')!.className).toContain('git-review-md');
        expect(screen.getByTestId('commit-classify-summary').className).toContain('git-review-wide');
        expect(screen.getByTestId('commit-classify-summary').textContent).toBe('Copilot · Default model');
        const ids = ['commit-prev-priority-btn', 'commit-next-priority-btn', 'toggle-comments-btn', 'toggle-chat-btn', 'commit-popout-btn'];
        for (const id of ids) expect(screen.getByTestId(id).className).toContain('git-review-wide');
        const more = screen.getByTestId('git-review-more');
        // Nothing is overflow-only for commits, so the menu trigger hides in wide panes.
        expect(more.className).toContain('git-review-collapsible');
        await act(async () => { fireEvent.click(more); });
        expect(more.getAttribute('aria-expanded')).toBe('true');
        const menu = screen.getByRole('menu', { name: 'More review actions' });
        for (const id of ids) expect(menu.contains(screen.getByTestId(`${id}-menu-item`))).toBe(true);
        expect(screen.getByTestId('toggle-comments-btn-menu-item').getAttribute('role')).toBe('menuitemcheckbox');
        expect(document.activeElement).toBe(screen.getByTestId('commit-prev-priority-btn-menu-item'));
        await act(async () => { fireEvent.click(screen.getByTestId('toggle-comments-btn-menu-item')); });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(screen.getByTestId('toggle-comments-btn').getAttribute('aria-pressed')).toBe('true');
        await act(async () => { fireEvent.click(more); });
        await act(async () => { fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' }); });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(document.activeElement).toBe(more);
    });

    it('names priority navigation icons accessibly', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        for (const [id, name] of [['commit-prev-priority-btn', 'Previous priority file'], ['commit-next-priority-btn', 'Next priority file']]) {
            const btn = screen.getByTestId(id);
            expect(btn.getAttribute('aria-label')).toBe(name);
            expect(btn.getAttribute('title')).toBe(name);
        }
    });

    it('closes classification settings on Escape and returns focus to the caret', async () => {
        await renderDetail();
        const toggle = screen.getByTestId('commit-classify-settings-toggle');
        await act(async () => { fireEvent.click(toggle); });
        await act(async () => { fireEvent.keyDown(screen.getByRole('dialog', { name: 'Classification settings' }), { key: 'Escape' }); });
        expect(screen.queryByTestId('commit-classify-settings')).toBeNull();
        expect(document.activeElement).toBe(toggle);
    });
});

describe('CommitDetail — classification filter bar (AC-05)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClassificationStatus = 'idle';
        mockActiveFilters = new Set(['logic', 'mechanical', 'test', 'simple', 'generated']);
    });

    it('does NOT render filter bar when classification is idle', async () => {
        await renderDetail();
        expect(screen.queryByTestId('commit-filter-bar')).toBeNull();
    });

    it('renders filter bar when classification is ready', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        expect(screen.getByTestId('commit-filter-bar')).toBeTruthy();
    });

    it('renders a checkbox for each category when ready', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        expect(screen.getByTestId('commit-filter-logic')).toBeTruthy();
        expect(screen.getByTestId('commit-filter-mechanical')).toBeTruthy();
        expect(screen.getByTestId('commit-filter-test')).toBeTruthy();
        expect(screen.getByTestId('commit-filter-simple')).toBeTruthy();
        expect(screen.getByTestId('commit-filter-generated')).toBeTruthy();
    });
});

describe('CommitDetail — priority navigation buttons (AC-05)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClassificationStatus = 'idle';
        mockActiveFilters = new Set(['logic', 'mechanical', 'test', 'simple', 'generated']);
    });

    it('does NOT render prev/next buttons when classification is idle', async () => {
        await renderDetail();
        expect(screen.queryByTestId('commit-prev-priority-btn')).toBeNull();
        expect(screen.queryByTestId('commit-next-priority-btn')).toBeNull();
    });

    it('renders prev/next buttons when classification is ready', async () => {
        mockClassificationStatus = 'ready';
        await renderDetail();
        expect(screen.getByTestId('commit-prev-priority-btn')).toBeTruthy();
        expect(screen.getByTestId('commit-next-priority-btn')).toBeTruthy();
    });
});
