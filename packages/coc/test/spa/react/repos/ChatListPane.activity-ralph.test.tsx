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
import { RALPH_SESSION_CONTEXT_DRAG_MIME } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

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
const mockPinChat = vi.fn();
const mockUnpinChat = vi.fn();
let mockSessionContextAttachmentsEnabled = false;
let mockForEachEnabled = false;
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        pinnedChatIds: mockPinnedChatIds,
        archivedChatIds: mockArchivedChatIds,
        pinChat: mockPinChat, unpinChat: mockUnpinChat,
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
    isForEachEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => mockSessionContextAttachmentsEnabled,
    isForEachEnabled: () => mockForEachEnabled,
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

function makeOrderedStandaloneChat(id: string, label: string, ageMs: number): any {
    return {
        ...makeStandaloneChat(id, label),
        completedAt: new Date(NOW - ageMs).toISOString(),
        lastActivityAt: NOW - ageMs,
    };
}

function makeOrderedRalphIteration(iter: number, ageMs: number): any {
    return {
        ...makeRalphIteration(iter, ageMs),
        endTime: new Date(NOW - ageMs).toISOString(),
        completedAt: new Date(NOW - ageMs).toISOString(),
        lastActivityAt: NOW - ageMs,
    };
}

function makeForEachRunSummary(runId = 'run-1'): any {
    return {
        runId,
        workspaceId: 'ws-1',
        status: 'completed',
        originalRequest: 'Split pinned parent work',
        childMode: 'ask',
        createdAt: new Date(NOW - 7000).toISOString(),
        updatedAt: new Date(NOW - 7000).toISOString(),
        itemCount: 1,
        itemStatusCounts: {
            pending: 0,
            running: 0,
            completed: 1,
            failed: 0,
            skipped: 0,
        },
    };
}

function makeForEachChild(runId = 'run-1'): any {
    return {
        ...makeStandaloneChat(`child-${runId}`, 'For Each child'),
        forEach: {
            kind: 'child',
            workspaceId: 'ws-1',
            runId,
            itemId: 'item-1',
        },
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
        mockSessionContextAttachmentsEnabled = false;
        mockForEachEnabled = false;
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

    it('does not make Ralph session groups drag sources when context attachments are disabled', () => {
        renderActivity(fixtureFiveIterPlusThreeStandalone(), { workspaceId: 'ws-1' });

        const body = screen.getByTestId('ralph-session-body');
        expect(body.getAttribute('draggable')).not.toBe('true');
        expect(body.getAttribute('data-session-context-source')).toBeNull();
    });

    it('sets a pointer-only Ralph session drag payload when context attachments are enabled', () => {
        mockSessionContextAttachmentsEnabled = true;
        renderActivity(fixtureFiveIterPlusThreeStandalone(), { workspaceId: 'ws-1' });

        const body = screen.getByTestId('ralph-session-body');
        expect(body.getAttribute('draggable')).toBe('true');
        expect(body.getAttribute('data-session-context-source')).toBe('true');
        expect(body.getAttribute('data-session-context-kind')).toBe('ralph-session');
        expect(body.getAttribute('data-session-context-status')).toBe('completed');

        const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };
        fireEvent.dragStart(body, { dataTransfer });

        expect(dataTransfer.effectAllowed).toBe('copy');
        const [, rawPayload] = dataTransfer.setData.mock.calls.find((call: any[]) => call[0] === RALPH_SESSION_CONTEXT_DRAG_MIME)!;
        const payload = JSON.parse(rawPayload);
        expect(payload).toMatchObject({
            kind: 'coc.ralph-session-context',
            version: 1,
            sourceWorkspaceId: 'ws-1',
            sourceRalphSessionId: SESSION_ID,
            phase: 'complete',
            status: 'completed',
            title: 'Ralph iteration 1',
            displayLabel: 'Ralph iteration 1 - 5 iter',
            childProcessIds: [
                `ralph-${SESSION_ID}-1`,
                `ralph-${SESSION_ID}-2`,
                `ralph-${SESSION_ID}-3`,
                `ralph-${SESSION_ID}-4`,
                `ralph-${SESSION_ID}-5`,
            ],
            processCount: 5,
            iterationCount: 5,
        });
    });

    it('keeps failed Ralph session groups draggable when context attachments are enabled', () => {
        mockSessionContextAttachmentsEnabled = true;
        const failed = {
            ...makeRalphIteration(1),
            id: 'ralph-failed-1',
            status: 'failed',
            payload: {
                mode: 'ralph',
                context: {
                    ralph: {
                        sessionId: 'ralph-failed-session',
                        phase: 'failed',
                        currentIteration: 1,
                    },
                },
            },
        };

        renderActivity([failed], { workspaceId: 'ws-1' });

        const body = screen.getByTestId('ralph-session-body');
        expect(body.getAttribute('draggable')).toBe('true');
        expect(body.getAttribute('data-session-phase')).toBe('failed');
        expect(body.getAttribute('data-session-context-status')).toBe('failed');

        const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };
        fireEvent.dragStart(body, { dataTransfer });
        const [, rawPayload] = dataTransfer.setData.mock.calls.find((call: any[]) => call[0] === RALPH_SESSION_CONTEXT_DRAG_MIME)!;
        const payload = JSON.parse(rawPayload);
        expect(payload).toMatchObject({
            sourceWorkspaceId: 'ws-1',
            sourceRalphSessionId: 'ralph-failed-session',
            phase: 'failed',
            status: 'failed',
            childProcessIds: ['ralph-failed-1'],
        });
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

    it('keeps unseen Ralph sessions collapsed after workspace switches in the Activity tab', () => {
        const history = fixtureFiveIterPlusThreeStandalone();
        const unseenId = `ralph-${SESSION_ID}-1`;
        const { rerender, props } = renderActivity(history, {
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

    it('starts unseen Ralph sessions collapsed again after remounting the Activity tab', () => {
        const history = fixtureFiveIterPlusThreeStandalone();
        const unseenId = `ralph-${SESSION_ID}-1`;
        const { unmount } = renderActivity(history, {
            workspaceId: 'ws-a',
            unseenProcessIds: new Set([unseenId]),
        });

        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');

        unmount();
        renderActivity(history, {
            workspaceId: 'ws-a',
            unseenProcessIds: new Set([unseenId]),
        });

        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
        expect(screen.queryByTestId('ralph-session-children')).toBeNull();
        expect(screen.getByTestId('ralph-session-unseen-dot')).toBeTruthy();
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

    it('starts unseen Ralph sessions collapsed again after remounting the same workspace', () => {
        const history = fixtureFiveIterPlusThreeStandalone();
        const unseenId = `ralph-${SESSION_ID}-1`;
        const { unmount } = renderActivity(history, {
            activeTab: 'chats',
            workspaceId: 'ws-a',
            unseenProcessIds: new Set([unseenId]),
        });

        fireEvent.click(screen.getByTestId('ralph-session-chevron'));
        expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');

        unmount();
        renderActivity(history, {
            activeTab: 'chats',
            workspaceId: 'ws-a',
            unseenProcessIds: new Set([unseenId]),
        });

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

    it('renders a pinned Ralph session group in Pinned and removes it from Today', () => {
        const standalone = makeStandaloneChat('standalone', 'Standalone chat');
        const { container } = renderActivity([makeRalphIteration(1), makeRalphIteration(2), standalone], {
            groupPins: [{
                type: 'ralph-session',
                groupId: SESSION_ID,
                pinnedAt: new Date(NOW).toISOString(),
            }],
        });

        const pinnedSection = container.querySelector('[data-section="pinned"]') as HTMLElement;
        const todaySection = container.querySelector('[data-section="completed-today"]') as HTMLElement;

        expect(pinnedSection).toBeTruthy();
        expect(within(pinnedSection).getByTestId('ralph-session-row')).toBeTruthy();
        expect(within(pinnedSection).getByTestId('ralph-session-body').getAttribute('data-pinned')).toBe('true');
        expect(todaySection).toBeTruthy();
        expect(todaySection.querySelector('[data-testid="ralph-session-row"]')).toBeNull();
        expect(todaySection.textContent).toContain('Standalone chat');
    });

    it('interleaves pinned chats and pinned Ralph groups by pin time', () => {
        mockPinnedChatIds = new Set(['older-chat', 'newer-chat']);
        const olderChat = makeStandaloneChat('older-chat', 'Older pinned chat');
        olderChat.pinnedAt = '2026-01-01T00:01:00.000Z';
        const newerChat = makeStandaloneChat('newer-chat', 'Newer pinned chat');
        newerChat.pinnedAt = '2026-01-01T00:03:00.000Z';

        const { container } = renderActivity([makeRalphIteration(1), olderChat, newerChat], {
            groupPins: [{
                type: 'ralph-session',
                groupId: SESSION_ID,
                pinnedAt: '2026-01-01T00:02:00.000Z',
            }],
        });

        const pinnedSection = container.querySelector('[data-section="pinned"]') as HTMLElement;
        const rows = Array.from(pinnedSection.querySelectorAll('[data-task-id], [data-testid="ralph-session-row"]'));

        expect(rows.map(row => row.getAttribute('data-task-id') ?? row.getAttribute('data-session-id'))).toEqual([
            'newer-chat',
            SESSION_ID,
            'older-chat',
        ]);
    });

    it('renders a pinned For Each run group in Pinned and removes it from Today', () => {
        mockForEachEnabled = true;
        const standalone = makeStandaloneChat('standalone-fe', 'Standalone chat');
        const { container } = renderActivity([makeForEachChild('run-1'), standalone], {
            forEachRuns: [makeForEachRunSummary('run-1')],
            groupPins: [{
                type: 'for-each-run',
                groupId: 'run-1',
                pinnedAt: new Date(NOW).toISOString(),
            }],
        });

        const pinnedSection = container.querySelector('[data-section="pinned"]') as HTMLElement;
        const todaySection = container.querySelector('[data-section="completed-today"]') as HTMLElement;

        expect(pinnedSection).toBeTruthy();
        expect(within(pinnedSection).getByTestId('for-each-run-row')).toBeTruthy();
        expect(within(pinnedSection).getByTestId('for-each-run-body').getAttribute('data-pinned')).toBe('true');
        expect(todaySection).toBeTruthy();
        expect(todaySection.querySelector('[data-testid="for-each-run-row"]')).toBeNull();
        expect(todaySection.querySelector('[data-task-id="child-run-1"]')).toBeNull();
        expect(todaySection.textContent).toContain('Standalone chat');
    });

    it('Ralph group pin button toggles only the parent group and does not select or expand', () => {
        const onSetGroupPin = vi.fn();
        const onSelectRalphSession = vi.fn();
        renderActivity([makeRalphIteration(1), makeRalphIteration(2)], {
            onSetGroupPin,
            onSelectRalphSession,
        });

        const body = screen.getByTestId('ralph-session-body');
        expect(body.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(screen.getByTestId('ralph-session-pin'));

        expect(onSetGroupPin).toHaveBeenCalledWith('ralph-session', SESSION_ID, true);
        expect(onSelectRalphSession).not.toHaveBeenCalled();
        expect(body.getAttribute('aria-expanded')).toBe('false');
        expect(mockPinChat).not.toHaveBeenCalled();
    });

    it('For Each group pin button toggles only the parent group and does not select or expand', () => {
        mockForEachEnabled = true;
        const onSetGroupPin = vi.fn();
        const onSelectForEachRun = vi.fn();
        renderActivity([makeForEachChild('run-1')], {
            forEachRuns: [makeForEachRunSummary('run-1')],
            onSetGroupPin,
            onSelectForEachRun,
        });

        const body = screen.getByTestId('for-each-run-body');
        expect(body.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(screen.getByTestId('for-each-run-pin'));

        expect(onSetGroupPin).toHaveBeenCalledWith('for-each-run', 'run-1', true);
        expect(onSelectForEachRun).not.toHaveBeenCalled();
        expect(body.getAttribute('aria-expanded')).toBe('false');
        expect(mockPinChat).not.toHaveBeenCalled();
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

    describe('shift-click range selection across Ralph groups', () => {
        function rangeFixture() {
            return [
                makeOrderedStandaloneChat('regular-above', 'Regular above', 1000),
                makeOrderedRalphIteration(1, 2000),
                makeOrderedRalphIteration(2, 2100),
                makeOrderedStandaloneChat('regular-below', 'Regular below', 3000),
            ];
        }

        it('treats a collapsed Ralph session as one range row and selects every child process', () => {
            renderActivity(rangeFixture(), { activeTab: 'chats' });

            expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('false');
            fireEvent.click(document.querySelector('[data-task-id="regular-above"]')!);
            fireEvent.click(document.querySelector('[data-task-id="regular-below"]')!, { shiftKey: true });

            expect(screen.getByTestId('ralph-session-row').getAttribute('data-selected')).toBe('true');
            expect((document.querySelector('[data-task-id="regular-above"]') as HTMLElement).getAttribute('data-selected')).toBe('true');
            expect((document.querySelector('[data-task-id="regular-below"]') as HTMLElement).getAttribute('data-selected')).toBe('true');
            fireEvent.contextMenu(document.querySelector('[data-task-id="regular-above"]')!);
            expect(screen.getByText(/4 tasks selected/)).toBeTruthy();
        });

        it('uses individual Ralph child rows when the session is expanded', () => {
            renderActivity(rangeFixture(), { activeTab: 'chats' });

            fireEvent.click(screen.getByTestId('ralph-session-chevron'));
            expect(screen.getByTestId('ralph-session-body').getAttribute('aria-expanded')).toBe('true');

            fireEvent.click(document.querySelector('[data-task-id="regular-above"]')!);
            fireEvent.click(document.querySelector('[data-task-id="regular-below"]')!, { shiftKey: true });

            expect((document.querySelector(`[data-task-id="ralph-${SESSION_ID}-1"]`) as HTMLElement).getAttribute('data-selected')).toBe('true');
            expect((document.querySelector(`[data-task-id="ralph-${SESSION_ID}-2"]`) as HTMLElement).getAttribute('data-selected')).toBe('true');
            fireEvent.contextMenu(document.querySelector('[data-task-id="regular-above"]')!);
            expect(screen.getByText(/4 tasks selected/)).toBeTruthy();
        });

        it('normalizes a sub-session anchor to the Ralph group boundary', () => {
            renderActivity(rangeFixture(), { activeTab: 'chats' });

            fireEvent.click(screen.getByTestId('ralph-session-chevron'));
            fireEvent.click(document.querySelector(`[data-task-id="ralph-${SESSION_ID}-2"]`)!);
            fireEvent.click(document.querySelector('[data-task-id="regular-below"]')!, { shiftKey: true });

            expect((document.querySelector(`[data-task-id="ralph-${SESSION_ID}-1"]`) as HTMLElement).getAttribute('data-selected')).toBe('true');
            expect((document.querySelector(`[data-task-id="ralph-${SESSION_ID}-2"]`) as HTMLElement).getAttribute('data-selected')).toBe('true');
            expect((document.querySelector('[data-task-id="regular-below"]') as HTMLElement).getAttribute('data-selected')).toBe('true');
            fireEvent.contextMenu(document.querySelector('[data-task-id="regular-below"]')!);
            expect(screen.getByText(/3 tasks selected/)).toBeTruthy();
        });

        it('preserves ctrl-click toggling for expanded Ralph child rows', () => {
            renderActivity(rangeFixture(), { activeTab: 'chats' });

            fireEvent.click(screen.getByTestId('ralph-session-chevron'));
            fireEvent.click(document.querySelector(`[data-task-id="ralph-${SESSION_ID}-1"]`)!, { ctrlKey: true });
            fireEvent.click(document.querySelector(`[data-task-id="ralph-${SESSION_ID}-2"]`)!, { ctrlKey: true });

            expect((document.querySelector(`[data-task-id="ralph-${SESSION_ID}-1"]`) as HTMLElement).getAttribute('data-selected')).toBe('true');
            expect((document.querySelector(`[data-task-id="ralph-${SESSION_ID}-2"]`) as HTMLElement).getAttribute('data-selected')).toBe('true');
            fireEvent.contextMenu(document.querySelector(`[data-task-id="ralph-${SESSION_ID}-1"]`)!);
            expect(screen.getByText(/2 tasks selected/)).toBeTruthy();
        });
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
        mockSessionContextAttachmentsEnabled = false;
        mockForEachEnabled = false;
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

    it('context menu Pin to top toggles the Ralph parent group, not child chat pins', () => {
        const onSetGroupPin = vi.fn();
        renderActivity(fixtureWithGrilling(), { onSetGroupPin });

        fireEvent.contextMenu(screen.getByTestId('ralph-session-body'), { clientX: 100, clientY: 200 });
        fireEvent.click(screen.getByTestId('ctx-item-Pin-to-top'));

        expect(onSetGroupPin).toHaveBeenCalledWith('ralph-session', SESSION_ID, true);
        expect(mockPinChat).not.toHaveBeenCalled();
    });

    it('context menu Unpin toggles a pinned Ralph parent group', () => {
        const onSetGroupPin = vi.fn();
        renderActivity(fixtureWithGrilling(), {
            onSetGroupPin,
            groupPins: [{
                type: 'ralph-session',
                groupId: SESSION_ID,
                pinnedAt: new Date(NOW).toISOString(),
            }],
        });

        fireEvent.contextMenu(screen.getByTestId('ralph-session-body'), { clientX: 100, clientY: 200 });
        fireEvent.click(screen.getByTestId('ctx-item-Unpin'));

        expect(onSetGroupPin).toHaveBeenCalledWith('ralph-session', SESSION_ID, false);
        expect(mockUnpinChat).not.toHaveBeenCalled();
    });

    it('context menu Pin to top toggles the For Each parent group', () => {
        mockForEachEnabled = true;
        const onSetGroupPin = vi.fn();
        renderActivity([makeForEachChild('run-1')], {
            forEachRuns: [makeForEachRunSummary('run-1')],
            onSetGroupPin,
        });

        fireEvent.contextMenu(screen.getByTestId('for-each-run-body'), { clientX: 100, clientY: 200 });
        fireEvent.click(screen.getByTestId('ctx-item-Pin-to-top'));

        expect(onSetGroupPin).toHaveBeenCalledWith('for-each-run', 'run-1', true);
        expect(mockPinChat).not.toHaveBeenCalled();
    });
});
