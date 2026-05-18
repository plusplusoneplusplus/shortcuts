/**
 * Tests for frozen task visual effect in queue task cards.
 * Covers QueueTaskItem (ChatListPane) and QueueTaskCard (ProcessesSidebar).
 *
 * Intentionally not tested (source-level tests dropped):
 * - CSS @keyframes frost-shimmer / .task-frozen class existence — verified
 *   indirectly by render tests that assert the class is applied; keyframe
 *   animation validation is out of scope for jsdom.
 * - Dark mode variant of .task-frozen — jsdom does not support media queries.
 * - opacity-60 italic absence — negative implementation detail, not behavioral.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';
import { QueueTaskItem } from '../../../src/server/spa/client/react/features/chat/ChatListPane';

// ── Mocks for QueueTaskItem's transitive dependencies ──────────────────
vi.mock('../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => null,
}));
vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => undefined,
}));
vi.mock('../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({
        onTouchStart: vi.fn(),
        onTouchEnd: vi.fn(),
        onTouchMove: vi.fn(),
        didLongPress: () => false,
    }),
}));
vi.mock('../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        activeDraggedTaskId: null,
        handleDragStart: vi.fn(),
        handleDragOver: vi.fn(),
        handleDrop: vi.fn(),
        handleDragEnd: vi.fn(),
    }),
}));
vi.mock('../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        draggedTaskId: null,
        dropTargetIndex: null,
        dropPosition: null,
        createTouchStartHandler: vi.fn(),
    }),
}));
vi.mock('../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        pinnedChatIds: new Set(),
        archivedChatIds: new Set(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
    }),
}));
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ taskCardDensity: 'normal', showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
}));

afterEach(cleanup);

// ── Helpers ────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

function SeededQueuePanel({ running, queued }: { running: any[]; queued: any[] }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({
            type: 'QUEUE_UPDATED',
            queue: {
                running,
                queued,
                stats: { queued: queued.length, running: running.length, completed: 0, failed: 0 },
            },
        });
    }, [dispatch, running, queued]);
    return <ProcessesSidebar />;
}

// ── QueueTaskItem (ChatListPane) ───────────────────────────────────

describe('QueueTaskItem frozen visual', () => {
    it('applies task-frozen class when task.frozen is true', () => {
        render(
            <Wrap>
                <QueueTaskItem task={{ id: 't1', type: 'chat', frozen: true }} status="queued" now={Date.now()} />
            </Wrap>,
        );
        expect(document.querySelector('.task-frozen')).toBeTruthy();
    });

    it('shows ❄️ icon when frozen', () => {
        render(
            <Wrap>
                <QueueTaskItem task={{ id: 't1', type: 'chat', frozen: true }} status="queued" now={Date.now()} />
            </Wrap>,
        );
        const card = document.querySelector('.task-frozen')!;
        expect(card.textContent).toContain('❄️');
    });

    it('does not apply task-frozen class to non-frozen task', () => {
        render(
            <Wrap>
                <QueueTaskItem task={{ id: 't1', type: 'chat', frozen: false }} status="queued" now={Date.now()} />
            </Wrap>,
        );
        expect(document.querySelector('.task-frozen')).toBeNull();
    });
});

// ── ProcessesSidebar: QueueTaskCard frozen rendering ──────────────────

describe('ProcessesSidebar frozen task rendering', () => {
    it('renders frozen queued task card with task-frozen class', () => {
        const queued = [
            { id: 'q1', status: 'queued', frozen: true, prompt: 'frozen task' },
        ];

        render(<Wrap><SeededQueuePanel running={[]} queued={queued} /></Wrap>);

        const frozenCard = document.querySelector('.task-frozen');
        expect(frozenCard).toBeTruthy();
    });

    it('does not apply task-frozen class to non-frozen task', () => {
        const queued = [
            { id: 'q1', status: 'queued', frozen: false, prompt: 'normal task' },
        ];

        render(<Wrap><SeededQueuePanel running={[]} queued={queued} /></Wrap>);

        const frozenCard = document.querySelector('.task-frozen');
        expect(frozenCard).toBeNull();
    });

    it('renders ❄️ icon for frozen task', () => {
        const queued = [
            { id: 'q1', status: 'queued', frozen: true, prompt: 'frozen task' },
        ];

        render(<Wrap><SeededQueuePanel running={[]} queued={queued} /></Wrap>);

        const frozenCard = document.querySelector('.task-frozen');
        expect(frozenCard).toBeTruthy();
        expect(frozenCard!.textContent).toContain('❄️');
    });

    it('shows Frozen badge label for frozen task in full layout', () => {
        const queued = [
            { id: 'q1', status: 'queued', frozen: true, prompt: 'frozen task' },
        ];

        render(<Wrap><SeededQueuePanel running={[]} queued={queued} /></Wrap>);

        const frozenCard = document.querySelector('.task-frozen');
        expect(frozenCard).toBeTruthy();
        expect(frozenCard!.textContent).toContain('Frozen');
    });
});
