/**
 * Tests for CommitDetail — commit info header rendering.
 *
 * Validates that the commit metadata header displays subject, author, date,
 * hash (with copy button), parents, and body when a commit prop is provided,
 * and is hidden when commit prop is absent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// --- Module mocks (hoisted by Vitest) ---

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useDiffComments', () => ({
    useDiffComments: () => ({
        comments: [],
        loading: false,
        error: null,
        isEphemeral: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),

        refresh: vi.fn(),
        runRelocation: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: () => Promise.resolve({ diff: '+added line\n context' }),
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

vi.mock('../../../../src/server/spa/client/react/features/git/diff/UnifiedDiffViewer', () => ({
    UnifiedDiffViewer: ({ 'data-testid': testId }: any) => (
        <div data-testid={testId ?? 'mock-diff-viewer'}>diff content</div>
    ),
    HunkNavButtons: () => null,
    parseDiffFileList: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/features/git/diff/useClassification', () => ({
    useClassification: () => ({
        state: { status: 'idle', activeFilters: new Set(), error: undefined, result: undefined },
        classify: vi.fn(),
        toggleFilter: vi.fn(),
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

vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: () => null,
}));

const mockCopyToClipboard = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: (...args: any[]) => mockCopyToClipboard(...args),
    formatRelativeTime: (d: string) => d,
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import { registerCloneBaseUrls, setActiveCloneForRouting } from '../../../../src/server/spa/client/react/repos/cloneRegistry';

const makeCommit = (overrides: Partial<GitCommitItem> = {}): GitCommitItem => ({
    hash: 'abc123def456abc123def456abc123def456abc1',
    shortHash: 'abc123d',
    subject: 'feat: add commit info header',
    author: 'Test Author',
    authorEmail: 'test@example.com',
    date: '2026-03-07T12:00:00Z',
    parentHashes: ['parent1abcdef1234567890abcdef1234567890ab'],
    body: 'This is the commit body\nwith multiple lines.',
    ...overrides,
});

describe('CommitDetail — commit info header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerCloneBaseUrls([]);
    });

    async function renderDetail(props: Record<string, unknown> = {}) {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" {...(props as any)} />);
        });
    }

    it('preserves mounted local and remote owners when opening a review', async () => {
        registerCloneBaseUrls([
            { workspaceId: 'ws1', cloneKey: 'remote:one:ws1', baseUrl: 'https://one.example' },
            { workspaceId: 'ws1', cloneKey: 'remote:two:ws1', baseUrl: 'https://two.example' },
        ]);
        setActiveCloneForRouting('remote:two:ws1');
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const result = render(<CommitDetail workspaceId="ws1" hash="abc123" attachmentDestinationId="remote:one:ws1" />);
        for (const [owner, baseUrl] of [
            ['remote:one:ws1', 'https://one.example'],
            ['remote:two:ws1', 'https://two.example'],
            ['ws1', null],
        ] as const) {
            result.rerender(<CommitDetail workspaceId="ws1" hash="abc123" attachmentDestinationId={owner} />);
            fireEvent.click(screen.getByTestId('commit-popout-btn'));
            const url = new URL(String(open.mock.calls.at(-1)![0]), 'https://dashboard.example');
            expect(url.searchParams.get('workspace')).toBe('ws1');
            expect(url.searchParams.get('sourceSelectionId')).toBe(owner);
            expect(url.searchParams.get('cloneBaseUrl')).toBe(baseUrl);
            expect(url.hash).toBe('#popout/git-review/abc123');
        }
        result.rerender(<CommitDetail workspaceId="ws1" hash="def456" attachmentDestinationId="remote:one:ws1" />);
        fireEvent.click(screen.getByTestId('commit-popout-btn'));
        expect(String(open.mock.calls.at(-1)![0])).toContain('#popout/git-review/def456');
        open.mockRestore();
    });

    it('does not render header when commit prop is absent', async () => {
        await renderDetail();
        expect(screen.queryByTestId('commit-info-header')).toBeNull();
    });

    it('renders header when commit prop is provided', async () => {
        await renderDetail({ commit: makeCommit() });
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
    });

    it('displays commit subject', async () => {
        await renderDetail({ commit: makeCommit({ subject: 'my fancy subject' }) });
        expect(screen.getByTestId('commit-info-subject').textContent).toBe('my fancy subject');
    });

    it('displays author name', async () => {
        await renderDetail({ commit: makeCommit({ author: 'Jane Doe' }) });
        const authorEl = screen.getByTestId('commit-info-author');
        expect(authorEl.textContent).toContain('Jane Doe');
    });

    it('displays author email when present', async () => {
        await renderDetail({ commit: makeCommit({ author: 'Jane', authorEmail: 'jane@test.com' }) });
        expect(screen.getByTestId('commit-info-email').textContent).toContain('<jane@test.com>');
    });

    it('hides author email when absent', async () => {
        await renderDetail({ commit: makeCommit({ authorEmail: undefined }) });
        expect(screen.queryByTestId('commit-info-email')).toBeNull();
    });

    it('displays formatted date', async () => {
        await renderDetail({ commit: makeCommit({ date: '2026-03-07T12:00:00Z' }) });
        const dateEl = screen.getByTestId('commit-info-date');
        expect(dateEl.textContent).toBeTruthy();
        expect(dateEl.textContent!.length).toBeGreaterThan(0);
    });

    it('displays short hash', async () => {
        await renderDetail({ commit: makeCommit({ hash: 'abc123def456789012345678901234567890abcd' }) });
        const hashEl = screen.getByTestId('commit-info-hash');
        expect(hashEl.textContent).toContain('abc123de');
    });

    it('copy button calls copyToClipboard with full hash', async () => {
        const commit = makeCommit({ hash: 'fullhash1234567890abcdef1234567890abcdef' });
        await renderDetail({ commit });
        const copyBtn = screen.getByTestId('commit-info-copy-hash');
        await act(async () => { fireEvent.click(copyBtn); });
        expect(mockCopyToClipboard).toHaveBeenCalledWith(commit.hash);
    });

    it('displays parent hashes', async () => {
        await renderDetail({ commit: makeCommit({ parentHashes: ['aaa1111222233334444555566667777888899990', 'bbb1111222233334444555566667777888899990'] }) });
        const parentsEl = screen.getByTestId('commit-info-parents');
        expect(parentsEl.textContent).toContain('aaa1111');
        expect(parentsEl.textContent).toContain('bbb1111');
    });

    it('keeps the SHA beside the title and secondary metadata below the author row', async () => {
        await renderDetail({ commit: makeCommit({ parentHashes: ['aaa1111222233334444555566667777888899990'] }) });
        const row = screen.getByTestId('commit-info-meta-row');
        expect(row.className).toContain('flex-wrap');
        expect(row.className).not.toContain('flex-col');
        for (const id of ['commit-info-author', 'commit-info-date']) {
            expect(screen.getByTestId(id).parentElement).toBe(row);
        }
        expect(screen.getByTestId('commit-info-title-row').contains(screen.getByTestId('commit-info-copy-hash'))).toBe(true);
        expect(screen.getByTestId('commit-info-details').contains(screen.getByTestId('commit-info-parents'))).toBe(true);
        expect(row.contains(screen.getByTestId('commit-info-email'))).toBe(false);
    });

    it('hides parents section when parentHashes is empty', async () => {
        await renderDetail({ commit: makeCommit({ parentHashes: [] }) });
        expect(screen.queryByTestId('commit-info-parents')).toBeNull();
    });

    it('displays commit body when present', async () => {
        await renderDetail({ commit: makeCommit({ body: 'Detailed description here' }) });
        const bodyEl = screen.getByTestId('commit-info-body');
        expect(bodyEl.textContent).toContain('Detailed description here');
    });

    it('hides body section when body is absent', async () => {
        await renderDetail({ commit: makeCommit({ body: undefined }) });
        expect(screen.queryByTestId('commit-info-body')).toBeNull();
    });

    it('still renders diff below the header', async () => {
        await renderDetail({ commit: makeCommit() });
        expect(screen.getByTestId('commit-info-header')).toBeTruthy();
        expect(screen.getByTestId('diff-section')).toBeTruthy();
    });

    it('header collapsible wrapper uses overflow auto when expanded so long bodies are scrollable', async () => {
        await renderDetail({ commit: makeCommit({ body: 'Line\n'.repeat(100) }) });
        const header = screen.getByTestId('commit-info-header');
        // Walk up to the animated wrapper (parent of the element that contains commit-info-header)
        const wrapper = header.closest('[style]') as HTMLElement;
        expect(wrapper).toBeTruthy();
        expect(wrapper.style.overflow).toBe('auto');
    });

    it('collapsed metadata is hidden and copy still works without expanding it', async () => {
        const commit = makeCommit();
        await renderDetail({ commit });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Hide commit details' })); });
        const header = screen.getByTestId('commit-info-header');
        expect(header.parentElement!.hidden).toBe(true);
        expect(screen.queryByRole('button', { name: 'Hide commit details' })).toBeNull();
        expect(screen.getByTestId('commit-info-summary').getAttribute('aria-expanded')).toBe('false');
        await act(async () => { fireEvent.click(screen.getByTestId('commit-summary-copy-hash')); });
        expect(mockCopyToClipboard).toHaveBeenCalledWith(commit.hash);
        expect(screen.getByTestId('commit-info-summary')).toBeTruthy();
    });

    it('omits the secondary metadata divider when there are no details', async () => {
        await renderDetail({ commit: makeCommit({ authorEmail: undefined, parentHashes: [], body: undefined }) });
        expect(screen.queryByTestId('commit-info-details')).toBeNull();
    });
});
