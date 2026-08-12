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

            await screen.findByText('Cutover sign-off');
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
});
