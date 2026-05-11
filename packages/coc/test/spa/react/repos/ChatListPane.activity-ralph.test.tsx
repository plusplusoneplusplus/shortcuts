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

vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
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
    getApiBase: () => '',
    isRalphEnabled: () => true,
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
        completedAt: new Date(NOW - 5000).toISOString(),
        lastActivityAt: NOW - 5000,
        payload: { mode: 'ask' },
    };
}

function defaultProps(history: any[]) {
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
    };
}

function renderActivity(history: any[]) {
    return renderWithProviders(<ChatListPane {...defaultProps(history)} />);
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
        renderActivity(fixtureFiveIterPlusThreeStandalone());

        const header = screen.getByTestId('ralph-session-header');
        // Default collapsed (no unseen). Expand it.
        if (header.getAttribute('aria-expanded') !== 'true') {
            fireEvent.click(header);
        }
        for (let i = 1; i <= 5; i++) {
            expect(screen.getByTestId(`ralph-iteration-${i}`)).toBeTruthy();
        }
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
});
