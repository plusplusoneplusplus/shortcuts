/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

const getTasks = vi.fn();
const patchTask = vi.fn();
const addTask = vi.fn();
const archiveTasks = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ myWork: { getTasks, patchTask, addTask, archiveTasks } }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import { MyWorkTodayTab } from '../../../../../../src/server/spa/client/react/features/my-work/MyWorkTodayTab';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE = {
    actionItems: [
        { id: 'a1', text: 'Ship the parser', checked: false },
        { id: 'a2', text: 'Write the docs', checked: true },
    ],
    followUps: [
        { id: 'f1', text: 'Design sign-off', checked: false, person: 'Alice' },
        { id: 'f2', text: 'Budget approval', checked: false, person: 'Bob' },
        { id: 'f3', text: 'Second ask', checked: false, person: 'Alice' },
    ],
};

function renderTab(props: Partial<{ workspaceId: string; active: boolean }> = {}) {
    return render(<MyWorkTodayTab workspaceId="my_work" active {...props} />);
}

/**
 * Open the collapsed "Everything else" bucket. Non-urgent items (checked, or
 * synced recently) live behind the disclosure, so assertions about them have to
 * expand it first.
 */
async function expandEverythingElse() {
    fireEvent.click(await screen.findByTestId('my-work-today-everything-else-toggle'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MyWorkTodayTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTasks.mockResolvedValue(SAMPLE);
        patchTask.mockResolvedValue({ ok: true });
        addTask.mockResolvedValue({ id: 'new-id' });
        location.hash = '';
    });

    it('shows a loading state before tasks resolve, then renders lists', async () => {
        let resolve!: (v: unknown) => void;
        getTasks.mockReturnValueOnce(new Promise(r => { resolve = r; }));
        renderTab();

        expect(screen.getByTestId('my-work-today-loading')).toBeTruthy();

        resolve(SAMPLE);
        await waitFor(() => expect(screen.queryByTestId('my-work-today-loading')).toBeNull());
        expect(screen.getByText('Ship the parser')).toBeTruthy();
    });

    it('does not fetch until the tab is active', () => {
        renderTab({ active: false });
        expect(getTasks).not.toHaveBeenCalled();
    });

    it('renders action items and follow-ups grouped by person', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        expect(screen.getByTestId('my-work-today-action-a1')).toBeTruthy();
        // a2 is checked, so it sits in the collapsed bucket.
        await expandEverythingElse();
        expect(screen.getByTestId('my-work-today-action-a2')).toBeTruthy();
        // Follow-ups grouped by person (Alice appears once as a group).
        expect(screen.getByTestId('my-work-today-person-Alice')).toBeTruthy();
        expect(screen.getByTestId('my-work-today-person-Bob')).toBeTruthy();
        const alice = screen.getByTestId('my-work-today-person-Alice');
        expect(alice.querySelectorAll('li').length).toBe(2); // f1 + f3
    });

    it('shows a done/total stat computed from action items', async () => {
        renderTab();
        await screen.findByText('Ship the parser');
        expect(screen.getByTestId('my-work-today-stat').textContent).toBe('1/2 done');
    });

    it('shows an empty state when there are no tasks', async () => {
        getTasks.mockResolvedValue({ actionItems: [], followUps: [] });
        renderTab();
        expect(await screen.findByTestId('my-work-today-empty')).toBeTruthy();
    });

    it('shows an inline error with a working retry when the fetch fails', async () => {
        getTasks.mockRejectedValueOnce(new Error('boom'));
        renderTab();

        expect(await screen.findByTestId('my-work-today-error')).toBeTruthy();
        // Retry re-fetches (this time succeeds) and clears the error.
        fireEvent.click(screen.getByTestId('my-work-today-retry'));
        await waitFor(() => expect(screen.queryByTestId('my-work-today-error')).toBeNull());
        expect(screen.getByText('Ship the parser')).toBeTruthy();
        expect(getTasks).toHaveBeenCalledTimes(2);
    });

    it('toggling an item optimistically checks it, PATCHes, and refetches', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        const checkbox = screen.getByTestId('my-work-today-check-a1') as HTMLInputElement;
        expect(checkbox.checked).toBe(false);

        fireEvent.click(checkbox);

        expect(patchTask).toHaveBeenCalledWith('a1', { checked: true });
        // Refetch happens after the PATCH resolves.
        await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
    });

    it('rolls the toggle back and shows an inline error when PATCH fails', async () => {
        patchTask.mockRejectedValueOnce(new Error('nope'));
        renderTab();
        await screen.findByText('Ship the parser');

        const checkbox = screen.getByTestId('my-work-today-check-a1') as HTMLInputElement;
        fireEvent.click(checkbox);

        await screen.findByTestId('my-work-today-error');
        // Rolled back to unchecked; no refetch triggered by the failed PATCH.
        await waitFor(() => {
            const cb = screen.getByTestId('my-work-today-check-a1') as HTMLInputElement;
            expect(cb.checked).toBe(false);
        });
        expect(getTasks).toHaveBeenCalledTimes(1);
    });

    it('quick-add posts to the action list, clears the input, and refetches', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        const input = screen.getByTestId('my-work-today-quickadd-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: 'New thing' } });
        fireEvent.click(screen.getByTestId('my-work-today-quickadd-btn'));

        expect(addTask).toHaveBeenCalledWith({ list: 'action', text: 'New thing' });
        await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
        await waitFor(() => expect((screen.getByTestId('my-work-today-quickadd-input') as HTMLInputElement).value).toBe(''));
    });

    it('empty quick-add is a no-op (button disabled, no POST)', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        const btn = screen.getByTestId('my-work-today-quickadd-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
        // Whitespace-only stays disabled too.
        fireEvent.change(screen.getByTestId('my-work-today-quickadd-input'), { target: { value: '   ' } });
        expect(btn.disabled).toBe(true);
        expect(addTask).not.toHaveBeenCalled();
    });

    it('"Open note" links use the workspace-scoped notes hash route', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        fireEvent.click(screen.getByTestId('my-work-today-open-actions'));
        expect(location.hash).toBe('#repos/my_work/notes/Action%20Items.md');
    });

    // ── Clear completed ──────────────────────────────────────────────────────

    it('hides "Clear completed" when nothing is checked', async () => {
        getTasks.mockResolvedValue({
            actionItems: [
                { id: 'a1', text: 'Ship the parser', checked: false },
                { id: 'a2', text: 'Write the docs', checked: false },
            ],
            followUps: [],
        });
        renderTab();
        await screen.findByText('Ship the parser');
        expect(screen.queryByTestId('my-work-today-clear-completed')).toBeNull();
    });

    it('shows "Clear completed" when at least one action item is checked', async () => {
        renderTab();
        await screen.findByText('Ship the parser');
        // SAMPLE has a2 checked → the button renders.
        expect(screen.getByTestId('my-work-today-clear-completed')).toBeTruthy();
    });

    it('archives completed items, refetches, and updates the stat', async () => {
        const AFTER = {
            actionItems: [{ id: 'a1', text: 'Ship the parser', checked: false }],
            followUps: SAMPLE.followUps,
        };
        getTasks.mockResolvedValueOnce(SAMPLE).mockResolvedValueOnce(AFTER);
        archiveTasks.mockResolvedValueOnce({ archived: 1 });
        renderTab();
        await screen.findByText('Ship the parser');
        expect(screen.getByTestId('my-work-today-stat').textContent).toBe('1/2 done');

        fireEvent.click(screen.getByTestId('my-work-today-clear-completed'));

        expect(archiveTasks).toHaveBeenCalledTimes(1);
        // Refetch drops the archived item and refreshes the stat.
        await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText('Write the docs')).toBeNull());
        expect(screen.getByTestId('my-work-today-stat').textContent).toBe('0/1 done');
        // Last checked item gone → the button disappears after the refresh.
        expect(screen.queryByTestId('my-work-today-clear-completed')).toBeNull();
    });

    it('surfaces an inline error and keeps items when archiving fails', async () => {
        archiveTasks.mockRejectedValueOnce(new Error('archive boom'));
        renderTab();
        await screen.findByText('Ship the parser');
        await expandEverythingElse(); // the checked item lives behind the disclosure

        fireEvent.click(screen.getByTestId('my-work-today-clear-completed'));

        await screen.findByTestId('my-work-today-error');
        // Items stay rendered (no list blanking) and only the initial fetch ran.
        expect(screen.getByText('Write the docs')).toBeTruthy();
        expect(getTasks).toHaveBeenCalledTimes(1);
        // Busy cleared → the button is interactive again.
        await waitFor(() => {
            const btn = screen.getByTestId('my-work-today-clear-completed') as HTMLButtonElement;
            expect(btn.disabled).toBe(false);
        });
    });

    it('guards against a double archive while a request is in flight', async () => {
        let resolveArchive!: (v: unknown) => void;
        archiveTasks.mockReturnValueOnce(new Promise(r => { resolveArchive = r; }));
        renderTab();
        await screen.findByText('Ship the parser');

        const btn = screen.getByTestId('my-work-today-clear-completed') as HTMLButtonElement;
        fireEvent.click(btn);
        // In flight: disabled with a busy affordance.
        await waitFor(() => expect(btn.disabled).toBe(true));
        expect(btn.textContent).toBe('Clearing…');
        // A second click while disabled does not fire another archive.
        fireEvent.click(btn);
        expect(archiveTasks).toHaveBeenCalledTimes(1);

        resolveArchive({ archived: 1 });
        await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
    });

    it('gives the tab a theme-flipping default text color so item text stays legible in dark mode', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        const root = screen.getByTestId('my-work-today-tab');
        // A dark default text color for light mode, flipped light for dark mode,
        // so the inherited item text ("Ship the parser", follow-ups) is readable
        // against both backgrounds instead of dark-on-dark.
        expect(root.classList.contains('text-gray-900')).toBe(true);
        expect(root.classList.contains('dark:text-gray-100')).toBe(true);
    });

    // ── Age badge ────────────────────────────────────────────────────────────

    /** ISO date `days` before today, matching the server's `addedAt` format. */
    function daysAgo(days: number): string {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function withAges() {
        return {
            actionItems: [
                { id: 'a1', text: 'Ship the parser', checked: false, addedAt: daysAgo(3) },
                { id: 'a2', text: 'Write the docs', checked: false, addedAt: daysAgo(1) },
                { id: 'a3', text: 'Hand added', checked: false },
            ],
            followUps: [
                { id: 'f1', text: 'Design sign-off', checked: false, person: 'Alice', addedAt: daysAgo(21) },
                { id: 'f2', text: 'Budget approval', checked: false, person: 'Bob', addedAt: daysAgo(0) },
            ],
        };
    }

    it('badges items older than two days on both lists, in days then weeks', async () => {
        getTasks.mockResolvedValue(withAges());
        renderTab();
        // a1 is 3 days old — badge-worthy, but not stale enough to be urgent.
        await expandEverythingElse();

        expect(screen.getByTestId('my-work-today-age-a1').textContent).toBe('3d');
        // Waiting On is where age is the whole signal — 21 days reads as weeks.
        expect(screen.getByTestId('my-work-today-age-f1').textContent).toBe('3w');
    });

    it('omits the badge for fresh and undated items', async () => {
        getTasks.mockResolvedValue(withAges());
        renderTab();
        await expandEverythingElse();

        expect(screen.queryByTestId('my-work-today-age-a2')).toBeNull(); // 1 day old
        expect(screen.queryByTestId('my-work-today-age-a3')).toBeNull(); // no addedAt
        expect(screen.queryByTestId('my-work-today-age-f2')).toBeNull(); // synced today
    });

    it('renders no badges at all when the server sends no addedAt (unchanged view)', async () => {
        renderTab(); // SAMPLE carries no addedAt
        await screen.findByText('Ship the parser');
        expect(document.querySelectorAll('[data-testid^="my-work-today-age-"]').length).toBe(0);
    });

    it('styles "Clear completed" to match the sibling "Open note" link', async () => {
        renderTab();
        await screen.findByText('Ship the parser');

        const openNote = screen.getByTestId('my-work-today-open-actions');
        const clear = screen.getByTestId('my-work-today-clear-completed');
        // Every visual class the sibling link carries is present on the button.
        for (const cls of openNote.className.split(/\s+/)) {
            expect(clear.classList.contains(cls)).toBe(true);
        }
    });

    // ── Urgency buckets ──────────────────────────────────────────────────────

    describe('urgency buckets', () => {
        /** Testids of the `<li>` rows inside a container, in DOM order. */
        function rowIds(container: HTMLElement): string[] {
            return [...container.querySelectorAll('li')].map(li => li.getAttribute('data-testid') ?? '');
        }

        it('puts stale unchecked items in "Needs you today" and fresh ones behind the disclosure', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'old', text: 'Stale item', checked: false, addedAt: daysAgo(9) },
                    { id: 'fresh', text: 'Fresh item', checked: false, addedAt: daysAgo(1) },
                ],
                followUps: [],
            });
            renderTab();

            const needsYou = await screen.findByTestId('my-work-today-needs-you');
            expect(rowIds(needsYou)).toEqual(['my-work-today-action-old']);
            // The fresh one is not urgent, so it is collapsed out of sight.
            expect(screen.queryByText('Fresh item')).toBeNull();

            await expandEverythingElse();
            expect(screen.getByText('Fresh item')).toBeTruthy();
        });

        it('treats a checked item as not urgent no matter how old it is', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'done', text: 'Long done', checked: true, addedAt: daysAgo(30) }],
                followUps: [],
            });
            renderTab();

            await screen.findByTestId('my-work-today-everything-else');
            expect(screen.queryByTestId('my-work-today-needs-you')).toBeNull();
        });

        it('keeps hand-added (undated) items in "Needs you today" rather than burying them', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'hand', text: 'Typed by hand', checked: false }],
                followUps: [],
            });
            renderTab();

            const needsYou = await screen.findByTestId('my-work-today-needs-you');
            expect(rowIds(needsYou)).toEqual(['my-work-today-action-hand']);
            expect(screen.queryByTestId('my-work-today-everything-else')).toBeNull();
        });

        it('orders Waiting On oldest first, both across person groups and within one', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [
                    // Deliberately out of age order in the file.
                    { id: 'f1', text: 'Alice newer', checked: false, person: 'Alice', addedAt: daysAgo(3) },
                    { id: 'f2', text: 'Bob mid', checked: false, person: 'Bob', addedAt: daysAgo(12) },
                    { id: 'f3', text: 'Alice oldest', checked: false, person: 'Alice', addedAt: daysAgo(20) },
                    { id: 'f4', text: 'Cara undated', checked: false, person: 'Cara' },
                ],
            });
            renderTab();

            const section = await screen.findByTestId('my-work-today-followups');
            // Groups rank by their oldest item; the undated group sorts last.
            const groups = [...section.querySelectorAll('[data-testid^="my-work-today-person-"]')]
                .map(el => el.getAttribute('data-testid'));
            expect(groups).toEqual([
                'my-work-today-person-Alice', // 20d
                'my-work-today-person-Bob',   // 12d
                'my-work-today-person-Cara',  // undated
            ]);
            // And within Alice, the 20d item precedes the 3d one.
            expect(rowIds(screen.getByTestId('my-work-today-person-Alice'))).toEqual([
                'my-work-today-followup-f3',
                'my-work-today-followup-f1',
            ]);
        });

        it('sorts undated follow-ups last within a group, keeping file order among ties', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [
                    { id: 'u1', text: 'Undated first in file', checked: false, person: 'Alice' },
                    { id: 'd1', text: 'Dated', checked: false, person: 'Alice', addedAt: daysAgo(5) },
                    { id: 'u2', text: 'Undated second in file', checked: false, person: 'Alice' },
                ],
            });
            renderTab();

            const alice = await screen.findByTestId('my-work-today-person-Alice');
            expect(rowIds(alice)).toEqual([
                'my-work-today-followup-d1', // dated items outrank undated ones
                'my-work-today-followup-u1', // ties keep the order the note lists
                'my-work-today-followup-u2',
            ]);
        });

        it('collapses "Everything else" by default and expands it on click', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'a1', text: 'Fresh one', checked: false, addedAt: daysAgo(0) },
                    { id: 'a2', text: 'Fresh two', checked: true, addedAt: daysAgo(1) },
                ],
                followUps: [],
            });
            renderTab();

            const toggle = await screen.findByTestId('my-work-today-everything-else-toggle');
            // Collapsed by default, with a count so the hidden volume is visible.
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            expect(toggle.textContent).toContain('Everything else (2)');
            expect(screen.queryByText('Fresh one')).toBeNull();

            fireEvent.click(toggle);

            expect(toggle.getAttribute('aria-expanded')).toBe('true');
            expect(screen.getByText('Fresh one')).toBeTruthy();
            expect(screen.getByText('Fresh two')).toBeTruthy();

            // And it collapses again.
            fireEvent.click(toggle);
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            expect(screen.queryByText('Fresh one')).toBeNull();
        });

        it('renders nothing at all for an empty bucket — no stray header', async () => {
            // Every item is urgent: no follow-ups, nothing left over.
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'a1', text: 'Stale item', checked: false, addedAt: daysAgo(9) }],
                followUps: [],
            });
            renderTab();

            await screen.findByTestId('my-work-today-needs-you');
            expect(screen.queryByTestId('my-work-today-followups')).toBeNull();
            expect(screen.queryByText('Waiting on others')).toBeNull();
            expect(screen.queryByTestId('my-work-today-everything-else')).toBeNull();
            expect(screen.queryByTestId('my-work-today-everything-else-toggle')).toBeNull();
            expect(screen.queryByText(/Everything else/)).toBeNull();
        });

        it('omits the "Needs you today" header when nothing is urgent', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'a1', text: 'Fresh item', checked: false, addedAt: daysAgo(1) }],
                followUps: [{ id: 'f1', text: 'Waiting', checked: false, person: 'Alice' }],
            });
            renderTab();

            await screen.findByTestId('my-work-today-followups');
            expect(screen.queryByTestId('my-work-today-needs-you')).toBeNull();
            expect(screen.queryByText('Needs you today')).toBeNull();
        });

        it('keeps the list-level controls reachable when the urgent bucket is empty', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'a1', text: 'Fresh done', checked: true, addedAt: daysAgo(1) }],
                followUps: [],
            });
            renderTab();

            // Nothing urgent, everything collapsed — but archiving and the note
            // links must not disappear with the section that used to host them.
            await screen.findByTestId('my-work-today-everything-else');
            expect(screen.queryByTestId('my-work-today-needs-you')).toBeNull();
            expect(screen.getByTestId('my-work-today-clear-completed')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-open-actions')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-open-followups')).toBeTruthy();
        });

        it('toggling still works on a row inside the collapsed bucket', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'a1', text: 'Fresh item', checked: false, addedAt: daysAgo(1) }],
                followUps: [],
            });
            renderTab();
            await expandEverythingElse();

            fireEvent.click(screen.getByTestId('my-work-today-check-a1'));

            expect(patchTask).toHaveBeenCalledWith('a1', { checked: true });
            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
        });
    });
});
