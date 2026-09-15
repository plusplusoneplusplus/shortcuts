/**
 * Regression: clicking a note used to be swallowed if the click landed between
 * the list's commit and the auto-select effect's flush.
 *
 * DockNotesPanel auto-selects the first note whenever the visible list changes.
 * React commits a new list in one scheduler task and flushes that effect in a
 * later one, so there is a window where the list is on screen with nothing
 * selected yet. A click in that window queued `setSelectedPath(clicked)`, then
 * the pending effect — which had closed over the *old* selection (null) — queued
 * `setSelectedPath(first)` behind it and won. The panel snapped back to the first
 * note, which CI hit as an intermittent failure in DockNotesPanel.test.tsx.
 *
 * The window is real but narrow, so this test opens it on purpose: React's
 * scheduler is stepped one task at a time, and its clock is pushed past the 5ms
 * slice budget once the list is in the DOM so it yields before running the
 * effect. The test asserts it actually reached that state, so it fails loudly
 * rather than passing for free if React's scheduling ever changes.
 *
 * @vitest-environment jsdom
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const getTree = vi.fn();
const getContent = vi.fn();
const createNode = vi.fn();

vi.mock('../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        getTree: (...args: any[]) => getTree(...args),
        getContent: (...args: any[]) => getContent(...args),
        createNode: (...args: any[]) => createNode(...args),
    },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content, loading }: { content: string; loading?: boolean }) => ({
        html: loading ? '' : content,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/ui', () => ({
    cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

// React's scheduler grabs `setImmediate` when it loads, so this has to be in
// place before React is imported — hence the dynamic imports below. Only the
// scheduler's own callback is intercepted; everything else passes through.
const schedulerTasks: Array<() => void> = [];
const realSetImmediate = globalThis.setImmediate;
(globalThis as any).setImmediate = (fn: (...a: any[]) => void, ...rest: any[]) => {
    if (fn?.name === 'performWorkUntilDeadline') {
        schedulerTasks.push(fn as () => void);
        return 0;
    }
    return (realSetImmediate as any)(fn, ...rest);
};
afterAll(() => { (globalThis as any).setImmediate = realSetImmediate; });

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { DockNotesPanel } = await import(
    '../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel'
);

/** Runs one queued scheduler task; returns false when the queue is empty. */
function stepScheduler(): boolean {
    const task = schedulerTasks.shift();
    if (!task) return false;
    task();
    return true;
}

function drainScheduler(): void {
    while (stepScheduler()) { /* keep going */ }
}

const TREE = [
    {
        name: 'Plans',
        path: 'Plans',
        type: 'notebook',
        children: [
            { name: 'MLA cache.md', path: 'Plans/MLA cache.md', type: 'page', lastModifiedAt: '2026-08-25T10:00:00.000Z' },
        ],
    },
    { name: 'batching.md', path: 'batching.md', type: 'page', lastModifiedAt: '2026-08-20T10:00:00.000Z' },
];

function items(): HTMLElement[] {
    return screen.queryAllByTestId('workspace-dock-notes-item');
}

function selectionFlags(): string[] {
    return items().map(el => el.getAttribute('aria-selected')!);
}

describe('DockNotesPanel selection race', () => {
    beforeEach(() => {
        schedulerTasks.length = 0;
        getTree.mockReset();
        getContent.mockReset().mockImplementation((_ws: string, notePath: string) =>
            Promise.resolve({ content: `body of ${notePath}`, path: notePath, mtime: 1 }));
        createNode.mockReset();
    });

    it('keeps a click that lands before the auto-select effect has flushed', async () => {
        let resolveTree!: (value: unknown) => void;
        getTree.mockImplementation(() => new Promise(resolve => { resolveTree = resolve; }));

        // Drive React off the act queue so its real scheduler does the work.
        const wasActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = false;
        try {
            render(<DockNotesPanel workspaceId="ws1" />);
            drainScheduler();

            resolveTree({ tree: TREE, notesRoot: '/notes' });
            // Let the getTree continuation run and queue React's render.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            // Make the scheduler run out of slice as soon as the list is on
            // screen, so it yields with the auto-select effect still pending.
            const realNow = performance.now.bind(performance);
            let clock = 0;
            let listCommitted = false;
            (performance as any).now = () => {
                if (!listCommitted && document.querySelectorAll('[data-note-path]').length === 2) {
                    listCommitted = true;
                    clock = realNow();
                }
                if (listCommitted) {
                    clock += 10; // past the 5ms slice budget → yield
                    return clock;
                }
                return realNow();
            };
            try {
                stepScheduler();
            } finally {
                (performance as any).now = realNow;
            }

            // The window this regression is about: notes listed, none selected.
            expect(items()).toHaveLength(2);
            expect(selectionFlags()).toEqual(['false', 'false']);
            expect(schedulerTasks.length).toBeGreaterThan(0);

            fireEvent.click(items()[1]);
            drainScheduler();
            await new Promise(resolve => (realSetImmediate as any)(resolve));
            drainScheduler();

            expect(selectionFlags()).toEqual(['false', 'true']);
            expect(screen.getByTestId('workspace-dock-notes-preview').textContent)
                .toBe('body of batching.md');
        } finally {
            (globalThis as any).IS_REACT_ACT_ENVIRONMENT = wasActEnvironment;
            cleanup();
        }
    });
});
