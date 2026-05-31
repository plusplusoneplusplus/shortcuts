/**
 * Tests for CommitDetail — CommitChatPanel integration.
 *
 * Covers:
 *   - 🤖 toggle button presence in file-level and commit-level toolbars
 *   - Chat panel hidden by default, toggle open/close
 *   - Chat panel and CommentSidebar co-existence
 *   - Correct props passed to CommitChatPanel
 *   - localStorage persistence of chat state
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

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useAllCommitComments', () => ({
    useAllCommitComments: () => ({
        comments: [],
        loading: false,
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        deleteComment: vi.fn(),
        updateComment: vi.fn(),
        copyAllCommentsAsPrompt: vi.fn(),
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

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/CommentSidebar', () => ({
    CommentSidebar: (props: any) => <div data-testid={props['data-testid'] ?? 'comment-sidebar'} />,
}));

let mockChatPanelProps: Record<string, unknown> | null = null;
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({
    CommitChatPanel: (props: any) => {
        mockChatPanelProps = props;
        return (
            <div
                data-testid="commit-chat-panel"
                data-workspace-id={props.workspaceId}
                data-commit-hash={props.commitHash}
                data-commit-message={props.commitMessage ?? ''}
            />
        );
    },
}));

import { CommitDetail } from '../../../../src/server/spa/client/react/features/git/commits/CommitDetail';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';

const makeCommit = (overrides: Partial<GitCommitItem> = {}): GitCommitItem => ({
    hash: 'abc123def456abc123def456abc123def456abc1',
    shortHash: 'abc123d',
    subject: 'feat: add chat panel',
    author: 'Test Author',
    authorEmail: 'test@example.com',
    date: '2026-03-07T12:00:00Z',
    parentHashes: ['parent1abcdef1234567890abcdef1234567890ab'],
    body: '',
    ...overrides,
});

describe('CommitDetail — chat panel integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockChatPanelProps = null;
        localStorage.clear();
    });

    async function renderDetail(props: Record<string, unknown> = {}) {
        await act(async () => {
            render(<CommitDetail workspaceId="ws1" hash="abc123" {...(props as any)} />);
        });
    }

    // 1. Toggle button present in commit-level toolbar
    it('renders 🤖 toggle button in commit-level toolbar', async () => {
        await renderDetail();
        expect(screen.getByTestId('toggle-chat-btn')).toBeTruthy();
    });

    // 3. Chat panel hidden by default
    it('does not show chat panel by default', async () => {
        await renderDetail();
        expect(screen.queryByTestId('commit-chat-panel')).toBeNull();
    });

    // 4. Clicking 🤖 shows CommitChatPanel
    it('clicking 🤖 shows CommitChatPanel', async () => {
        await renderDetail();
        await act(async () => { fireEvent.click(screen.getByTestId('toggle-chat-btn')); });
        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();
    });

    // 5. Clicking 🤖 again hides CommitChatPanel
    it('clicking 🤖 again hides CommitChatPanel', async () => {
        await renderDetail();
        const btn = screen.getByTestId('toggle-chat-btn');
        await act(async () => { fireEvent.click(btn); });
        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();
        await act(async () => { fireEvent.click(btn); });
        expect(screen.queryByTestId('commit-chat-panel')).toBeNull();
    });

    // 6. Chat panel and CommentSidebar can be open simultaneously
    it('chat panel and comment sidebar can both be open', async () => {
        await renderDetail({ filePath: 'src/foo.ts' });
        await act(async () => { fireEvent.click(screen.getByTestId('toggle-comments-btn')); });
        await act(async () => { fireEvent.click(screen.getByTestId('toggle-chat-btn')); });
        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();
        expect(screen.getByTestId('diff-comment-sidebar')).toBeTruthy();
    });

    // 7. CommitChatPanel receives correct props
    it('passes correct props to CommitChatPanel', async () => {
        await renderDetail({ commit: makeCommit({ subject: 'fix: something' }) });
        await act(async () => { fireEvent.click(screen.getByTestId('toggle-chat-btn')); });
        const panel = screen.getByTestId('commit-chat-panel');
        expect(panel.getAttribute('data-workspace-id')).toBe('ws1');
        expect(panel.getAttribute('data-commit-hash')).toBe('abc123');
        expect(panel.getAttribute('data-commit-message')).toBe('fix: something');
        expect(mockChatPanelProps).toHaveProperty('onClose');
        expect(typeof mockChatPanelProps!.onClose).toBe('function');
    });

    // 8. Chat state persists to localStorage
    it('persists chat open state to localStorage', async () => {
        await renderDetail();
        const btn = screen.getByTestId('toggle-chat-btn');
        await act(async () => { fireEvent.click(btn); });
        expect(localStorage.getItem('coc.commitChat.open')).toBe('true');
        await act(async () => { fireEvent.click(btn); });
        expect(localStorage.getItem('coc.commitChat.open')).toBe('false');
    });

    // 9. Chat state initializes from localStorage
    it('initializes chat open state from localStorage', async () => {
        localStorage.setItem('coc.commitChat.open', 'true');
        await renderDetail();
        expect(screen.getByTestId('commit-chat-panel')).toBeTruthy();
    });
});
