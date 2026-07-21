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
});
