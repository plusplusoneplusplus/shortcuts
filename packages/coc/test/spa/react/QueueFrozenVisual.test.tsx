/**
 * Tests for frozen task visual effect in queue task cards.
 * Covers QueueTaskItem (ActivityListPane) and QueueTaskCard (ProcessesSidebar).
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';
import * as fs from 'fs';
import * as path from 'path';

const REPOS_DIR = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos');
const ACTIVITY_LIST_PANE_SOURCE = fs.readFileSync(path.join(REPOS_DIR, 'ActivityListPane.tsx'), 'utf-8');
const SIDEBAR_DIR = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'processes');
const SIDEBAR_SOURCE = fs.readFileSync(path.join(SIDEBAR_DIR, 'ProcessesSidebar.tsx'), 'utf-8');
const CSS_PATH = path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'tailwind.css');
const CSS_SOURCE = fs.readFileSync(CSS_PATH, 'utf-8');

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

// ── CSS: .task-frozen class ────────────────────────────────────────────

describe('Frozen task CSS', () => {
    it('defines .task-frozen class in tailwind.css', () => {
        expect(CSS_SOURCE).toContain('.task-frozen');
    });

    it('defines frost-shimmer keyframes animation', () => {
        expect(CSS_SOURCE).toContain('@keyframes frost-shimmer');
    });

    it('.task-frozen uses animation', () => {
        expect(CSS_SOURCE).toContain('animation: frost-shimmer');
    });

    it('defines dark mode variant for .task-frozen', () => {
        expect(CSS_SOURCE).toContain('.dark .task-frozen');
    });
});

// ── QueueTaskItem (ActivityListPane) ───────────────────────────────────

describe('QueueTaskItem frozen visual', () => {
    it('applies task-frozen class when task.frozen is true', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("task.frozen && \"task-frozen\"");
    });

    it('shows ❄️ icon instead of regular icon when frozen', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).toContain("task.frozen ? '❄️' : icon");
    });

    it('does not use opacity-60 italic for frozen tasks', () => {
        expect(ACTIVITY_LIST_PANE_SOURCE).not.toContain('opacity-60 italic');
    });
});

// ── QueueTaskCard (ProcessesSidebar) ──────────────────────────────────

describe('QueueTaskCard frozen visual', () => {
    it('applies task-frozen class when task.frozen is true', () => {
        expect(SIDEBAR_SOURCE).toContain("task.frozen && 'task-frozen'");
    });

    it('shows ❄️ icon in compact layout when frozen', () => {
        expect(SIDEBAR_SOURCE).toContain("task.frozen ? '❄️' : statusIcon(task.status)");
    });

    it('shows Frozen label in full layout badge when frozen', () => {
        expect(SIDEBAR_SOURCE).toContain("task.frozen ? 'Frozen' : statusLabel(task.status)");
    });
});

// ── ProcessesSidebar: frozen task renders with .task-frozen ───────────

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
});
