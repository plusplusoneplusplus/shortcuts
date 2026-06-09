import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateStatus = vi.fn();
const mockPin = vi.fn();
const mockArchive = vi.fn();
const mockDelete = vi.fn();
const mockDispatch = vi.fn();
const mockFetchApi = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            get: (...args: any[]) => mockGet(...args),
            update: (...args: any[]) => mockUpdate(...args),
            updateStatus: (...args: any[]) => mockUpdateStatus(...args),
            pin: (...args: any[]) => mockPin(...args),
            archive: (...args: any[]) => mockArchive(...args),
            delete: (...args: any[]) => mockDelete(...args),
            tree: vi.fn(),
            syncStatus: vi.fn(),
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({
        state: {
            workItemsByRepo: {},
            paginationByRepo: {},
            loading: {},
        },
        dispatch: mockDispatch,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            selectedWorkItemId: undefined,
            selectedWorkItemSessionTaskId: undefined,
            selectedWorkItemCommitHash: undefined,
            selectedWorkItemCommitFilePath: undefined,
        },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        breakpoint: 'desktop',
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 340,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useFileCommentCounts', () => {
    const stableMap = new Map();
    return { useFileCommentCounts: () => stableMap };
});

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitCommentTotals', () => ({
    useCommitCommentTotals: () => new Map(),
}));

vi.mock('../../../../src/server/spa/client/comments/diff-comment-utils', () => ({
    computeDiffCommentKey: vi.fn().mockResolvedValue('mock-key'),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsHierarchyEnabled: () => true,
    isWorkItemsAiAuthoringEnabled: () => false,
    isWorkItemsWorkflowEnabled: () => false,
    isCommitChatLensEnabled: () => true,
    isWorkItemsSyncEnabled: () => true,
    isSessionContextAttachmentsEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemHierarchyTree', () => ({
    WorkItemHierarchyTree: ({ trackerViewKind, onSelectWorkItem }: any) => (
        <div data-testid="mock-work-item-hierarchy-tree" data-tracker={trackerViewKind}>
            {trackerViewKind === 'local' ? (
                <button type="button" data-testid="select-local-work-item" onClick={() => onSelectWorkItem('wi-local')}>
                    Select local Work Item
                </button>
            ) : (
                <button type="button" data-testid="select-remote-work-item" onClick={() => onSelectWorkItem('wi-remote')}>
                    Select remote Work Item
                </button>
            )}
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemSection', () => ({
    WorkItemSection: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/CreateWorkItemDialog', () => ({
    CreateWorkItemDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/ImportFromGitHubDialog', () => ({
    ImportFromGitHubDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemAiComposer', () => ({
    WorkItemAiComposer: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemExecuteDialog', () => ({
    WorkItemExecuteDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemParentPicker', () => ({
    WorkItemParentPicker: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemPlanSection', () => ({
    WorkItemPlanSection: () => null,
    PLAN_MODE_OPTIONS: Object.freeze([{ value: 'preview', label: 'Preview' }]),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemDescriptionEditor', () => ({
    WorkItemDescriptionEditor: ({ value, onChange }: any) => (
        <textarea data-testid="wi-description-editor" value={value} onChange={e => onChange(e.target.value)} />
    ),
    DESCRIPTION_MODE_OPTIONS: Object.freeze([{ value: 'source', label: 'Source' }]),
}));

vi.mock('../../../../src/server/spa/client/react/ui/ModeToggleToolbar', () => ({
    ModeToggleToolbar: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemGitHubMirrorBadge', () => ({
    WorkItemRemoteMirrorBadge: (props: any) => (
        props.githubMirror || props.azureBoardsMirror
            ? <span data-testid={props['data-testid'] ?? 'mock-remote-mirror-badge'} />
            : null
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemChatPlacementFrame', () => ({
    WorkItemChatPlacementFrame: (props: any) => (
        <div
            data-testid="mock-work-item-chat-frame"
            data-presentation={props.presentation}
            data-workspace-id={props.workspaceId}
            data-work-item-id={props.workItemId}
            data-title={props.title}
            data-unsaved={props.hasUnsavedChanges ? 'true' : 'false'}
        />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemChatPanel', () => ({
    WorkItemChatPanel: (props: any) => (
        <div
            data-testid="mock-work-item-chat-panel"
            data-workspace-id={props.workspaceId}
            data-work-item-id={props.workItemId}
        />
    ),
}));

import { WorkItemsTab } from '../../../../src/server/spa/client/react/features/work-items/WorkItemsTab';
import { getReviewChatOpenStorageKey } from '../../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';

const baseItem = {
    workItemNumber: 1,
    description: 'Saved description',
    status: 'planning',
    type: 'bug',
    priority: 'normal',
    tags: [],
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
};

function makeItem(workspaceId: string, id: string) {
    const remote = id === 'wi-remote';
    return {
        ...baseItem,
        id,
        workItemNumber: remote ? 2 : 1,
        title: `${workspaceId} ${remote ? 'remote' : 'local'} saved title`,
        ...(remote ? {
            githubMirror: {
                owner: 'octo',
                repo: 'repo',
                issueNumber: 42,
                issueUrl: 'https://github.com/octo/repo/issues/42',
                lastSyncedAt: '2026-06-08T00:00:00.000Z',
            },
        } : {}),
    };
}

describe('WorkItemsTab Work Item chat state integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        window.location.hash = '';
        mockFetchApi.mockResolvedValue({ comments: [] });
        mockGet.mockImplementation(async (workspaceId: string, workItemId: string) => makeItem(workspaceId, workItemId));
        mockUpdate.mockImplementation(async (workspaceId: string, workItemId: string, updates: any) => ({
            ...makeItem(workspaceId, workItemId),
            ...updates,
        }));
    });

    afterEach(() => {
        cleanup();
        localStorage.clear();
        window.location.hash = '';
    });

    it('keeps remembered chat open state scoped through local, remote, and workspace selection changes', async () => {
        const localTarget = { type: 'work-item' as const, workspaceId: 'ws-a', workItemId: 'wi-local' };
        const remoteTarget = { type: 'work-item' as const, workspaceId: 'ws-a', workItemId: 'wi-remote' };
        const otherWorkspaceTarget = { type: 'work-item' as const, workspaceId: 'ws-b', workItemId: 'wi-local' };

        const firstRender = render(<WorkItemsTab workspaceId="ws-a" />);

        fireEvent.click(screen.getByTestId('select-local-work-item'));
        fireEvent.click(await screen.findByTestId('work-item-ask-ai-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-work-item-id', 'wi-local');
        });
        expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-workspace-id', 'ws-a');
        expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-title', 'ws-a local saved title');
        expect(localStorage.getItem(getReviewChatOpenStorageKey(localTarget))).toBe('true');

        fireEvent.click(screen.getByTestId('work-item-tracker-tab-remote'));

        await waitFor(() => {
            expect(screen.queryByTestId('mock-work-item-chat-frame')).toBeNull();
        });
        expect(localStorage.getItem(getReviewChatOpenStorageKey(localTarget))).toBe('true');
        expect(localStorage.getItem(getReviewChatOpenStorageKey(remoteTarget))).toBeNull();

        fireEvent.click(await screen.findByTestId('select-remote-work-item'));
        expect(await screen.findByTestId('work-item-github-mirror-badge')).toBeTruthy();
        expect(screen.queryByTestId('mock-work-item-chat-frame')).toBeNull();

        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-work-item-id', 'wi-remote');
        });
        expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-workspace-id', 'ws-a');
        expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-title', 'ws-a remote saved title');
        expect(localStorage.getItem(getReviewChatOpenStorageKey(remoteTarget))).toBe('true');

        firstRender.unmount();
        render(<WorkItemsTab workspaceId="ws-b" />);

        fireEvent.click(screen.getByTestId('select-local-work-item'));
        await screen.findByTestId('work-item-ask-ai-btn');

        expect(localStorage.getItem(getReviewChatOpenStorageKey(localTarget))).toBe('true');
        expect(localStorage.getItem(getReviewChatOpenStorageKey(otherWorkspaceTarget))).toBeNull();
        expect(screen.queryByTestId('mock-work-item-chat-frame')).toBeNull();

        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-workspace-id', 'ws-b');
        });
        expect(screen.getByTestId('mock-work-item-chat-frame')).toHaveAttribute('data-work-item-id', 'wi-local');
        expect(localStorage.getItem(getReviewChatOpenStorageKey(otherWorkspaceTarget))).toBe('true');
    });

    it('hides child, pin, and archive actions from the detail header', async () => {
        render(<WorkItemsTab workspaceId="ws-a" />);

        fireEvent.click(screen.getByTestId('select-local-work-item'));
        await screen.findByTestId('work-item-ask-ai-btn');

        expect(screen.queryByTestId('wi-new-child-btn')).toBeNull();
        expect(screen.queryByTestId('wi-add-child-btn')).toBeNull();
        expect(screen.queryByTestId('work-item-pin-btn')).toBeNull();
        expect(screen.queryByTestId('work-item-archive-btn')).toBeNull();
        expect(screen.getByTestId('work-item-delete-btn')).toBeTruthy();
    });
});
