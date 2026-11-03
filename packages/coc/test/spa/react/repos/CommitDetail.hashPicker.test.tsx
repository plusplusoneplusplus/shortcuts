/**
 * CommitDetail — header hash switcher wiring: owner-scoped SHA lookup, the
 * lookup feature gate, and the copy action staying independent of the switcher.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitReviewFiles', () => ({
    useCommitReviewFiles: () => ({ files: [], loading: false, retry: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/GitFileReview', async () => {
    // Render the real single-row toolbar so header slots stay observable.
    const { GitReviewToolbar } = await vi.importActual<typeof import('../../../../src/server/spa/client/react/features/git/diff/GitReviewToolbar')>('../../../../src/server/spa/client/react/features/git/diff/GitReviewToolbar');
    return { GitFileReview: (props: any) => <div data-testid="git-file-review"><GitReviewToolbar header={props.header} /></div> };
});

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
import { registerCloneBaseUrls } from '../../../../src/server/spa/client/react/repos/cloneRegistry';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

const commit: GitCommitItem = {
    hash: '1da3ade1f00000000000000000000000000000aa', shortHash: '1da3ade', subject: 'test(coc): widen waits',
    author: 'A', date: '2026-11-01T00:00:00Z', parentHashes: [],
};
const lookedUp = {
    hash: 'feedface00000000000000000000000000000000', shortHash: 'feedfac', subject: 'older commit',
    author: 'B', date: '2026-10-01T00:00:00Z', parentHashes: ['p'], body: 'body',
};

/** Answers the single-commit route with `lookedUp`; every other request gets an empty body. */
function stubFetch() {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        const body = /\/git\/commits\/[0-9a-f]+$/.test(url) ? lookedUp : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
}
const commitRequests = (fetchSpy: ReturnType<typeof stubFetch>) => fetchSpy.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter(url => url.includes('/git/commits/feedface'));

describe('CommitDetail — commit hash switcher', () => {
    afterAll(() => _resetRuntimeConfig());
    afterEach(() => vi.restoreAllMocks());

    beforeEach(() => {
        vi.clearAllMocks();
        registerCloneBaseUrls([]);
        _resetRuntimeConfig();
        applyRuntimeConfigPatch({ gitCommitLookupEnabled: true });
    });

    function renderDetail(props: Record<string, unknown>) {
        render(<CommitDetail workspaceId="member" hash={commit.hash} commit={commit} {...(props as any)} />);
    }
    async function submitSha(value: string) {
        await act(async () => { fireEvent.click(screen.getByTestId('commit-hash-picker-trigger')); });
        await act(async () => { fireEvent.change(screen.getByTestId('commit-hash-picker-input'), { target: { value } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('commit-hash-picker-submit')); });
    }

    it('keeps the plain copy control when the host offers no switcher', () => {
        renderDetail({});
        expect(screen.queryByTestId('commit-hash-picker-trigger')).toBeNull();
        expect(screen.getByTestId('commit-summary-copy-hash').textContent).toContain('1da3ade1');
    });

    it('keeps copy independent of the hash switcher', async () => {
        renderDetail({ commitPicker: { commits: [commit], onSelect: vi.fn() } });
        const copy = screen.getByTestId('commit-summary-copy-hash');
        expect(copy.textContent).not.toContain('1da3ade1');
        expect(copy.getAttribute('aria-label')).toBe('Copy commit hash 1da3ade1');
        expect(copy.contains(screen.getByTestId('commit-hash-picker-trigger'))).toBe(false);
        await act(async () => { fireEvent.click(copy); });
        expect(mockCopyToClipboard).toHaveBeenCalledWith(commit.hash);
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
    });

    it('looks up the data member on the owning remote clone and opens the result', async () => {
        registerCloneBaseUrls([{ workspaceId: 'member', cloneKey: 'remote:one:member', baseUrl: 'https://one.example' }]);
        const fetchSpy = stubFetch();
        const onSelect = vi.fn();
        renderDetail({ attachmentDestinationId: 'remote:one:member', commitPicker: { commits: [commit], onSelect } });
        await submitSha('FEEDFACE');
        const requests = commitRequests(fetchSpy);
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatch(/^https:\/\/one\.example\/api\/workspaces\/member\/git\/commits\/feedface$/);
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ hash: lookedUp.hash, subject: 'older commit', body: 'body' }));
    });

    it('looks up a self-owned review on the local server', async () => {
        const fetchSpy = stubFetch();
        const onSelect = vi.fn();
        renderDetail({ commitPicker: { commits: [commit], onSelect } });
        await submitSha('feedface');
        const requests = commitRequests(fetchSpy);
        expect(requests).toHaveLength(1);
        expect(requests[0]).not.toContain('one.example');
        expect(requests[0]).toMatch(/\/api\/workspaces\/member\/git\/commits\/feedface$/);
        expect(onSelect).toHaveBeenCalledOnce();
    });

    it('does not reach the server when direct SHA lookup is off', async () => {
        applyRuntimeConfigPatch({ gitCommitLookupEnabled: false });
        const fetchSpy = stubFetch();
        renderDetail({ commitPicker: { commits: [commit], onSelect: vi.fn() } });
        await submitSha('feedface');
        expect(commitRequests(fetchSpy)).toHaveLength(0);
        expect(screen.getByTestId('commit-hash-picker-error').textContent).toBe('No recent commit matches this SHA');
    });
});
