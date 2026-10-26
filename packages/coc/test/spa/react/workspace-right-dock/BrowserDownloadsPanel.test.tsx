// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserDownloadsPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserDownloadsPanel';
import type { BrowserManagedDownload, BrowserDownloadsResult, DesktopBrowserDownloads } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

const row = (state: BrowserManagedDownload['state'] = 'downloading', patch = {}): BrowserManagedDownload => ({
    id: state, engine: 'electron', filename: `${state}.zip`, source: 'files.test', started: 1700000000000, updated: 1700000000000,
    state, received: 512, total: 1024, active: ['downloading', 'paused'].includes(state), canPause: state === 'downloading', canResume: state === 'paused', fileAvailable: state === 'completed', ...patch,
});
const reply = (entries = [row()]): BrowserDownloadsResult => ({ ok: true, entries, storageError: null,
    engines: { electron: { managed: true, message: 'Native Save dialog' }, webview2: { managed: false, message: 'WebView2 downloads open in the system browser and are managed there.' } } });
function setup(value = reply()) {
    const listeners = new Set<() => void>();
    const downloads: DesktopBrowserDownloads = { query: vi.fn(async () => value), action: vi.fn(async () => ({ ok: true })),
        onChanged: vi.fn(callback => { listeners.add(callback); return () => { listeners.delete(callback); }; }) };
    const onClose = vi.fn();
    const view = render(<BrowserDownloadsPanel downloads={downloads} desktop engine="electron" onClose={onClose} />);
    return { downloads, listeners, onClose, ...view };
}
afterEach(cleanup);

describe('Downloads panel', () => {
    it('renders honest progress, source, time, supported actions and finished file actions', async () => {
        const entries = ['downloading', 'paused', 'completed', 'cancelled', 'interrupted', 'failed'].map(state => row(state as BrowserManagedDownload['state']));
        const { downloads } = setup(reply(entries));
        await screen.findByText('downloading.zip');
        expect(screen.getByRole('dialog', { name: 'Downloads' })).toHaveAttribute('aria-modal', 'true');
        expect(document.querySelector('[data-native-view-overlay]')).toBeInTheDocument();
        expect(screen.getAllByText('files.test')).toHaveLength(6);
        expect(document.querySelector('time')).toHaveAttribute('datetime', new Date(entries[0].started).toISOString());
        expect(screen.getAllByText('512 B of 1.0 KB')).toHaveLength(6);
        expect(screen.getByRole('progressbar', { name: 'Download progress for downloading.zip' })).toHaveAttribute('value', '512');
        expect(screen.getAllByRole('progressbar')).toHaveLength(2);
        for (const [label, id, action] of [['Pause', 'downloading', 'pause'], ['Resume', 'paused', 'resume'], ['Open', 'completed', 'open'], ['Show in folder', 'completed', 'show'], ['Remove record', 'cancelled', 'remove']]) {
            fireEvent.click(within(screen.getByRole('group', { name: `Actions for ${id}.zip` })).getByRole('button', { name: label }));
            await waitFor(() => expect(downloads.action).toHaveBeenLastCalledWith(id, action));
            await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
        }
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    });
    it('shows unknown sizes, missing files, no auto-open, and retains active rows on clear', async () => {
        const { downloads } = setup(reply([row('completed', { fileAvailable: false }), row('downloading', { total: 0 })]));
        await screen.findByText('completed.zip');
        expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Show in folder' })).toBeDisabled();
        expect(screen.getByText('File is missing or has changed.')).toBeInTheDocument();
        expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
        expect(downloads.action).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Clear finished records' }));
        expect(downloads.action).toHaveBeenCalledWith(null, 'clear');
    });
    it('contains keyboard focus, restores trigger focus, and handles Escape', async () => {
        const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus();
        const { unmount, onClose } = setup(reply([row('completed')]));
        await screen.findByText('completed.zip');
        const controls = within(screen.getByRole('dialog')).getAllByRole('button');
        controls.at(-1)!.focus(); await userEvent.tab(); expect(controls[0]).toHaveFocus();
        await userEvent.keyboard('{Escape}'); expect(onClose).toHaveBeenCalledOnce();
        unmount(); expect(trigger).toHaveFocus(); trigger.remove();
    });
    it('refreshes cross-window changes, ignores stale replies and unsubscribes on close', async () => {
        const { downloads, listeners, unmount } = setup();
        await screen.findByText('downloading.zip');
        let resolve!: (result: BrowserDownloadsResult) => void;
        vi.mocked(downloads.query).mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce(reply([row('completed')]));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        act(() => listeners.forEach(fn => fn()));
        await screen.findByText('completed.zip');
        await act(async () => resolve(reply([row('failed')])));
        expect(screen.queryByText('failed.zip')).toBeNull();
        unmount(); expect(listeners.size).toBe(0);
    });
    it('surfaces storage, query and action failures with no automatic retry', async () => {
        const result = reply(); if (result.ok) result.storageError = 'Could not save download history.';
        const { downloads } = setup(result);
        await screen.findByText('Could not save download history.');
        vi.mocked(downloads.action).mockResolvedValueOnce({ ok: false, reason: 'unavailable', message: 'Action unavailable' });
        fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
        await screen.findByText('Action unavailable');
        expect(downloads.action).toHaveBeenCalledOnce();
        vi.mocked(downloads.query).mockRejectedValueOnce(new Error('private/path'));
        fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
        await screen.findByText('Could not load downloads.');
        expect(screen.queryByText('private/path')).toBeNull();
    });
    it.each([false, true])('explicitly degrades absent APIs (desktop=%s)', desktop => {
        render(<BrowserDownloadsPanel desktop={desktop} onClose={vi.fn()} />);
        expect(screen.getByRole('status')).toHaveTextContent(desktop ? 'This desktop version does not support' : 'available in the CoC desktop app');
        expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
    });
    it('labels WebView2 fallback and provides wrapping controls for narrow layouts', async () => {
        const { downloads, rerender } = setup(reply([row('completed', { filename: 'a'.repeat(180) })]));
        rerender(<BrowserDownloadsPanel downloads={downloads} engine="webview2" desktop onClose={vi.fn()} />);
        await screen.findByText('a'.repeat(180));
        expect(screen.getByRole('status')).toHaveTextContent('WebView2 downloads open in the system browser');
        expect(screen.getByText('a'.repeat(180))).toHaveClass('break-words');
        expect(screen.getByRole('group')).toHaveClass('flex-wrap');
        expect(screen.getByRole('dialog')).toHaveClass('max-w-[640px]');
    });
});
