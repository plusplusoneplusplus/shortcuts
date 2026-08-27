/**
 * ChatListPane — the Folders tree section (AC-04).
 *
 * The flag-off contract lives in `ChatListPane-folders-flag.test.tsx`; this
 * suite is the flag-ON behaviour: where the section sits, what its counts mean,
 * which rows leave their date bucket, and what happens on each list surface.
 *
 * `utils/config` is deliberately NOT mocked so the real feature-flag read path
 * runs via `applyRuntimeConfigPatch`.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

const FOLDERS = [
    {
        id: 'folder-auth',
        name: 'Auth rewrite',
        color: 'purple',
        sortIndex: 0,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
    },
];

const listChatFolders = vi.fn(async () => ({ folders: FOLDERS }));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: { listChatFolders: (...args: any[]) => listChatFolders(...(args as [])) },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        handleDragStart: vi.fn(),
        handleDragOver: vi.fn(),
        handleDrop: vi.fn(),
        handleDragEnd: vi.fn(),
        dragOverIndex: null,
        dragSourceIndex: null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        handleTouchStart: vi.fn(),
        handleTouchMove: vi.fn(),
        handleTouchEnd: vi.fn(),
        isDragging: false,
        dragOverIndex: null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({
        onTouchStart: vi.fn(),
        onTouchEnd: vi.fn(),
        onTouchMove: vi.fn(),
        didLongPress: () => false,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => ({ progress: null }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/useAgentProvidersQuota', () => ({
    useAgentProvidersQuota: () => ({ quotaData: null, loading: false, refreshing: false, error: null, refresh: vi.fn() }),
    AGENT_PROVIDER_QUOTA_POLL_MS: 300000,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    useChatPrefs: () => ({
        pinnedChatIds: new Set(),
        archivedChatIds: new Set(),
        onPinChat: vi.fn(),
        onUnpinChat: vi.fn(),
        onArchiveChat: vi.fn(),
        onUnarchiveChat: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { isTaskSubmitting: false },
        setPriority: vi.fn(),
        remove: vi.fn(),
        reload: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
    }),
}));

// `folderId` rides on the process-summary index that AppContext already holds.
let mockProcesses: any[] = [];
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { myWorkExcludedTypes: [], selectedWorkspaceId: 'ws-test', processes: mockProcesses },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ getBoolean: () => false, setBoolean: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    buildRows: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/ui/RenameDialog', () => ({
    RenameDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
}));

import { ChatListPane } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

function makeChat(overrides: Record<string, any> = {}) {
    return {
        id: 'task-1',
        type: 'chat',
        status: 'completed',
        displayName: 'Test Chat',
        title: 'Test Chat',
        startedAt: new Date().toISOString(),
        lastActivityAt: Date.now(),
        payload: { mode: 'ask' },
        ...overrides,
    };
}

function makeScript(overrides: Record<string, any> = {}) {
    return makeChat({ type: 'run-script', payload: {}, ...overrides });
}

const defaultProps = {
    running: [],
    queued: [],
    history: [],
    isPaused: false,
    isPauseResumeLoading: false,
    isRefreshing: false,
    selectedTaskId: null,
    isMobile: false,
    now: Date.now(),
    workspaceId: 'ws-test',
    onSelectTask: vi.fn(),
    onPauseResume: vi.fn(),
    onRefresh: vi.fn(),
    onOpenDialog: vi.fn(),
    fetchQueue: vi.fn().mockResolvedValue(undefined),
};

async function renderPane(props: Record<string, any> = {}) {
    let utils: ReturnType<typeof render>;
    await act(async () => {
        utils = render(<ChatListPane {...defaultProps} {...props} />);
    });
    return utils!;
}

describe('ChatListPane — chat folders (flag on)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    it('renders no Folders section when the workspace has no folders', async () => {
        listChatFolders.mockResolvedValue({ folders: [] });
        await renderPane({ history: [makeChat({ id: 'proc-a' })] });
        expect(document.querySelector('[data-section="folders"]')).toBeNull();
    });

    it('renders a folder with its filed member, and pulls that member out of its date bucket', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' }),
                makeChat({ id: 'proc-b', displayName: 'Quick Open tie-break', title: 'Quick Open tie-break' }),
            ],
        });

        const section = document.querySelector('[data-section="folders"]');
        expect(section).not.toBeNull();
        expect(screen.getByTestId('chat-folder-name').textContent).toBe('Auth rewrite');
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');

        // The filed row renders under the folder, using the existing nested-row
        // treatment rather than a second nesting style.
        const children = screen.getByTestId('chat-folder-children');
        expect(children.textContent).toContain('token refresh');
        expect(children.querySelector('[data-group-child]')).not.toBeNull();

        // …and it is gone from Today, where the unfiled row still sits.
        const today = document.querySelector('[data-section="completed-today"]')!;
        expect(today.textContent).toContain('Quick Open tie-break');
        expect(today.textContent).not.toContain('token refresh');
    });

    it('places the Folders section after Running and before the date buckets', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            running: [makeChat({ id: 'proc-run', status: 'running', displayName: 'live one', title: 'live one' })],
            history: [
                makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' }),
                makeChat({ id: 'proc-b', displayName: 'Quick Open tie-break', title: 'Quick Open tie-break' }),
            ],
        });

        const order = [...document.querySelectorAll('[data-section]')]
            .map(el => el.getAttribute('data-section'));
        expect(order.indexOf('folders')).toBeGreaterThan(order.indexOf('running'));
        expect(order.indexOf('folders')).toBeLessThan(order.indexOf('completed'));
    });

    it('keeps a filed running row in Running, carrying a folder chip', async () => {
        mockProcesses = [{ id: 'proc-run', folderId: 'folder-auth' }];
        await renderPane({
            running: [makeChat({ id: 'proc-run', status: 'running', displayName: 'fix flaky e2e shard', title: 'fix flaky e2e shard' })],
        });

        const runningSection = document.querySelector('[data-section="running"]')!;
        expect(runningSection.textContent).toContain('fix flaky e2e shard');
        const chip = screen.getByTestId('chat-folder-chip');
        expect(chip.getAttribute('data-folder-name')).toBe('Auth rewrite');
        expect(runningSection.contains(chip)).toBe(true);
    });

    it('shows a folder that is empty everywhere as a dimmed row at count 0', async () => {
        mockProcesses = [];
        await renderPane({ history: [makeChat({ id: 'proc-b' })] });
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('0');
        expect(screen.getByTestId('chat-folder-empty').textContent).toContain('Empty');
    });

    it('hides a chat-only folder on the Tasks tab, where none of its members belong', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            activeTab: 'tasks',
            history: [
                makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' }),
                makeScript({ id: 'proc-s', displayName: 'nightly script', title: 'nightly script' }),
            ],
        });
        expect(document.querySelector('[data-section="folders"]')).toBeNull();
        // The chat itself is out of scope on this tab, so it is not orphaned —
        // it simply is not part of the Tasks list at all.
        expect(document.body.textContent).not.toContain('token refresh');
    });

    it('counts only tab-visible members, so the badge matches what expanding reveals', async () => {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-s', folderId: 'folder-auth' },
        ];
        await renderPane({
            activeTab: 'chats',
            history: [
                makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' }),
                makeScript({ id: 'proc-s', displayName: 'nightly script', title: 'nightly script' }),
            ],
        });
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');
        expect(screen.getByTestId('chat-folder-children').textContent).toContain('token refresh');
    });

    it('collapses on click and stays collapsed across a remount', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' })] });

        expect(screen.getByTestId('chat-folder').getAttribute('data-expanded')).toBe('true');
        await act(async () => {
            fireEvent.click(screen.getByTestId('chat-folder-row'));
        });
        expect(screen.getByTestId('chat-folder').getAttribute('data-expanded')).toBe('false');
        expect(screen.queryByTestId('chat-folder-children')).toBeNull();

        cleanup();
        await renderPane({ history: [makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' })] });
        expect(screen.getByTestId('chat-folder').getAttribute('data-expanded')).toBe('false');
    });

    it('does not fall through to the empty state when every chat is filed', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            activeTab: 'chats',
            history: [makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' })],
        });
        expect(document.body.textContent).not.toContain('No chat sessions yet');
        expect(screen.getByTestId('chat-folder-children').textContent).toContain('token refresh');
    });

    it('does not refetch the folder list when a folder is collapsed and expanded', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a' })] });
        const callsAfterMount = listChatFolders.mock.calls.length;
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-row')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-row')); });
        expect(listChatFolders.mock.calls.length).toBe(callsAfterMount);
    });
});

describe('ChatListPane — chat folders across list surfaces', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-s', folderId: 'folder-auth' },
        ];
    });

    // All four surfaces go through this one component, so one renderer serves
    // Activity, Chats, Tasks and a repo group's Workspace tab.
    const surfaces: Array<{ label: string; props: Record<string, any> }> = [
        { label: 'Activity', props: {} },
        { label: 'Chats', props: { activeTab: 'chats' } },
        { label: 'Tasks', props: { activeTab: 'tasks' } },
        { label: 'repo group Workspace tab', props: { workspaceId: 'group-demo' } },
    ];

    for (const surface of surfaces) {
        it(`renders the Folders section on the ${surface.label} surface`, async () => {
            await renderPane({
                ...surface.props,
                history: [
                    makeChat({ id: 'proc-a', displayName: 'token refresh', title: 'token refresh' }),
                    makeScript({ id: 'proc-s', displayName: 'nightly script', title: 'nightly script' }),
                ],
            });
            expect(document.querySelector('[data-section="folders"]')).not.toBeNull();
            expect(screen.getByTestId('chat-folder-name').textContent).toBe('Auth rewrite');
        });
    }
});
