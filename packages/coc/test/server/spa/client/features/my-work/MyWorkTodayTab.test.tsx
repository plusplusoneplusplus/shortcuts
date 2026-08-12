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
const syncMyWork = vi.fn();
const getTimeline = vi.fn();

vi.mock('../../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        myWork: { getTasks, patchTask, addTask, archiveTasks, getTimeline },
        repos: { syncMyWork },
    }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));

import { MyWorkTodayTab } from '../../../../../../src/server/spa/client/react/features/my-work/MyWorkTodayTab';
import { QueueProvider, useQueueOptional } from '../../../../../../src/server/spa/client/react/contexts/QueueContext';

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

/**
 * Expand a person's roll-up in "Waiting on others". Groups collapse to a
 * summary line by default, so any assertion about individual follow-up rows has
 * to open the group first.
 */
async function expandPerson(person = 'Alice') {
    fireEvent.click(await screen.findByTestId(`my-work-today-person-toggle-${person}`));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MyWorkTodayTab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTasks.mockResolvedValue(SAMPLE);
        patchTask.mockResolvedValue({ ok: true });
        addTask.mockResolvedValue({ id: 'new-id' });
        syncMyWork.mockResolvedValue({ actionItemCount: 2, followUpCount: 0 });
        // Nothing writes the timeline note yet, so "no entries" is the default
        // every other test in this file runs against.
        getTimeline.mockResolvedValue({ entries: [], total: 0, notePath: 'Work/timeline.md' });
        sessionStorage.clear(); // the strip's dismissal is session-scoped
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
        // Collapsed by default — the rows appear once the group is opened.
        const alice = screen.getByTestId('my-work-today-person-Alice');
        expect(alice.querySelectorAll('li').length).toBe(0);
        await expandPerson('Alice');
        expect(alice.querySelectorAll('li').length).toBe(2); // f1 + f3
    });

    it('shows no stat chip when nothing is overdue, due or stalled', async () => {
        // SAMPLE carries no dates at all, so there is no triage state to report
        // — and the chip stays away rather than reporting a done-count.
        renderTab();
        await screen.findByText('Ship the parser');
        expect(screen.queryByTestId('my-work-today-stat')).toBeNull();
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

    it('archives completed items and refetches', async () => {
        const AFTER = {
            actionItems: [{ id: 'a1', text: 'Ship the parser', checked: false }],
            followUps: SAMPLE.followUps,
        };
        getTasks.mockResolvedValueOnce(SAMPLE).mockResolvedValueOnce(AFTER);
        archiveTasks.mockResolvedValueOnce({ archived: 1 });
        renderTab();
        await screen.findByText('Ship the parser');

        fireEvent.click(screen.getByTestId('my-work-today-clear-completed'));

        expect(archiveTasks).toHaveBeenCalledTimes(1);
        // Refetch drops the archived item.
        await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByText('Write the docs')).toBeNull());
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
        await expandPerson('Alice');
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
            // `div` scopes this to the group containers — the roll-up's toggle
            // buttons share the `my-work-today-person-` testid stem.
            const groups = [...section.querySelectorAll('div[data-testid^="my-work-today-person-"]')]
                .map(el => el.getAttribute('data-testid'));
            expect(groups).toEqual([
                'my-work-today-person-Alice', // 20d
                'my-work-today-person-Bob',   // 12d
                'my-work-today-person-Cara',  // undated
            ]);
            // And within Alice, the 20d item precedes the 3d one.
            await expandPerson('Alice');
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
            await expandPerson('Alice');
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

        it('due dates decide urgency on their own, overriding age', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    // Overdue, and young enough that age alone would hide it.
                    { id: 'late', text: 'Overdue item', checked: false, addedAt: daysAgo(0), due: isoIn(-2) },
                    { id: 'today', text: 'Due today', checked: false, addedAt: daysAgo(0), due: isoIn(0) },
                    // Old enough to be urgent by age, but explicitly due later.
                    { id: 'later', text: 'Due next month', checked: false, addedAt: daysAgo(30), due: isoIn(30) },
                ],
                followUps: [],
            });
            renderTab();

            const needsYou = await screen.findByTestId('my-work-today-needs-you');
            expect(rowIds(needsYou)).toEqual([
                'my-work-today-action-late',
                'my-work-today-action-today',
            ]);
            expect(screen.queryByText('Due next month')).toBeNull();
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
    /** ISO date `days` from today (negative for the past). */
    function isoIn(days: number): string {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // ── Inline metadata ──────────────────────────────────────────────────────

    describe('inline metadata', () => {
        const WITH_META = {
            actionItems: [
                {
                    id: 'a1',
                    text: 'Send revised cutover plan',
                    checked: false,
                    due: isoIn(0),
                    tags: ['contoso', 'urgent'],
                    sourceUrl: 'https://teams.microsoft.com/l/message/19:abc',
                },
            ],
            followUps: [],
        };

        it('renders a due chip, tag pills and a source link', async () => {
            getTasks.mockResolvedValue(WITH_META);
            renderTab();

            await screen.findByText('Send revised cutover plan');
            expect(screen.getByTestId('my-work-today-due-a1')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-tag-a1-contoso').textContent).toBe('#contoso');
            expect(screen.getByTestId('my-work-today-tag-a1-urgent').textContent).toBe('#urgent');

            const link = screen.getByTestId('my-work-today-source-a1') as HTMLAnchorElement;
            expect(link.getAttribute('href')).toBe('https://teams.microsoft.com/l/message/19:abc');
            expect(link.getAttribute('target')).toBe('_blank');
            // No opener handle back into the dashboard.
            expect(link.getAttribute('rel')).toContain('noopener');
            expect(link.getAttribute('aria-label')).toBe('Open source');
        });

        it('keeps the raw @due / #tag syntax out of the rendered text', async () => {
            getTasks.mockResolvedValue(WITH_META);
            renderTab();

            const row = await screen.findByTestId('my-work-today-action-a1');
            expect(row.textContent).not.toContain('@due(');
            expect(row.textContent).not.toContain('](http');
        });

        it('clicking the source link does not toggle the checkbox', async () => {
            getTasks.mockResolvedValue(WITH_META);
            renderTab();

            const link = await screen.findByTestId('my-work-today-source-a1');
            fireEvent.click(link);

            // The link sits outside the row's <label>, so no toggle is fired.
            expect(patchTask).not.toHaveBeenCalled();
            expect((screen.getByTestId('my-work-today-check-a1') as HTMLInputElement).checked).toBe(false);
        });

        it('gives the link a real hit area rather than the bare glyph', async () => {
            getTasks.mockResolvedValue(WITH_META);
            renderTab();

            const link = await screen.findByTestId('my-work-today-source-a1');
            // Horizontal and vertical padding so the target is comfortably
            // clickable — this is the affordance the whole feature hangs on.
            expect(link.className).toMatch(/\bpx-2\b/);
            expect(link.className).toMatch(/\bpy-/);
        });

        it('labels overdue, today and later due dates distinctly', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'late', text: 'Late', checked: false, due: isoIn(-3) },
                    { id: 'today', text: 'Today', checked: false, due: isoIn(0) },
                    { id: 'tmrw', text: 'Tomorrow', checked: false, due: isoIn(1) },
                ],
                followUps: [],
            });
            renderTab();

            await screen.findByText('Late');
            // Tomorrow is not urgent, so that row sits in the collapsed bucket.
            await expandEverythingElse();
            const late = screen.getByTestId('my-work-today-due-late');
            expect(late.textContent).toBe('3d late');
            expect(late.getAttribute('data-tone')).toBe('overdue');
            expect(screen.getByTestId('my-work-today-due-today').textContent).toBe('Today');
            expect(screen.getByTestId('my-work-today-due-today').getAttribute('data-tone')).toBe('today');
            expect(screen.getByTestId('my-work-today-due-tmrw').textContent).toBe('Tomorrow');
        });

        it('renders metadata on follow-up rows too', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [
                    {
                        id: 'f1',
                        text: 'Cutover sign-off',
                        checked: false,
                        person: 'Priya',
                        sourceUrl: 'https://x.test/p',
                        tags: ['contoso'],
                    },
                ],
            });
            renderTab();

            await expandPerson('Priya');
            expect(screen.getByTestId('my-work-today-source-f1')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-tag-f1-contoso')).toBeTruthy();
        });

        it('renders no chips at all when the server sends no metadata (unchanged view)', async () => {
            renderTab(); // SAMPLE carries none
            await screen.findByText('Ship the parser');
            expect(document.querySelectorAll('[data-testid^="my-work-today-due-"]').length).toBe(0);
            expect(document.querySelectorAll('[data-testid^="my-work-today-tag-"]').length).toBe(0);
            expect(document.querySelectorAll('[data-testid^="my-work-today-source-"]').length).toBe(0);
        });
    });

    // ── Triage stat chip ─────────────────────────────────────────────────────

    describe('triage stat chip', () => {
        it('reports overdue, due-today and long-waiting counts across both lists', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'o1', text: 'Late one', checked: false, due: isoIn(-3) },
                    { id: 'o2', text: 'Late two', checked: false, due: isoIn(-1) },
                    { id: 't1', text: 'Due now', checked: false, due: isoIn(0) },
                ],
                followUps: [
                    // A dated follow-up counts as overdue just like an action item.
                    { id: 'f1', text: 'Priya sign-off', checked: false, person: 'Priya', due: isoIn(-5), addedAt: daysAgo(9) },
                    { id: 'f2', text: 'Bob budget', checked: false, person: 'Bob', addedAt: daysAgo(8) },
                    { id: 'f3', text: 'Cara fresh', checked: false, person: 'Cara', addedAt: daysAgo(2) },
                ],
            });
            renderTab();

            await screen.findByText('Late one');
            expect(screen.getByTestId('my-work-today-stat').textContent)
                .toBe('3 overdue · 1 due today · 2 waiting >7d');
        });

        it('omits zero-valued segments rather than rendering "0 overdue"', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 't1', text: 'Due now', checked: false, due: isoIn(0) }],
                followUps: [],
            });
            renderTab();

            await screen.findByText('Due now');
            expect(screen.getByTestId('my-work-today-stat').textContent).toBe('1 due today');
        });

        it('ignores checked items in every segment', async () => {
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'o1', text: 'Done but late', checked: true, due: isoIn(-3) }],
                followUps: [
                    { id: 'f1', text: 'Done wait', checked: true, person: 'Priya', addedAt: daysAgo(30) },
                ],
            });
            renderTab();

            // Both items are checked, so both sit behind the disclosure.
            await screen.findByTestId('my-work-today-everything-else-toggle');
            expect(screen.queryByTestId('my-work-today-stat')).toBeNull();
        });

        it('never shows a done-count progress stat', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'a1', text: 'Open', checked: false, due: isoIn(-1) },
                    { id: 'a2', text: 'Closed', checked: true },
                ],
                followUps: [],
            });
            renderTab();

            await screen.findByText('Open');
            expect(screen.getByTestId('my-work-today-stat').textContent).not.toMatch(/done/);
        });
    });

    // ── Snooze ───────────────────────────────────────────────────────────────

    describe('snooze', () => {
        /** The only unchecked, undated item — so it starts in "Needs you today". */
        const ONE_ITEM = {
            actionItems: [{ id: 'a1', text: 'Ship the parser', checked: false }],
            followUps: [],
        };

        async function openSnoozeMenu(id = 'a1') {
            fireEvent.click(await screen.findByTestId(`my-work-today-snooze-${id}`));
            return screen.getByTestId(`my-work-today-snooze-menu-${id}`);
        }

        it('keeps the menu closed until the snooze button is clicked', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            await screen.findByText('Ship the parser');

            expect(screen.queryByTestId('my-work-today-snooze-menu-a1')).toBeNull();
            await openSnoozeMenu();
            expect(screen.getByTestId('my-work-today-snooze-menu-a1')).toBeTruthy();
        });

        it('bumps the due date to tomorrow and refetches', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            await openSnoozeMenu();

            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-tomorrow'));

            expect(patchTask).toHaveBeenCalledWith('a1', { due: isoIn(1) });
            // The bump rewrites the line, so the id map has to be refreshed.
            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
            // The menu closes behind the choice.
            expect(screen.queryByTestId('my-work-today-snooze-menu-a1')).toBeNull();
        });

        it('offers next week as the second one-click target', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            await openSnoozeMenu();

            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-next-week'));
            expect(patchTask).toHaveBeenCalledWith('a1', { due: isoIn(7) });
        });

        it('takes an arbitrary date from the picker', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            await openSnoozeMenu();

            fireEvent.change(screen.getByTestId('my-work-today-snooze-a1-date'), {
                target: { value: '2026-12-24' },
            });
            expect(patchTask).toHaveBeenCalledWith('a1', { due: '2026-12-24' });
        });

        it('drops the snoozed item out of "Needs you today" once the refetch lands', async () => {
            // The refetch is the real assertion here: the server rewrote the
            // line, so the item comes back with a new id and a future due date,
            // which is what moves it out of the urgent bucket.
            getTasks
                .mockResolvedValueOnce(ONE_ITEM)
                .mockResolvedValueOnce({
                    actionItems: [{ id: 'a1-new', text: 'Ship the parser', checked: false, due: isoIn(1) }],
                    followUps: [],
                });
            renderTab();
            await openSnoozeMenu();

            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-tomorrow'));

            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
            await waitFor(() => expect(screen.queryByTestId('my-work-today-needs-you')).toBeNull());
            // Not gone — collapsed. It comes back on its own when it is due.
            expect(screen.getByTestId('my-work-today-everything-else-toggle').textContent)
                .toContain('Everything else (1)');
        });

        it('snoozes a follow-up too', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [{ id: 'f1', text: 'Cutover sign-off', checked: false, person: 'Priya' }],
            });
            renderTab();
            await expandPerson('Priya');
            await openSnoozeMenu('f1');

            fireEvent.click(screen.getByTestId('my-work-today-snooze-f1-tomorrow'));
            expect(patchTask).toHaveBeenCalledWith('f1', { due: isoIn(1) });
        });

        it('rolls back and shows an inline error when the snooze PATCH fails', async () => {
            patchTask.mockRejectedValueOnce(new Error('nope'));
            getTasks.mockResolvedValue({
                actionItems: [{ id: 'a1', text: 'Ship the parser', checked: false, due: isoIn(-2) }],
                followUps: [],
            });
            renderTab();
            await openSnoozeMenu();

            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-tomorrow'));

            await screen.findByTestId('my-work-today-error');
            // The list stays on screen and the optimistic bump is undone — the
            // chip reads overdue again, matching what is still on disk.
            expect(screen.getByText('Ship the parser')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-due-a1').getAttribute('data-tone')).toBe('overdue');
            expect(getTasks).toHaveBeenCalledTimes(1); // no refetch after a failed write
        });

        it('takes the row out of the urgent bucket the moment it is picked, before the write lands', async () => {
            // The optimistic due date reflows the buckets immediately, so the
            // row is gone from "Needs you today" while the PATCH is still in
            // flight — snoozing feels instant rather than waiting on the disk.
            patchTask.mockReturnValueOnce(new Promise(() => { /* never settles */ }));
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            await openSnoozeMenu();

            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-tomorrow'));

            await waitFor(() => expect(screen.queryByTestId('my-work-today-needs-you')).toBeNull());
            expect(getTasks).toHaveBeenCalledTimes(1); // the refetch has not run yet
        });

        it('guards against a second mutation while one is in flight', async () => {
            patchTask.mockReturnValueOnce(new Promise(() => { /* never settles */ }));
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'a1', text: 'Ship the parser', checked: false },
                    { id: 'a2', text: 'Write the docs', checked: false },
                ],
                followUps: [],
            });
            renderTab();
            await openSnoozeMenu('a1');
            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-tomorrow'));

            // The other row's actions go dead while the write is outstanding, so
            // two mutations can never race for the same file.
            await waitFor(() => {
                expect((screen.getByTestId('my-work-today-snooze-a2') as HTMLButtonElement).disabled).toBe(true);
            });
            expect((screen.getByTestId('my-work-today-edit-a2') as HTMLButtonElement).disabled).toBe(true);

            fireEvent.click(screen.getByTestId('my-work-today-snooze-a2'));
            expect(screen.queryByTestId('my-work-today-snooze-menu-a2')).toBeNull();
            expect(patchTask).toHaveBeenCalledTimes(1);
        });
    });

    // ── Inline edit ──────────────────────────────────────────────────────────

    describe('inline edit', () => {
        const ONE_ITEM = {
            actionItems: [{ id: 'a1', text: 'Ship the parser', checked: false }],
            followUps: [],
        };

        async function startEditing(id = 'a1') {
            fireEvent.click(await screen.findByTestId(`my-work-today-edit-${id}`));
            return screen.getByTestId(`my-work-today-edit-input-${id}`) as HTMLInputElement;
        }

        it('opens an editor seeded with the item text', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            const input = await startEditing();
            expect(input.value).toBe('Ship the parser');
        });

        it('sends the new text on Enter and refetches under the new id', async () => {
            // The id is derived from the line's content, so rewriting the text
            // changes it — the component re-reads the list rather than trying
            // to keep the old id alive.
            getTasks
                .mockResolvedValueOnce(ONE_ITEM)
                .mockResolvedValueOnce({
                    actionItems: [{ id: 'a1-renamed', text: 'Draft the parser RFC', checked: false }],
                    followUps: [],
                });
            renderTab();
            const input = await startEditing();

            fireEvent.change(input, { target: { value: 'Draft the parser RFC' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(patchTask).toHaveBeenCalledWith('a1', { text: 'Draft the parser RFC' });
            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
            await screen.findByTestId('my-work-today-action-a1-renamed');
            expect(screen.queryByTestId('my-work-today-action-a1')).toBeNull();
            expect(screen.getByText('Draft the parser RFC')).toBeTruthy();
        });

        it('abandons the edit on Escape without writing anything', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            const input = await startEditing();

            fireEvent.change(input, { target: { value: 'Half-typed thought' } });
            fireEvent.keyDown(input, { key: 'Escape' });

            expect(patchTask).not.toHaveBeenCalled();
            expect(screen.getByText('Ship the parser')).toBeTruthy();
            expect(screen.queryByTestId('my-work-today-edit-input-a1')).toBeNull();
        });

        it('writes nothing when the text comes back unchanged or empty', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            let input = await startEditing();
            fireEvent.keyDown(input, { key: 'Enter' }); // untouched
            expect(patchTask).not.toHaveBeenCalled();

            input = await startEditing();
            fireEvent.change(input, { target: { value: '   ' } });
            fireEvent.keyDown(input, { key: 'Enter' }); // blanked
            expect(patchTask).not.toHaveBeenCalled();
        });

        it('commits on blur, so clicking away does not lose the edit', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            const input = await startEditing();

            fireEvent.change(input, { target: { value: 'Reworded' } });
            fireEvent.blur(input);

            expect(patchTask).toHaveBeenCalledWith('a1', { text: 'Reworded' });
        });

        it('edits a follow-up row the same way', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [{ id: 'f1', text: 'Cutover sign-off', checked: false, person: 'Priya' }],
            });
            renderTab();
            await expandPerson('Priya');
            const input = await startEditing('f1');

            fireEvent.change(input, { target: { value: 'Nudge Priya on cutover' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(patchTask).toHaveBeenCalledWith('f1', { text: 'Nudge Priya on cutover' });
        });

        it('rolls the text back and shows an inline error when the PATCH fails', async () => {
            patchTask.mockRejectedValueOnce(new Error('nope'));
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            const input = await startEditing();

            fireEvent.change(input, { target: { value: 'Draft the parser RFC' } });
            fireEvent.keyDown(input, { key: 'Enter' });

            await screen.findByTestId('my-work-today-error');
            // The list is still there, showing what is actually on disk.
            expect(screen.getByText('Ship the parser')).toBeTruthy();
            expect(screen.queryByText('Draft the parser RFC')).toBeNull();
            expect(getTasks).toHaveBeenCalledTimes(1);
        });

        it('starts editing on a double-click of the item text', async () => {
            getTasks.mockResolvedValue(ONE_ITEM);
            renderTab();
            fireEvent.doubleClick(await screen.findByText('Ship the parser'));

            expect(screen.getByTestId('my-work-today-edit-input-a1')).toBeTruthy();
            // The double-click must not have toggled the checkbox on its way in.
            expect(patchTask).not.toHaveBeenCalled();
        });
    });

    // ── Keyboard triage ──────────────────────────────────────────────────────

    describe('keyboard triage', () => {
        const TWO_ITEMS = {
            actionItems: [
                { id: 'a1', text: 'Ship the parser', checked: false },
                { id: 'a2', text: 'Write the docs', checked: false },
            ],
            followUps: [],
        };

        /**
         * jsdom runs no layout, so `offsetParent` is null on every element and
         * the hook's "am I a hidden keep-alive pane" guard would bail before any
         * shortcut ran. Force a truthy one so the real dispatch path is what the
         * tests exercise. (Same trick as the Ctrl+F find-scope tests.)
         */
        async function renderVisibleTab(props: Partial<{ active: boolean }> = {}) {
            const result = renderTab(props);
            const tab = await screen.findByTestId('my-work-today-tab');
            Object.defineProperty(tab, 'offsetParent', { get: () => document.body, configurable: true });
            return result;
        }

        const press = (key: string, target: Element | Document = document.body) =>
            fireEvent.keyDown(target, { key });

        const selectedIds = () =>
            [...document.querySelectorAll('[data-selected]')].map(el => el.getAttribute('data-task-id'));

        it('j and k move the selection, and the selected row is visibly marked', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            expect(selectedIds()).toEqual([]); // nothing selected until you ask

            press('j');
            expect(selectedIds()).toEqual(['a1']);
            // The marker is a real visual treatment, not just an attribute.
            expect(screen.getByTestId('my-work-today-action-a1').className).toContain('ring-2');

            press('j');
            expect(selectedIds()).toEqual(['a2']);
            press('k');
            expect(selectedIds()).toEqual(['a1']);
        });

        it('j wraps at the end of the list and k enters from the bottom', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('k'); // no selection yet → enter from the near end
            expect(selectedIds()).toEqual(['a2']);
            press('j');
            expect(selectedIds()).toEqual(['a1']);
        });

        it('only steps through rows that are actually on screen', async () => {
            // a2 is checked, so it sits inside the collapsed "Everything else".
            // Stepping onto a row nobody can see is how a selection ring gets lost.
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'a1', text: 'Ship the parser', checked: false },
                    { id: 'a2', text: 'Write the docs', checked: true },
                ],
                followUps: [],
            });
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('j'); // wraps back to a1 rather than entering the collapsed bucket
            expect(selectedIds()).toEqual(['a1']);

            await expandEverythingElse();
            press('j');
            expect(selectedIds()).toEqual(['a2']);
        });

        it('x toggles the selected row through the same handler the checkbox uses', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('x');
            expect(patchTask).toHaveBeenCalledWith('a1', { checked: true });
        });

        it('x does nothing when no row is selected', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('x');
            expect(patchTask).not.toHaveBeenCalled();
        });

        it('e opens the inline editor on the selected row', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('e');
            const input = screen.getByTestId('my-work-today-edit-input-a1') as HTMLInputElement;
            expect(input.value).toBe('Ship the parser');
        });

        it('d opens the due-date menu on the selected row', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('d');
            expect(screen.getByTestId('my-work-today-snooze-menu-a1')).toBeTruthy();
            // A picked date goes through the same write as the mouse path.
            fireEvent.click(screen.getByTestId('my-work-today-snooze-a1-next-week'));
            expect(patchTask).toHaveBeenCalledWith('a1', { due: isoIn(7) });
        });

        it('s defers the selected row by a day without opening anything', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('s');
            expect(patchTask).toHaveBeenCalledWith('a1', { due: isoIn(1) });
            expect(screen.queryByTestId('my-work-today-snooze-menu-a1')).toBeNull();
        });

        it('an open due menu owns the keyboard — s does not also snooze behind it', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('d');
            press('s');
            expect(patchTask).not.toHaveBeenCalled();
            // Escape closes it and hands the keyboard back.
            press('Escape');
            expect(screen.queryByTestId('my-work-today-snooze-menu-a1')).toBeNull();
            press('s');
            expect(patchTask).toHaveBeenCalledWith('a1', { due: isoIn(1) });
        });

        it('/ focuses the filter box', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('/');
            expect(document.activeElement).toBe(screen.getByTestId('my-work-today-filter'));
        });

        it('Escape drops the selection', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            expect(selectedIds()).toEqual(['a1']);
            press('Escape');
            expect(selectedIds()).toEqual([]);
        });

        it('does not fire while the quick-add input has focus', async () => {
            // Typing "extra" in the box must not toggle, edit and snooze things.
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j'); // select a row so the action keys would have a target
            const quickAdd = screen.getByTestId('my-work-today-quickadd-input');
            for (const key of ['e', 'x', 't', 'r', 'a', 'j', 's', 'd', '/']) press(key, quickAdd);

            expect(patchTask).not.toHaveBeenCalled();
            expect(screen.queryByTestId('my-work-today-edit-input-a1')).toBeNull();
            expect(screen.queryByTestId('my-work-today-snooze-menu-a1')).toBeNull();
            expect(selectedIds()).toEqual(['a1']); // j did not move it either
        });

        it('does not fire while an inline editor has focus', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            press('e');
            const editor = screen.getByTestId('my-work-today-edit-input-a1');
            for (const key of ['x', 'j', 's']) press(key, editor);

            expect(patchTask).not.toHaveBeenCalled();
            expect(selectedIds()).toEqual(['a1']);
            // Still editing — none of those keys escaped the field.
            expect(screen.getByTestId('my-work-today-edit-input-a1')).toBeTruthy();
        });

        it('does not fire while the filter box has focus', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            const filter = screen.getByTestId('my-work-today-filter');
            press('x', filter);
            expect(patchTask).not.toHaveBeenCalled();
        });

        it('ignores chorded keys so app and browser shortcuts still work', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            press('j');
            fireEvent.keyDown(document.body, { key: 'x', ctrlKey: true });
            fireEvent.keyDown(document.body, { key: 'j', metaKey: true });
            fireEvent.keyDown(document.body, { key: 's', altKey: true });
            expect(patchTask).not.toHaveBeenCalled();
            expect(selectedIds()).toEqual(['a1']);
        });

        it('stays inert while the tab is not the active sub-tab', async () => {
            // The tab is a keep-alive pane: it stays mounted under display:none
            // while the user is on Notes or Activity, and must not eat their keys.
            getTasks.mockResolvedValue(TWO_ITEMS);
            const { rerender } = await renderVisibleTab();
            await screen.findByText('Ship the parser');

            rerender(<MyWorkTodayTab workspaceId="my_work" active={false} />);
            press('j');
            press('x');
            expect(selectedIds()).toEqual([]);
            expect(patchTask).not.toHaveBeenCalled();
        });

        it('stays inert when the pane is hidden even if it is nominally active', async () => {
            getTasks.mockResolvedValue(TWO_ITEMS);
            renderTab(); // no offsetParent override → hidden as far as the guard knows
            await screen.findByText('Ship the parser');

            press('j');
            expect(selectedIds()).toEqual([]);
        });

        it('tears the listener down on unmount rather than leaking a global handler', async () => {
            const addSpy = vi.spyOn(document, 'addEventListener');
            const removeSpy = vi.spyOn(document, 'removeEventListener');
            getTasks.mockResolvedValue(TWO_ITEMS);
            const { unmount } = await renderVisibleTab();
            await screen.findByText('Ship the parser');

            const added = addSpy.mock.calls.filter(c => c[0] === 'keydown').map(c => c[1]);
            expect(added.length).toBeGreaterThan(0);

            unmount();

            const removed = removeSpy.mock.calls.filter(c => c[0] === 'keydown').map(c => c[1]);
            expect(added.every(handler => removed.includes(handler))).toBe(true);

            // And nothing responds to the keys any more.
            press('j');
            press('x');
            expect(patchTask).not.toHaveBeenCalled();
            addSpy.mockRestore();
            removeSpy.mockRestore();
        });

        it('a mouse click on a row moves the selection there', async () => {
            // The keyboard layer is an accelerator, not a separate mode — the
            // two input paths share one notion of "the current row".
            getTasks.mockResolvedValue(TWO_ITEMS);
            await renderVisibleTab();
            await screen.findByText('Ship the parser');

            fireEvent.mouseDown(screen.getByTestId('my-work-today-action-a2'));
            expect(selectedIds()).toEqual(['a2']);
            press('k');
            expect(selectedIds()).toEqual(['a1']);
        });
    });

    // ── Filter ───────────────────────────────────────────────────────────────

    describe('filter', () => {
        const MIXED = {
            actionItems: [
                { id: 'a1', text: 'Ship the parser', checked: false, tags: ['infra'] },
                { id: 'a2', text: 'Write the docs', checked: false },
            ],
            followUps: [{ id: 'f1', text: 'Budget approval', checked: false, person: 'Priya' }],
        };

        const type = (value: string) =>
            fireEvent.change(screen.getByTestId('my-work-today-filter'), { target: { value } });

        it('narrows the list by item text', async () => {
            getTasks.mockResolvedValue(MIXED);
            renderTab();
            await screen.findByText('Ship the parser');

            type('docs');
            expect(screen.queryByText('Ship the parser')).toBeNull();
            expect(screen.getByText('Write the docs')).toBeTruthy();
        });

        it('matches on tag and on person too, and expands the roll-ups so hits are visible', async () => {
            getTasks.mockResolvedValue(MIXED);
            renderTab();
            await screen.findByText('Ship the parser');

            type('#infra');
            expect(screen.getByText('Ship the parser')).toBeTruthy();
            expect(screen.queryByText('Write the docs')).toBeNull();

            type('priya');
            // The person group is open without a click — filtering is an
            // explicit act of looking for something.
            expect(screen.getByText('Budget approval')).toBeTruthy();
        });

        it('reports no matches distinctly from an empty list, and clears', async () => {
            getTasks.mockResolvedValue(MIXED);
            renderTab();
            await screen.findByText('Ship the parser');

            type('nothing matches this');
            expect(screen.getByTestId('my-work-today-no-matches')).toBeTruthy();
            // Not the empty state — offering Sync here would answer a question
            // nobody asked.
            expect(screen.queryByTestId('my-work-today-empty')).toBeNull();

            fireEvent.click(screen.getByTestId('my-work-today-filter-clear'));
            expect(screen.getByText('Ship the parser')).toBeTruthy();
        });

        it('leaves the triage chip reporting the whole snapshot, not the filtered view', async () => {
            getTasks.mockResolvedValue({
                actionItems: [
                    { id: 'a1', text: 'Ship the parser', checked: false, due: isoIn(-1) },
                    { id: 'a2', text: 'Write the docs', checked: false, due: isoIn(-3) },
                ],
                followUps: [],
            });
            renderTab();
            await screen.findByText('Ship the parser');
            expect(screen.getByTestId('my-work-today-stat').textContent).toContain('2 overdue');

            type('parser');
            expect(screen.getByTestId('my-work-today-stat').textContent).toContain('2 overdue');
        });
    });

    // ── Person roll-up ───────────────────────────────────────────────────────

    describe('person roll-up', () => {
        const PRIYA = {
            actionItems: [],
            followUps: [
                { id: 'f1', text: 'Cutover sign-off', checked: false, person: 'Priya', addedAt: daysAgo(9), sourceUrl: 'https://x.test/p' },
                { id: 'f2', text: 'Budget approval', checked: false, person: 'Priya', addedAt: daysAgo(2) },
                { id: 'f3', text: 'Headcount', checked: false, person: 'Priya', addedAt: daysAgo(4) },
            ],
        };

        it('collapses a person to a count and the age of their oldest item', async () => {
            getTasks.mockResolvedValue(PRIYA);
            renderTab();

            const toggle = await screen.findByTestId('my-work-today-person-toggle-Priya');
            expect(toggle.textContent).toContain('Priya · 3 items · oldest 9d');
            // Collapsed: the individual asks are not on screen yet.
            expect(screen.queryByText('Cutover sign-off')).toBeNull();
        });

        it('expands to the items and collapses again', async () => {
            getTasks.mockResolvedValue(PRIYA);
            renderTab();
            await expandPerson('Priya');

            expect(screen.getByText('Cutover sign-off')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-person-toggle-Priya').getAttribute('aria-expanded')).toBe('true');

            await expandPerson('Priya');
            expect(screen.queryByText('Cutover sign-off')).toBeNull();
        });

        it('says "1 item" for a single ask and drops the age when nothing is dated', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [{ id: 'f1', text: 'One thing', checked: false, person: 'Sam' }],
            });
            renderTab();

            const toggle = await screen.findByTestId('my-work-today-person-toggle-Sam');
            expect(toggle.textContent).toContain('Sam · 1 item');
            // `oldest 0d` would read as a fact about the items; it is an absence.
            expect(toggle.textContent).not.toContain('oldest');
        });

        it('labels an unheaded group rather than showing a bare count', async () => {
            getTasks.mockResolvedValue({
                actionItems: [],
                followUps: [{ id: 'f1', text: 'Orphan ask', checked: false }],
            });
            renderTab();

            const toggle = await screen.findByTestId('my-work-today-person-toggle-unassigned');
            expect(toggle.textContent).toContain('Unassigned · 1 item');
        });

        describe('nudge', () => {
            it('drafts a follow-up carrying every item, its age and its source link', async () => {
                const writeText = vi.fn();
                Object.defineProperty(navigator, 'clipboard', {
                    value: { writeText }, configurable: true,
                });
                getTasks.mockResolvedValue(PRIYA);
                renderTab();

                fireEvent.click(await screen.findByTestId('my-work-today-nudge-Priya'));

                expect(writeText).toHaveBeenCalledTimes(1);
                const draft = writeText.mock.calls[0][0] as string;
                expect(draft).toContain('Draft a short, friendly follow-up message to Priya.');
                expect(draft).toContain('I am waiting on Priya for the following 3 items:');
                // Oldest first, with the age that makes the ask land.
                expect(draft).toContain('- Cutover sign-off (waiting 9d) — https://x.test/p');
                expect(draft).toContain('- Headcount (waiting 4d)');
                expect(draft).toContain('- Budget approval (waiting 2d)');
                expect(draft.indexOf('Cutover sign-off')).toBeLessThan(draft.indexOf('Budget approval'));
                // An item with no link contributes no dangling separator.
                expect(draft).not.toContain('Headcount (waiting 4d) —');
            });

            it('nudges without expanding the group first', async () => {
                const writeText = vi.fn();
                Object.defineProperty(navigator, 'clipboard', {
                    value: { writeText }, configurable: true,
                });
                getTasks.mockResolvedValue(PRIYA);
                renderTab();

                // The whole point of the roll-up: one click on a collapsed line.
                fireEvent.click(await screen.findByTestId('my-work-today-nudge-Priya'));
                expect(writeText).toHaveBeenCalled();
                expect(screen.queryByText('Cutover sign-off')).toBeNull();
            });

            it('opens a floating chat prefilled with the draft when a queue is available', async () => {
                // The CoC-native path: compose into a chat. Nothing is sent —
                // the user still reads and sends the message themselves.
                let seen: { showDialog: boolean; prompt: string | null; mode: string; launch: string } | null = null;
                function Probe() {
                    const queue = useQueueOptional();
                    seen = {
                        showDialog: queue!.state.showDialog,
                        prompt: queue!.state.dialogInitialPrompt,
                        mode: queue!.state.dialogMode,
                        launch: queue!.state.dialogLaunchMode,
                    };
                    return null;
                }
                getTasks.mockResolvedValue(PRIYA);
                render(
                    <QueueProvider>
                        <MyWorkTodayTab workspaceId="my_work" active />
                        <Probe />
                    </QueueProvider>,
                );

                fireEvent.click(await screen.findByTestId('my-work-today-nudge-Priya'));

                await waitFor(() => expect(seen!.showDialog).toBe(true));
                expect(seen!.mode).toBe('ask');
                expect(seen!.launch).toBe('floating-chat');
                expect(seen!.prompt).toContain('follow-up message to Priya');
                expect(seen!.prompt).toContain('https://x.test/p');
            });
        });
    });

    // ── Loading and empty states ─────────────────────────────────────────────

    describe('loading and empty states', () => {
        it('shows skeleton rows rather than a line of text while the first fetch runs', async () => {
            let resolve!: (v: unknown) => void;
            getTasks.mockReturnValueOnce(new Promise(r => { resolve = r; }));
            renderTab();

            expect(screen.getAllByTestId('my-work-today-skeleton-row').length).toBeGreaterThan(0);
            expect(screen.getByTestId('my-work-today-loading').getAttribute('role')).toBe('status');

            resolve(SAMPLE);
            await waitFor(() => expect(screen.queryByTestId('my-work-today-loading')).toBeNull());
            expect(screen.queryByTestId('my-work-today-skeleton-row')).toBeNull();
        });

        it('does not show skeletons on a refetch, so the list never blinks', async () => {
            renderTab();
            await screen.findByText('Ship the parser');

            fireEvent.click(screen.getByTestId('my-work-today-check-a1'));
            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
            expect(screen.queryByTestId('my-work-today-skeleton-row')).toBeNull();
        });

        it('offers Sync and the notes before the manual-add path when the list is empty', async () => {
            getTasks.mockResolvedValue({ actionItems: [], followUps: [] });
            renderTab();

            await screen.findByTestId('my-work-today-empty');
            expect(screen.getByTestId('my-work-today-empty-sync')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-empty-open-actions')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-empty-open-followups')).toBeTruthy();
        });

        it('Sync pulls from Work IQ and reloads the snapshot', async () => {
            getTasks.mockResolvedValue({ actionItems: [], followUps: [] });
            renderTab();
            await screen.findByTestId('my-work-today-empty');

            getTasks.mockResolvedValue(SAMPLE);
            fireEvent.click(screen.getByTestId('my-work-today-empty-sync'));

            expect(syncMyWork).toHaveBeenCalledTimes(1);
            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
            expect(await screen.findByText('Ship the parser')).toBeTruthy();
        });

        it('reports a failed sync inline and leaves the empty state usable', async () => {
            getTasks.mockResolvedValue({ actionItems: [], followUps: [] });
            syncMyWork.mockRejectedValueOnce(new Error('nope'));
            renderTab();
            await screen.findByTestId('my-work-today-empty');

            fireEvent.click(screen.getByTestId('my-work-today-empty-sync'));

            expect(await screen.findByTestId('my-work-today-error')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-empty-sync')).toBeTruthy();
            expect(getTasks).toHaveBeenCalledTimes(1); // no refetch after a failed sync
        });

        it('the empty-state notes links use the workspace-scoped hash route', async () => {
            getTasks.mockResolvedValue({ actionItems: [], followUps: [] });
            renderTab();
            await screen.findByTestId('my-work-today-empty');

            fireEvent.click(screen.getByTestId('my-work-today-empty-open-followups'));
            expect(location.hash).toBe('#repos/my_work/notes/Follow%20Ups.md');
        });
    });

    // ── Refetch on reactivate ────────────────────────────────────────────────

    describe('refetch on reactivate', () => {
        const tab = (active: boolean) => <MyWorkTodayTab workspaceId="my_work" active={active} />;

        it('refetches when the tab becomes active again', async () => {
            // Without this the tab keeps its first snapshot forever: a background
            // sync or a scheduled write leaves it stale until a page reload.
            const { rerender } = render(tab(true));
            await screen.findByText('Ship the parser');
            expect(getTasks).toHaveBeenCalledTimes(1);

            rerender(tab(false));
            rerender(tab(true));

            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
        });

        it('picks up a snapshot written while the tab was away', async () => {
            const { rerender } = render(tab(true));
            await screen.findByText('Ship the parser');

            getTasks.mockResolvedValue({
                actionItems: [{ id: 'b1', text: 'Arrived while away', checked: false }],
                followUps: [],
            });
            rerender(tab(false));
            rerender(tab(true));

            expect(await screen.findByText('Arrived while away')).toBeTruthy();
        });

        it('settles instead of looping — staying active does not refetch', async () => {
            // An effect with an unstable dep here spins forever, and it shows up
            // as a hang rather than a failure, so this asserts the count is
            // stable across re-renders and a drained macrotask queue.
            const { rerender } = render(tab(true));
            await screen.findByText('Ship the parser');
            expect(getTasks).toHaveBeenCalledTimes(1);

            for (let i = 0; i < 5; i++) rerender(tab(true));
            await new Promise(r => setTimeout(r, 20));
            expect(getTasks).toHaveBeenCalledTimes(1);

            // And one full deactivate/reactivate cycle costs exactly one fetch.
            rerender(tab(false));
            rerender(tab(true));
            await waitFor(() => expect(getTasks).toHaveBeenCalledTimes(2));
            for (let i = 0; i < 5; i++) rerender(tab(true));
            await new Promise(r => setTimeout(r, 20));
            expect(getTasks).toHaveBeenCalledTimes(2);
        });

        it('still does not fetch while it has never been active', async () => {
            const { rerender } = render(tab(false));
            rerender(tab(false));
            await new Promise(r => setTimeout(r, 20));
            expect(getTasks).not.toHaveBeenCalled();
        });
    });

    // ── "What changed" strip ────────────────────────────────────────────────

    describe('what changed strip', () => {
        const ENTRIES = [
            {
                id: 'tl-1', date: '2026-08-09', time: '06:00', thread: 'contoso-migration',
                text: 'cutover slipped to the 14th',
                link: { kind: 'note' as const, path: 'Work/threads/contoso-migration.md' },
            },
            {
                id: 'tl-2', date: '2026-08-09', time: '07:30', thread: 'q3-budget',
                text: 'Dana approved; no action',
                link: { kind: 'note' as const, path: 'Work/threads/q3-budget.md' },
            },
        ];

        /** Wait for the task list, which lands after the strip's own fetch. */
        async function renderAndSettle() {
            renderTab();
            await screen.findByText('Ship the parser');
            await waitFor(() => expect(getTimeline).toHaveBeenCalled());
        }

        it('renders nothing at all when the note is absent', async () => {
            // The endpoint answers 200 with an empty list for a missing note.
            // "Nothing" here means no node — not an empty box — so the strip
            // costs zero vertical pixels in what is currently the normal state.
            await renderAndSettle();
            expect(screen.queryByTestId('my-work-today-timeline')).toBeNull();
            // And the tab's own content is unaffected.
            expect(screen.getByTestId('my-work-today-action-a1')).toBeTruthy();
        });

        it('renders nothing when the endpoint errors, and leaves the list up', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            getTimeline.mockRejectedValue(new Error('boom'));

            await renderAndSettle();

            expect(screen.queryByTestId('my-work-today-timeline')).toBeNull();
            expect(screen.queryByTestId('my-work-today-error')).toBeNull(); // not the task list's error
            expect(screen.getByTestId('my-work-today-action-a1')).toBeTruthy();
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });

        it('renders nothing when the endpoint answers with junk', async () => {
            getTimeline.mockResolvedValue({} as never);
            await renderAndSettle();
            expect(screen.queryByTestId('my-work-today-timeline')).toBeNull();
        });

        it('renders one line per entry, with time, thread and text', async () => {
            getTimeline.mockResolvedValue({ entries: ENTRIES, total: 2, notePath: 'Work/timeline.md' });
            await renderAndSettle();

            const strip = await screen.findByTestId('my-work-today-timeline');
            expect(strip.querySelectorAll('li')).toHaveLength(2);
            expect(screen.getByText('cutover slipped to the 14th')).toBeTruthy();
            expect(screen.getByText('06:00')).toBeTruthy();
            expect(screen.getByTestId('my-work-today-timeline-thread-tl-1').textContent).toBe('contoso-migration');
        });

        it('sits above the urgency buckets', async () => {
            getTimeline.mockResolvedValue({ entries: ENTRIES, total: 2, notePath: 'Work/timeline.md' });
            await renderAndSettle();

            const strip = await screen.findByTestId('my-work-today-timeline');
            const needsYou = screen.getByTestId('my-work-today-action-a1');
            // DOCUMENT_POSITION_FOLLOWING — the strip comes first in the tab.
            expect(strip.compareDocumentPosition(needsYou) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it('opens the thread note when the label is clicked', async () => {
            getTimeline.mockResolvedValue({ entries: ENTRIES, total: 2, notePath: 'Work/timeline.md' });
            await renderAndSettle();

            fireEvent.click(await screen.findByTestId('my-work-today-timeline-thread-tl-1'));
            expect(location.hash).toBe(
                `#repos/my_work/notes/${encodeURIComponent('Work/threads/contoso-migration.md')}`,
            );
        });

        it('renders an external link as an anchor, not a note link', async () => {
            getTimeline.mockResolvedValue({
                entries: [{ ...ENTRIES[0], link: { kind: 'external', url: 'https://teams.example/x' } }],
                total: 1,
                notePath: 'Work/timeline.md',
            });
            await renderAndSettle();

            const label = await screen.findByTestId('my-work-today-timeline-thread-tl-1');
            expect(label.tagName).toBe('A');
            expect(label.getAttribute('href')).toBe('https://teams.example/x');
            expect(label.getAttribute('rel')).toContain('noopener');
        });

        it('still shows the thread label when the bullet carried no usable link', async () => {
            getTimeline.mockResolvedValue({
                entries: [{ id: 'tl-1', thread: 'orphan', text: 'no link here' }],
                total: 1,
                notePath: 'Work/timeline.md',
            });
            await renderAndSettle();

            const label = await screen.findByTestId('my-work-today-timeline-thread-tl-1');
            expect(label.tagName).toBe('SPAN');
            expect(label.textContent).toBe('orphan');
        });

        it('offers "View all" only when the note holds more than it shows', async () => {
            getTimeline.mockResolvedValue({ entries: ENTRIES, total: 2, notePath: 'Work/timeline.md' });
            await renderAndSettle();
            await screen.findByTestId('my-work-today-timeline');
            expect(screen.queryByTestId('my-work-today-timeline-view-all')).toBeNull();
        });

        it('links "View all" to the timeline note when there are more entries', async () => {
            getTimeline.mockResolvedValue({ entries: ENTRIES, total: 17, notePath: 'Work/timeline.md' });
            await renderAndSettle();

            const viewAll = await screen.findByTestId('my-work-today-timeline-view-all');
            expect(viewAll.textContent).toContain('17');
            fireEvent.click(viewAll);
            expect(location.hash).toBe(`#repos/my_work/notes/${encodeURIComponent('Work/timeline.md')}`);
        });

        it('dismisses for the session and stays dismissed on remount', async () => {
            getTimeline.mockResolvedValue({ entries: ENTRIES, total: 2, notePath: 'Work/timeline.md' });
            const { unmount } = renderTab();
            await screen.findByTestId('my-work-today-timeline');

            fireEvent.click(screen.getByTestId('my-work-today-timeline-dismiss'));
            expect(screen.queryByTestId('my-work-today-timeline')).toBeNull();

            unmount();
            renderTab();
            await screen.findByText('Ship the parser');
            await waitFor(() => expect(getTimeline).toHaveBeenCalledTimes(2));
            expect(screen.queryByTestId('my-work-today-timeline')).toBeNull();
        });

        it('does not fetch the timeline until the tab is active', () => {
            renderTab({ active: false });
            expect(getTimeline).not.toHaveBeenCalled();
        });
    });
});
