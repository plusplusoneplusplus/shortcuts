// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserHistoryPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserHistoryPanel';
import type { BrowserHistoryEntry, BrowserHistoryResult, DesktopBrowserHistory } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const entry = (title = 'Docs', url = 'https://example.test/Case?Q=Value#Hash'): BrowserHistoryEntry => ({ title, url, lastVisited: 1700000000000, visitCount: 3 });
const result = (entries = [entry()], total = entries.length): BrowserHistoryResult => ({ ok: true, entries, total, recording: true, storageError: null });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(reply = result()) {
    const listeners = new Set<() => void>();
    const history: DesktopBrowserHistory = {
        query: vi.fn(async () => reply), suggest: vi.fn(), delete: vi.fn(async () => ({ ok: true })),
        clear: vi.fn(async () => ({ ok: true })), setRecording: vi.fn(),
        onChanged: vi.fn(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }),
    };
    const props = { history, onOpen: vi.fn(), onClose: vi.fn() };
    const rendered = render(<BrowserHistoryPanel {...props} />);
    return { ...rendered, props, history, listeners };
}
afterEach(cleanup);

describe('desktop History panel', () => {
    it('shows title, full URL and time, focuses search, and opens a stored URL', async () => {
        const { history, props } = setup();
        expect(screen.getByText('Loading history…')).toBeInTheDocument();
        await screen.findByText('Docs');
        expect(history.query).toHaveBeenCalledWith('', 0, 50);
        expect(screen.getByText(entry().url)).toBeInTheDocument();
        expect(document.querySelector('time')).toHaveAttribute('datetime', new Date(entry().lastVisited).toISOString());
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
        expect(screen.getByRole('dialog')).toHaveAttribute('data-native-view-overlay');
        expect(screen.getByLabelText('Search history')).toHaveFocus();
        fireEvent.click(screen.getByText('Docs'));
        expect(props.onOpen).toHaveBeenCalledWith(entry().url);
        expect(props.onClose).toHaveBeenCalled();
    });

    it('queries bounded pages and resets pagination when searching titles/URLs', async () => {
        const { history } = setup(result([entry()], 101));
        await screen.findByText('Docs');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await waitFor(() => expect(history.query).toHaveBeenLastCalledWith('', 50, 50));
        await screen.findByText('51–51 of 101');
        fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
        await screen.findByText('1–1 of 101');
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'Case' } });
        await waitFor(() => expect(history.query).toHaveBeenLastCalledWith('Case', 0, 50));
        expect(screen.getByLabelText('Search history')).toHaveAttribute('maxlength', '8192');
    });

    it('rejects stale search replies and hides stale entries while refreshing', async () => {
        const { history } = setup();
        await screen.findByText('Docs');
        const old = deferred<BrowserHistoryResult>();
        vi.mocked(history.query).mockReturnValueOnce(old.promise).mockResolvedValueOnce(result([entry('New')]));
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'old' } });
        expect(screen.queryByText('Docs')).toBeNull();
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'new' } });
        await screen.findByText('New');
        await act(async () => old.resolve(result([entry('Old')])));
        expect(screen.queryByText('Old')).toBeNull();
    });

    it('refreshes on cross-window changes, removes a deleted row, and adjusts an emptied last page', async () => {
        const { history, listeners } = setup(result([entry()], 51));
        await screen.findByText('Docs');
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
        await screen.findByText('51–51 of 51');
        vi.mocked(history.query).mockResolvedValue(result([entry('Survivor')], 50));
        fireEvent.click(screen.getByRole('button', { name: 'Delete Docs' }));
        await screen.findByText('Survivor');
        expect(history.delete).toHaveBeenCalledWith(entry().url);
        expect(history.query).toHaveBeenLastCalledWith('', 0, 50);
        vi.mocked(history.query).mockResolvedValue(result([]));
        act(() => listeners.forEach(callback => callback()));
        await screen.findByText('No browser history yet.');
        expect(screen.queryByText('Survivor')).toBeNull();
    });

    it('uses native-confirmed clear, cancellation preserves rows, success refreshes', async () => {
        const { history } = setup();
        const confirm = vi.spyOn(window, 'confirm');
        await screen.findByText('Docs');
        vi.mocked(history.clear).mockResolvedValueOnce({ ok: false, reason: 'cancelled' });
        fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Clear history' })).toBeEnabled());
        expect(screen.getByText('Docs')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(confirm).not.toHaveBeenCalled();
        vi.mocked(history.query).mockResolvedValue(result([]));
        fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
        await screen.findByText('No browser history yet.');
        expect(history.setRecording).not.toHaveBeenCalled();
        confirm.mockRestore();
    });

    it.each(['delete', 'clear'] as const)('surfaces failed and rejected %s without removing entries', async operation => {
        const { history } = setup();
        await screen.findByText('Docs');
        vi.mocked(history[operation]).mockResolvedValueOnce({ ok: false, reason: 'storage-failed', message: 'Disk full' }).mockRejectedValueOnce(new Error('offline'));
        const control = screen.getByRole('button', { name: operation === 'delete' ? 'Delete Docs' : 'Clear history' });
        fireEvent.click(control);
        await screen.findByText('Disk full');
        expect(screen.getByText('Docs')).toBeInTheDocument();
        fireEvent.click(control);
        await screen.findByText('Could not change browser history. Try again.');
        expect(screen.getByText('Docs')).toBeInTheDocument();
    });

    it('disables concurrent mutations while saving', async () => {
        const { history } = setup();
        await screen.findByText('Docs');
        const save = deferred<{ ok: true }>();
        vi.mocked(history.delete).mockReturnValue(save.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Docs' }));
        expect(screen.getByRole('button', { name: 'Delete Docs' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Clear history' })).toBeDisabled();
        await act(async () => save.resolve({ ok: true }));
    });

    it('shows query failures and retry, storage errors, paused recording and empty search', async () => {
        const { history } = setup({ ok: false, reason: 'unavailable' });
        await screen.findByText('Could not load history: unavailable');
        vi.mocked(history.query).mockRejectedValueOnce(new Error('offline'));
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('Could not load browser history.');
        vi.mocked(history.query).mockResolvedValue({ ok: true, entries: [], total: 0, recording: false, storageError: 'disk full' });
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        await screen.findByText('History storage error: disk full');
        expect(screen.getByText('History recording is paused.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'missing' } });
        await screen.findByText('No matching history.');
    });

    it('unsubscribes on close and rejects late query/mutation replies', async () => {
        const { history, unmount, listeners, props } = setup();
        await screen.findByText('Docs');
        const save = deferred<{ ok: true }>();
        vi.mocked(history.delete).mockReturnValue(save.promise);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Docs' }));
        const calls = vi.mocked(history.query).mock.calls.length;
        unmount();
        expect(listeners.size).toBe(0);
        await act(async () => save.resolve({ ok: true }));
        expect(history.query).toHaveBeenCalledTimes(calls);
        expect(props.onOpen).not.toHaveBeenCalled();
    });

    it('keeps keyboard focus inside and closes with Escape', async () => {
        const { props } = setup(result([]));
        await screen.findByText('No browser history yet.');
        const search = screen.getByLabelText('Search history');
        search.focus();
        await userEvent.tab();
        expect(screen.getByRole('button', { name: 'Clear history' })).toHaveFocus();
        fireEvent.keyDown(search, { key: 'Escape' });
        expect(props.onClose).toHaveBeenCalled();
    });
});
