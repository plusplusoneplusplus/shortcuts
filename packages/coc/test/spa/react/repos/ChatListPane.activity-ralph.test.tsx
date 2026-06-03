/**
 * Render tests for ralph-session grouping inside the Activity tab
 * (Plan 002 — `ChatListPane` with no `activeTab` prop).
 *
 * Verifies that:
 *   (a) consecutive ralph iterations collapse into a single `RalphSessionRow`,
 *   (b) standalone (non-ralph) chats remain visible alongside the session,
 *   (c) expanding the row reveals every iteration child,
 *   (d) the date-bucket section count badge reflects entries (parity with the
 *       Chats tab — see ChatListPane.tsx ~L2179),
 *   (e) plan-file groups still render for non-ralph items (precedence: ralph
 *       wins when an iteration also has `planFilePath`).
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import { ChatListPane } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

let lastContextMenuProps: any = null;
vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: (props: any) => {
        lastContextMenuProps = props;
        return (
            <div data-testid="context-menu">
                {props.items?.map((item: any, i: number) =>
                    item.separator ? null : (
                        <button key={i} data-testid={`ctx-item-${item.label?.replace(/\s+/g, '-')}`} onClick={item.onClick}>
                            {item.label}
                        </button>
                    )
                )}
            </div>
        );
    },
}));

let mockPinnedChatIds = new Set<string>();
let mockArchivedChatIds = new Set<string>();
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        pinnedChatIds: mockPinnedChatIds,
        archivedChatIds: mockArchivedChatIds,
        pinChat: vi.fn(), unpinChat: vi.fn(),
        archiveChat: vi.fn(), unarchiveChat: vi.fn(),
        archiveChats: vi.fn(), unarchiveChats: vi.fn(),
    }),
}));

// historyGrouping=true so plan-file grouping path runs alongside ralph.
let mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false, historyGrouping: true };
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => mockDisplaySettings,
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createDragStartHandler: () => vi.fn(), createDragEndHandler: () => vi.fn(),
        createDragOverHandler: () => vi.fn(), createDragEnterHandler: () => vi.fn(),
        createDragLeaveHandler: () => vi.fn(), createDropHandler: () => vi.fn(),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createTouchStartHandler: () => vi.fn(),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn(), onTouchMove: vi.fn(), didLongPress: () => false }),
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => null,
}));

// ❗ Critical: enable ralph so applyRalphGrouping actually groups.
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => true,
    isLoopsEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn(),
    formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
    formatRelativeTime: (d: string) => d,
    statusLabel: (status: string) => status,
    typeLabel: (type: string) => type,
    repoName: (path: string) => path,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    buildRows: () => [],
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// ── Fixture helpers ────────────────────────────────────────────────────

const SESSION_ID = 'ralph-sess-A';
const NOW = Date.now();

function makeRalphIteration(iter: number, idMs = iter * 1000): any {
    return {
        id: `ralph-${SESSION_ID}-${iter}`,
        type: 'chat',
        status: 'completed',
        displayName: `Ralph iteration ${iter}`,
        completedAt: new Date(NOW - idMs).toISOString(),
        lastActivityAt: NOW - idMs,
        payload: {
            mode: 'ralph',
            context: { ralph: { sessionId: SESSION_ID, phase: 'executing', currentIteration: iter } },
        },
    };
}

function makeStandaloneChat(id: string, label: string): any {
    return {
        id,
        type: 'chat',
        status: 'completed',
        displayName: label,
        customTitle: label,
        completedAt: new Date(NOW - 5000).toISOString(),
        lastActivityAt: NOW - 5000,
        payload: { mode: 'ask' },
    };
}

function defaultProps(history: any[], overrides: Record<string, any> = {}) {
    return {
        running: [],
        queued: [],
        history,
        isPaused: false,
        isPauseResumeLoading: false,
        isRefreshing: false,
        selectedTaskId: null,
        isMobile: false,
        now: NOW,
        onSelectTask: vi.fn(),
        onPauseResume: vi.fn(),
        onRefresh: vi.fn(),
        onOpenDialog: vi.fn(),
        fetchQueue: vi.fn().mockResolvedValue(undefined),
        // No `activeTab` prop → Activity branch.
        ...overrides,
    };
}

function renderActivity(history: any[], overrides: Record<string, any> = {}) {
    const props = defaultProps(history, overrides);
    return { ...renderWithProviders(<ChatListPane {...props} />), props };
}

// ════════════════════════════════════════════════════════════════════════

describe('ChatListPane Activity tab — ralph session grouping (Plan 002)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPinnedChatIds = new Set();
        mockArchivedChatIds = new Set();
        mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false, historyGrouping: true };
        try { window.localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
    });

    function fixtureFiveIterPlusThreeStandalone() {
        const iterations = [1, 2, 3, 4, 5].map(makeRalphIteration);
        const standalones = [
            makeStandaloneChat('std-1', 'Standalone chat 1'),
            makeStandaloneChat('std-2', 'Standalone chat 2'),
            makeStandaloneChat('std-3', 'Standalone chat 3'),
        ];
        return [...iterations, ...standalones];
    }

    it('collapses 5 ralph iterations into a single RalphSessionRow', () => {
        renderActivity(fixtureFiveIterPlusThreeStandalone());

        const sessionRows = screen.getAllByTestId('ralph-session-row');
        expect(sessionRows).toHaveLength(1);
        expect(sessionRows[0].getAttribute('data-session-id')).toBe(SESSION_ID);
    });

    it('keeps standalone (non-ralph) chats visible alongside the session row', () => {
        const { container } = renderActivity(fixtureFiveIterPlusThreeStandalone());
        expect(container.textContent).toContain('Standalone chat 1');
        expect(container.textContent).toContain('Standalone chat 2');
        expect(container.textContent).toContain('Standalone chat 3');
    });

    it('expanding the session row reveals all 5 iteration children', () => {
        const { container } = renderActivity(fixtureFiveIterPlusThreeStandalone());

        const header = screen.getByTestId('ralph-session-body');
        // Default collapsed (no unseen). Expand it.
        if (header.getAttribute('aria-expanded') !== 'true') {
            fireEvent.click(header);
        }
        const childrenWrap = screen.getByTestId('ralph-session-children');
        for (let i = 1; i <= 5; i++) {
            const id = `ralph-${SESSION_ID}-${i}`;
            const row = childrenWrap.querySelector(`[data-task-id="${id}"]`);
            expect(row, `expected child row for ${id}`).not.toBeNull();
            // Children should be rendered in the muted group-child variant.
            expect(row!.getAttribute('data-group-child')).toBe('true');
        }
        // Sanity: the children container itself isn't the standalone list.
        expect(within(childrenWrap).queryByText('Standalone chat 1')).toBeNull();
    });

    it('resets Ralph session expansion when switching between repo scope and all repos', () => {
        const history = fixtureFiveIterPlusThreeStandalone();
        const { rerender, props } = renderActivity(history, { workspaceId: 'ws-a' });

        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('ralph-session-children')).toBeTruthy();

        rerender(<ChatListPane {...props} workspaceId="__all" />);
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();

        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');

        rerender(<ChatListPane {...props} workspaceId="ws-a" />);
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
    });

    it('keeps unseen Ralph sessions collapsed after workspace switches in the Chats tab', () => {
        const history = fixtureFiveIterPlusThreeStandalone();
        const unseenId = `ralph-${SESSION_ID}-1`;
        const { rerender, props } = renderActivity(history, {
            activeTab: 'chats',
            workspaceId: 'ws-a',
            unseenProcessIds: new Set([unseenId]),
        });

        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
        expect(screen.getByTestId('ralph-session-unseen-dot')).toBeTruthy();

        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');

        rerender(<ChatListPane {...props} workspaceId="__all" />);
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
        expect(screen.getByTestId('ralph-session-unseen-dot')).toBeTruthy();

        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');

        rerender(<ChatListPane {...props} workspaceId="ws-a" />);
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
        expect(screen.getByTestId('ralph-session-unseen-dot')).toBeTruthy();
    });

    it('Today section count badge reflects entries (1 ralph session + 3 standalones = 4)', () => {
        const { container } = renderActivity(fixtureFiveIterPlusThreeStandalone());
        const sections = Array.from(container.querySelectorAll('[data-section]')).map(el => el.getAttribute('data-section'));
        // Debug aid: include sections list in failure message.
        const todaySection = container.querySelector('[data-section="completed-today"]');
        expect(todaySection, `Sections present: ${JSON.stringify(sections)}`).not.toBeNull();
        const countSpan = todaySection!.querySelector('.tabular-nums');
        expect(countSpan?.textContent?.trim()).toBe('4');
    });

    it('does not group when ralph iterations come from different sessions', () => {
        const a = makeRalphIteration(1);
        const b = { ...makeRalphIteration(2), id: 'ralph-B-1', payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-B', phase: 'executing', currentIteration: 1 } } } };
        renderActivity([a, b]);

        const sessionRows = screen.getAllByTestId('ralph-session-row');
        expect(sessionRows).toHaveLength(2);
        const ids = sessionRows.map(r => r.getAttribute('data-session-id')).sort();
        expect(ids).toEqual(['ralph-sess-A', 'sess-B']);
    });

    it('ralph iteration with planFilePath collapses into ralph session, not plan group', () => {
        const ralphWithPlan = { ...makeRalphIteration(1), planFilePath: '/plans/foo.md' };
        const ralphWithPlan2 = { ...makeRalphIteration(2), planFilePath: '/plans/foo.md' };
        const standalonePlan = {
            ...makeStandaloneChat('std-plan-1', 'Plan-grouped chat'),
            planFilePath: '/plans/bar.md',
            lastActivityAt: NOW - 6000,
        };
        const standalonePlan2 = {
            ...makeStandaloneChat('std-plan-2', 'Plan-grouped chat 2'),
            planFilePath: '/plans/bar.md',
            lastActivityAt: NOW - 7000,
        };

        const { container } = renderActivity([ralphWithPlan, ralphWithPlan2, standalonePlan, standalonePlan2]);

        // Exactly one ralph session row.
        expect(screen.getAllByTestId('ralph-session-row')).toHaveLength(1);
        // The plan group for /plans/bar.md still renders for the non-ralph items.
        const planGroups = container.querySelectorAll('[data-testid="history-group"]');
        expect(planGroups.length).toBeGreaterThanOrEqual(1);
    });

    it('flat row count (entries) for Today equals ralph-sessions + non-ralph entries', () => {
        // 3 ralph iterations + 2 standalones → 1 ralph session + 2 standalones = 3 entries.
        const items = [
            makeRalphIteration(1),
            makeRalphIteration(2),
            makeRalphIteration(3),
            makeStandaloneChat('s1', 'X'),
            makeStandaloneChat('s2', 'Y'),
        ];
        const { container } = renderActivity(items);
        const todaySection = container.querySelector('[data-section="completed-today"]');
        expect(todaySection?.querySelector('.tabular-nums')?.textContent?.trim()).toBe('3');
    });

    it('regression: completed ralph session does not pin to top above newer standalone chats', () => {
        // Ralph session ended 8h ago; a standalone chat completed "just now".
        // Before the fix, ChatListPane concatenated [...ralphSessions, ...planned]
        // without a final timestamp sort, so the ralph session always appeared
        // first regardless of recency (matches the user-reported bug: 8h-old
        // Ralph row pinned above a "just now" Auto chat).
        const EIGHT_H = 8 * 3600_000;
        const eightHAgo = NOW - EIGHT_H;
        const justNow = NOW - 1000;

        const ralphIters = [1, 2, 3].map(iter => ({
            id: `ralph-old-${iter}`,
            type: 'chat',
            status: 'completed',
            displayName: `Ralph iteration ${iter}`,
            endTime: new Date(eightHAgo).toISOString(),
            completedAt: new Date(eightHAgo).toISOString(),
            // Late post-completion turn appends bumped lastActivityAt forward.
            lastActivityAt: justNow,
            payload: {
                mode: 'ralph',
                context: { ralph: { sessionId: 'old-ralph-sess', phase: 'executing', currentIteration: iter } },
            },
        }));
        const fresherChat = {
            id: 'fresh-auto',
            type: 'chat',
            status: 'completed',
            displayName: 'Implementing RalphSessionRow',
            endTime: new Date(NOW - 60_000).toISOString(),
            completedAt: new Date(NOW - 60_000).toISOString(),
            lastActivityAt: NOW - 60_000,
            payload: { mode: 'auto' },
        };

        const { container } = renderActivity([...ralphIters, fresherChat]);
        const todaySection = container.querySelector('[data-section="completed-today"]');
        expect(todaySection).not.toBeNull();

        // Walk the Today section in document order; the fresher standalone
        // chat must precede the ralph-session-row.
        const rowsRoot = todaySection!;
        const ralphRow = rowsRoot.querySelector('[data-testid="ralph-session-row"]');
        const freshRow = rowsRoot.querySelector('[data-task-id="fresh-auto"]');
        expect(ralphRow).not.toBeNull();
        expect(freshRow).not.toBeNull();

        // DOCUMENT_POSITION_FOLLOWING (4) means freshRow follows ralphRow in
        // document order. We assert the opposite — freshRow must appear first.
        const pos = ralphRow!.compareDocumentPosition(freshRow!);
        // eslint-disable-next-line no-bitwise
        expect(pos & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    });
});

// ════════════════════════════════════════════════════════════════════════
// Context-menu tests for RalphSessionRow in the Activity tab
// ════════════════════════════════════════════════════════════════════════

describe('ChatListPane Activity tab — ralph session context menu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        lastContextMenuProps = null;
        mockPinnedChatIds = new Set();
        mockArchivedChatIds = new Set();
        mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false, historyGrouping: true };
        try { window.localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
    });

    function fixtureWithGrilling() {
        const grilling = {
            id: 'grilling-1',
            type: 'chat',
            status: 'completed',
            displayName: 'Ralph grilling',
            completedAt: new Date(NOW - 3000).toISOString(),
            lastActivityAt: NOW - 3000,
            payload: {
                mode: 'ask',
                context: { ralph: { sessionId: SESSION_ID, phase: 'grilling' } },
            },
        };
        const iterations = [1, 2].map(makeRalphIteration);
        return [grilling, ...iterations];
    }

    it('right-clicking a RalphSessionRow opens the context menu', () => {
        renderActivity(fixtureWithGrilling());

        const body = screen.getByTestId('ralph-session-body');
        fireEvent.contextMenu(body, { clientX: 100, clientY: 200 });

        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    it('shift+right-click does NOT open the context menu (native browser fallback)', () => {
        renderActivity(fixtureWithGrilling());

        const body = screen.getByTestId('ralph-session-body');
        fireEvent.contextMenu(body, { clientX: 100, clientY: 200, shiftKey: true });

        // Context menu should not appear because the ContextMenu is only
        // rendered when contextMenu state is set. With shiftKey, the handler
        // returns early and never calls setContextMenu.
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('context menu includes bulk operation items and "Copy session info"', () => {
        renderActivity(fixtureWithGrilling());

        const body = screen.getByTestId('ralph-session-body');
        fireEvent.contextMenu(body, { clientX: 100, clientY: 200 });

        const menu = screen.getByTestId('context-menu');
        expect(menu.textContent).toContain('Copy session info');
        expect(menu.textContent).toContain('Archive');
        expect(menu.textContent).toContain('Delete');
    });

    it('"Copy session info" writes the expected clipboard payload', async () => {
        const { copyToClipboard: mockCopy } = await import('../../../../src/server/spa/client/react/utils/format') as any;

        renderActivity(fixtureWithGrilling());

        const body = screen.getByTestId('ralph-session-body');
        fireEvent.contextMenu(body, { clientX: 100, clientY: 200 });

        const copyBtn = screen.getByTestId('ctx-item-Copy-session-info');
        fireEvent.click(copyBtn);

        expect(mockCopy).toHaveBeenCalledTimes(1);
        const text = mockCopy.mock.calls[0][0] as string;
        expect(text).toContain(`Ralph session ${SESSION_ID}`);
        expect(text).toContain('Iterations: 2');
        expect(text).toContain('Processes:');
        expect(text).toContain('grilling-1');
        expect(text).toContain(`ralph-${SESSION_ID}-1`);
        expect(text).toContain(`ralph-${SESSION_ID}-2`);
    });

    it('context menu bulk ids include grilling process and all iterations', () => {
        renderActivity(fixtureWithGrilling());

        const body = screen.getByTestId('ralph-session-body');
        fireEvent.contextMenu(body, { clientX: 100, clientY: 200 });

        const menu = screen.getByTestId('context-menu');
        // The header should show "3 tasks selected" (1 grilling + 2 iterations).
        expect(menu.textContent).toContain('3 tasks selected');
    });
});
