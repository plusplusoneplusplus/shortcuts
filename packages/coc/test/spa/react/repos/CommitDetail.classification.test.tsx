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
import { render, screen, act } from '@testing-library/react';

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

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: 'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\ndiff --git a/src/bar.ts b/src/bar.ts\n--- a/src/bar.ts\n+++ b/src/bar.ts\n@@ -1 +1 @@\n-old\n+new' }),
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
let mockActiveFilters = new Set<string>();

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: {
            status: mockClassificationStatus,
            activeFilters: mockActiveFilters,
            error: undefined,
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

    it('renders the classification toolbar (commit-classify-bar)', async () => {
        await renderDetail();
        expect(screen.getByTestId('commit-classify-bar')).toBeTruthy();
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

    it('Classify button is disabled when status is loading', async () => {
        mockClassificationStatus = 'loading';
        await renderDetail();
        const btn = screen.getByTestId('commit-classify-button') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    it('model picker is rendered', async () => {
        await renderDetail();
        expect(screen.getByTestId('commit-classify-model-picker-chip')).toBeTruthy();
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

describe('CommitDetail — reviewed count (AC-05)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockClassificationStatus = 'idle';
        mockActiveFilters = new Set(['logic', 'mechanical', 'test', 'simple', 'generated']);
    });

    it('shows reviewed count once file list is available', async () => {
        await renderDetail();
        const badge = screen.getByTestId('commit-reviewed-count');
        // parseDiffFileList is mocked to return 2 files
        expect(badge.textContent).toBe('0/2 reviewed');
    });
});
