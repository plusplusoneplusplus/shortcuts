// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserAddressBar } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserAddressBar';
import type { BrowserHistoryResult, BrowserHistorySuggestion, DesktopBrowserHistory } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';

afterEach(cleanup);
const entry = (url: string, title = 'Page', completion: string | null = null): BrowserHistorySuggestion => ({
    url, title, completion, lastVisited: 1000, visitCount: 2,
});
const reply = (entries: BrowserHistorySuggestion[]): BrowserHistoryResult<BrowserHistorySuggestion> => ({
    ok: true, entries, total: entries.length, recording: true, storageError: null,
});
function setup({ entries = [], url, history: supplied }: {
    entries?: BrowserHistorySuggestion[]; url?: string; history?: DesktopBrowserHistory;
} = {}) {
    const listeners = new Set<() => void>();
    const history: DesktopBrowserHistory = supplied ?? {
        suggest: vi.fn(async () => reply(entries)), query: vi.fn(), delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(),
        onChanged: callback => { listeners.add(callback); return () => { listeners.delete(callback); }; },
    };
    const props = { inputRef: createRef<HTMLInputElement>(), url, history, enabled: true, ownerKey: 'workspace-a:view-a',
        invalid: false, onEdit: vi.fn(), onOpen: vi.fn() };
    const view = render(<BrowserAddressBar {...props} />);
    return { ...view, props, history, listeners, input: screen.getByLabelText('Address') as HTMLInputElement };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

describe('desktop address history', () => {
    it('shows recent results on blank focus with accessible, bounded overlay placement', async () => {
        const entries = Array.from({ length: 10 }, (_, i) => entry(`https://page${i}.test/`, `Recent ${i}`));
        const { input, history } = setup({ entries });
        await screen.findByText('Recent 0');
        expect(history.suggest).toHaveBeenCalledWith('');
        const list = screen.getByRole('listbox');
        expect(screen.getAllByRole('option')).toHaveLength(8);
        expect(input).toHaveAttribute('role', 'combobox');
        expect(input).toHaveAttribute('aria-autocomplete', 'both');
        expect(input).toHaveAttribute('aria-controls', list.id);
        expect(input).not.toHaveAttribute('aria-activedescendant');
        expect(list.parentElement!.parentElement).toBe(document.body);
        expect(list.parentElement).toHaveAttribute('data-native-view-overlay');
        expect(list.parentElement).toHaveClass('fixed', 'z-50');
        vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({ left: 50, bottom: 70, width: 300 } as DOMRect);
        fireEvent(window, new Event('resize'));
        expect(list.parentElement!.style.left).toBe('50px');
        expect(list.parentElement!.style.top).toBe('74px');
        expect(list.parentElement!.style.width).toBe('300px');
        expect(Number.parseFloat(list.parentElement!.style.maxHeight)).toBeLessThanOrEqual(window.innerHeight - 78);
    });

    it('selects only the appended suffix and accepts the case-preserving stored URL', async () => {
        const target = entry('https://Example.test/Case?Q=Value#Hash', 'Case page', 'Example.test/Case?Q=Value#Hash');
        const { input, history, props } = setup({ entries: [target] });
        await screen.findByText('Case page');
        await userEvent.type(input, 'exa');
        await waitFor(() => expect(input.value).toBe('example.test/Case?Q=Value#Hash'));
        expect([input.selectionStart, input.selectionEnd]).toEqual([3, input.value.length]);
        expect(history.suggest).toHaveBeenLastCalledWith('exa');
        expect(input).not.toHaveAttribute('aria-activedescendant');
        await userEvent.keyboard('{Enter}');
        expect(props.onOpen).toHaveBeenCalledWith(target.url);
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it('does not preselect a title match; arrows select, Escape restores typed text', async () => {
        const { input, props } = setup({ entries: [entry('https://first.test/', 'Release notes'), entry('https://second.test/', 'Release tasks')] });
        await userEvent.type(input, 'release');
        await screen.findByText('Release notes');
        expect(input.value).toBe('release');
        expect(input).not.toHaveAttribute('aria-activedescendant');
        await userEvent.keyboard('{ArrowUp}');
        expect(input.value).toBe('https://second.test/');
        expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
        expect(input).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[1].id);
        await userEvent.keyboard('{ArrowDown}');
        expect(input.value).toBe('https://first.test/');
        await userEvent.keyboard('{Escape}');
        expect(input.value).toBe('release');
        expect(screen.queryByRole('listbox')).toBeNull();
        await userEvent.keyboard('{Enter}');
        expect(props.onOpen).toHaveBeenCalledWith('release');
    });

    it('opens highlighted and clicked results while retaining input focus', async () => {
        const { input, props } = setup({ entries: [entry('https://first.test/', 'First'), entry('https://second.test/', 'Second')] });
        await screen.findByText('First');
        await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
        expect(props.onOpen).toHaveBeenLastCalledWith('https://second.test/');
        act(() => input.blur());
        act(() => input.focus());
        await userEvent.click(await screen.findByText('First'));
        expect(props.onOpen).toHaveBeenLastCalledWith('https://first.test/');
        expect(input).toHaveFocus();
        expect(screen.queryByRole('listbox')).toBeNull();
    });

    it.each(['Backspace', 'Delete'])('removes the selected suffix with %s without restoring it', async key => {
        const { input, props } = setup({ entries: [entry('https://example.test/Case', 'Example', 'example.test/Case')] });
        await userEvent.type(input, 'ex');
        await waitFor(() => expect(input.selectionStart).toBe(2));
        await userEvent.keyboard(`{${key}}`);
        await screen.findByText('Example');
        expect(input.value).toBe('ex');
        expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
        await userEvent.keyboard('{Enter}');
        expect(props.onOpen).toHaveBeenCalledWith('ex');
    });

    it('Escape removes inline completion and rejects its pending replacement', async () => {
        const { input } = setup({ entries: [entry('https://example.test/', 'Example', 'example.test/')] });
        await userEvent.type(input, 'ex');
        await waitFor(() => expect(input.value).toBe('example.test/'));
        await userEvent.keyboard('{Escape}');
        expect(input.value).toBe('ex');
        expect(input).toHaveAttribute('aria-expanded', 'false');
    });

    it('keeps paste and mid-string caret editing free of automatic suffix selection', async () => {
        const { input, history } = setup({ entries: [entry('https://example.test/path', 'Example', 'example.test/path')] });
        await screen.findByText('Example');
        await userEvent.paste('ex');
        await waitFor(() => expect(history.suggest).toHaveBeenLastCalledWith('ex'));
        expect(input.value).toBe('ex');
        input.setSelectionRange(1, 1);
        fireEvent.keyDown(input, { key: 'a' });
        fireEvent.change(input, { target: { value: 'eax', selectionStart: 2, selectionEnd: 2 } });
        await waitFor(() => expect(history.suggest).toHaveBeenLastCalledWith('eax'));
        expect(input.value).toBe('eax');
    });

    it('caret movement accepts completed text as an ordinary value', async () => {
        const target = entry('https://example.test/Case', 'Example', 'example.test/Case');
        const { input, props } = setup({ entries: [target] });
        await userEvent.type(input, 'ex');
        await waitFor(() => expect(input.value).toBe(target.completion));
        await userEvent.keyboard('{ArrowLeft}{Enter}');
        expect(props.onOpen).toHaveBeenCalledWith(target.completion);
    });

    it('does not query or navigate during IME composition, then queries without completing', async () => {
        const { input, history, props } = setup({ entries: [entry('https://example.test/', 'Example', 'example.test/')] });
        await screen.findByText('Example');
        const calls = vi.mocked(history.suggest).mock.calls.length;
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: 'ex' } });
        fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
        expect(props.onOpen).not.toHaveBeenCalled();
        expect(history.suggest).toHaveBeenCalledTimes(calls);
        expect(screen.queryByRole('listbox')).toBeNull();
        fireEvent.compositionEnd(input);
        await waitFor(() => expect(history.suggest).toHaveBeenLastCalledWith('ex'));
        expect(input.value).toBe('ex');
    });

    it('rejects stale queries, including late tab/owner replies', async () => {
        const { input, history, rerender, props } = setup();
        await screen.findByText('No history matches.');
        const old = deferred<BrowserHistoryResult<BrowserHistorySuggestion>>();
        const newer = deferred<BrowserHistoryResult<BrowserHistorySuggestion>>();
        vi.mocked(history.suggest).mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise);
        fireEvent.change(input, { target: { value: 'old' } });
        fireEvent.change(input, { target: { value: 'new' } });
        await act(async () => newer.resolve(reply([entry('https://new.test/', 'New')])));
        await act(async () => old.resolve(reply([entry('https://old.test/', 'Old')])));
        expect(screen.getByText('New')).toBeTruthy();
        expect(screen.queryByText('Old')).toBeNull();
        const late = deferred<BrowserHistoryResult<BrowserHistorySuggestion>>();
        vi.mocked(history.suggest).mockReturnValueOnce(late.promise);
        fireEvent.change(input, { target: { value: 'late' } });
        rerender(<BrowserAddressBar {...props} ownerKey="workspace-b:view-b" url="https://other.test/" />);
        await act(async () => late.resolve(reply([entry('https://late.test/', 'Late', 'late.test/')])));
        expect(input.value).toBe('https://other.test/');
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(props.onOpen).not.toHaveBeenCalled();
    });

    it.each(['blur', 'hide'] as const)('dismisses on %s and ignores late replies', async action => {
        const { input, history, props, rerender } = setup();
        await screen.findByText('No history matches.');
        const late = deferred<BrowserHistoryResult<BrowserHistorySuggestion>>();
        vi.mocked(history.suggest).mockReturnValueOnce(late.promise);
        await userEvent.type(input, 'ex');
        if (action === 'blur') fireEvent.blur(input);
        else rerender(<BrowserAddressBar {...props} enabled={false} />);
        await act(async () => late.resolve(reply([entry('https://example.test/', 'Example', 'example.test/')])));
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(input.value).not.toBe('example.test/');
    });

    it('refreshes cross-window mutations and removes a deleted inline target', async () => {
        const { input, history, listeners } = setup({ entries: [entry('https://example.test/', 'Example', 'example.test/')] });
        await userEvent.type(input, 'ex');
        await waitFor(() => expect(input.value).toBe('example.test/'));
        vi.mocked(history.suggest).mockResolvedValue(reply([]));
        act(() => listeners.forEach(fn => fn()));
        await screen.findByText('No history matches.');
        expect(input.value).toBe('ex');
        expect(screen.queryByText('Example')).toBeNull();
    });

    it.each(['failure', 'throw', 'storage'] as const)('shows %s errors while manual entry works', async mode => {
        const { input, history, props } = setup();
        await screen.findByText('No history matches.');
        const suggest = vi.mocked(history.suggest);
        if (mode === 'throw') suggest.mockRejectedValue(new Error('transport'));
        else if (mode === 'failure') suggest.mockResolvedValue({ ok: false, reason: 'storage-failed', message: 'Cannot read history' });
        else suggest.mockResolvedValue({ ...reply([]), storageError: 'Cannot save history' } as BrowserHistoryResult<BrowserHistorySuggestion>);
        await userEvent.type(input, 'https://manual.test/');
        await screen.findByText(mode === 'throw' ? 'History unavailable. You can still enter a URL.' : mode === 'failure' ? 'Cannot read history' : 'Cannot save history');
        await userEvent.keyboard('{Enter}');
        expect(props.onOpen).toHaveBeenCalledWith('https://manual.test/');
    });

    it('shows loading and suppresses history UI on older hosts', async () => {
        const { props, rerender, history, input } = setup();
        await screen.findByText('No history matches.');
        vi.mocked(history.suggest).mockReturnValue(new Promise(() => {}));
        fireEvent.change(input, { target: { value: 'pending' } });
        expect(screen.getByText('Loading history…')).toBeTruthy();
        expect(screen.getByRole('listbox')).toHaveAttribute('aria-busy', 'true');
        rerender(<BrowserAddressBar {...props} history={undefined} />);
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(input).not.toHaveAttribute('role');
        await userEvent.keyboard('{Enter}');
        expect(props.onOpen).toHaveBeenCalledWith('pending');
    });
});
