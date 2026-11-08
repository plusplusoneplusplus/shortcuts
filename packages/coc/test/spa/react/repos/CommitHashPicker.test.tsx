/**
 * CommitHashPicker — the commit review header's short-hash switcher:
 * recent commits, SHA entry, explicit load/lookup states and keyboard handling.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import { CommitHashPicker, type CommitPickerOptions } from '../../../../src/server/spa/client/react/features/git/commits/CommitHashPicker';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/commitListTypes';

const commit = (hash: string, subject: string): GitCommitItem => ({
    hash, shortHash: hash.slice(0, 7), subject, author: 'A', date: '2026-11-01T00:00:00Z', parentHashes: [],
});
const CURRENT = commit('1da3ade1f00000000000000000000000000000aa', 'test(coc): widen waits');
const OTHER = commit('a335fd736000000000000000000000000000000b', 'test(coc): align explorer tabs');
const SIBLING = commit('a335fd7ff00000000000000000000000000000cc', 'chore: shares a 7-char prefix');

function renderPicker(options: Partial<CommitPickerOptions> = {}) {
    const onSelect = vi.fn();
    const picker: CommitPickerOptions = { commits: [CURRENT, OTHER], onSelect, ...options };
    const view = render(<CommitHashPicker hash={CURRENT.hash} picker={picker} />);
    return { onSelect, picker, view };
}
const trigger = () => screen.getByTestId('commit-hash-picker-trigger');
const input = () => screen.getByTestId('commit-hash-picker-input') as HTMLInputElement;
async function open() { await act(async () => { fireEvent.click(trigger()); }); }
async function submit(value: string) {
    await act(async () => { fireEvent.change(input(), { target: { value } }); });
    await act(async () => { fireEvent.submit(input().form!); });
}

describe('CommitHashPicker', () => {
    it('is a labelled dialog trigger whose short hash collapses in narrow panes', async () => {
        renderPicker();
        expect(trigger().getAttribute('aria-label')).toBe('Commit 1da3ade1: switch commit');
        expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
        expect(trigger().getAttribute('aria-expanded')).toBe('false');
        expect(trigger().querySelector('.git-review-hash')!.className).toContain('git-review-md');
        await open();
        expect(trigger().getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByRole('dialog', { name: 'Switch commit' }).id).toBe(trigger().getAttribute('aria-controls'));
        expect(document.activeElement).toBe(input());
    });

    it('lists recent commits with short SHA, subject and the current selection', async () => {
        renderPicker();
        await open();
        const current = screen.getByTestId(`commit-hash-picker-option-${CURRENT.hash}`);
        const other = screen.getByTestId(`commit-hash-picker-option-${OTHER.hash}`);
        expect(current.getAttribute('aria-current')).toBe('true');
        expect(current.querySelector('svg')).not.toBeNull();
        expect(other.getAttribute('aria-current')).toBeNull();
        expect(other.textContent).toContain('a335fd7');
        expect(other.textContent).toContain('test(coc): align explorer tabs');
    });

    it('opens a different commit and closes; choosing the current commit only closes', async () => {
        const { onSelect } = renderPicker();
        await open();
        await act(async () => { fireEvent.click(screen.getByTestId(`commit-hash-picker-option-${CURRENT.hash}`)); });
        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
        expect(document.activeElement).toBe(trigger());
        await open();
        await act(async () => { fireEvent.click(screen.getByTestId(`commit-hash-picker-option-${OTHER.hash}`)); });
        expect(onSelect).toHaveBeenCalledWith(OTHER);
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
    });

    it('moves focus with arrow keys and closes on Escape, returning focus to the trigger', async () => {
        renderPicker();
        await open();
        const dialog = screen.getByTestId('commit-hash-picker');
        await act(async () => { fireEvent.keyDown(input(), { key: 'ArrowDown' }); });
        expect(document.activeElement).toBe(screen.getByTestId(`commit-hash-picker-option-${CURRENT.hash}`));
        await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); });
        expect(document.activeElement).toBe(screen.getByTestId(`commit-hash-picker-option-${OTHER.hash}`));
        await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); });
        expect(document.activeElement).toBe(input());
        await act(async () => { fireEvent.keyDown(input(), { key: 'ArrowUp' }); });
        expect(document.activeElement).toBe(screen.getByTestId(`commit-hash-picker-option-${OTHER.hash}`));
        await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
        expect(document.activeElement).toBe(trigger());
    });

    it('lists other views above the recent commits and opens one', async () => {
        const onBranch = vi.fn();
        const onWorking = vi.fn();
        const { onSelect } = renderPicker({ views: [
            { id: 'branch-range', label: 'Branch changes', detail: '3 commits vs origin/main', onSelect: onBranch },
            { id: 'working-changes', label: 'Uncommitted changes', onSelect: onWorking },
        ] });
        await open();
        const branch = screen.getByTestId('commit-hash-picker-view-branch-range');
        expect(branch.textContent).toContain('Branch changes');
        expect(branch.textContent).toContain('3 commits vs origin/main');
        await act(async () => { fireEvent.keyDown(input(), { key: 'ArrowDown' }); });
        expect(document.activeElement).toBe(branch);
        await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); });
        expect(document.activeElement).toBe(screen.getByTestId('commit-hash-picker-view-working-changes'));
        await act(async () => { fireEvent.click(screen.getByTestId('commit-hash-picker-view-working-changes')); });
        expect(onWorking).toHaveBeenCalledTimes(1);
        expect(onBranch).not.toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
    });

    it('closes on outside mousedown', async () => {
        renderPicker();
        await open();
        await act(async () => { fireEvent.mouseDown(document.body); });
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
    });

    it('shows loading, error and empty states for the recent list', async () => {
        const { view } = renderPicker({ commits: [], loading: true });
        await open();
        expect(screen.getByRole('status').textContent).toBe('Loading recent commits…');
        view.rerender(<CommitHashPicker hash={CURRENT.hash} picker={{ commits: [], error: 'boom', onSelect: vi.fn() }} />);
        expect(screen.getByRole('alert').textContent).toBe('Could not load recent commits: boom');
        view.rerender(<CommitHashPicker hash={CURRENT.hash} picker={{ commits: [], onSelect: vi.fn() }} />);
        expect(screen.getByText('No recent commits')).toBeTruthy();
        expect(screen.queryByRole('list')).toBeNull();
    });

    it('refreshes by keyboard without closing and exposes retained-list loading and retry errors', async () => {
        const user = userEvent.setup();
        const onRefresh = vi.fn();
        const { picker, view, onSelect } = renderPicker({ onRefresh });
        await open();
        const refresh = screen.getByRole('button', { name: 'Refresh recent commits' }) as HTMLButtonElement;
        refresh.focus();
        await user.keyboard('{Enter}');
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('dialog', { name: 'Switch commit' })).toBeTruthy();
        view.rerender(<CommitHashPicker hash={CURRENT.hash} picker={{ ...picker, loading: true }} />);
        expect(refresh.disabled).toBe(true);
        expect(screen.getByRole('status').textContent).toContain('Loading recent commits');
        expect(screen.getByTestId(`commit-hash-picker-option-${CURRENT.hash}`).getAttribute('aria-current')).toBe('true');
        fireEvent.click(refresh);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        view.rerender(<CommitHashPicker hash={CURRENT.hash} picker={{ ...picker, error: 'offline' }} />);
        expect(screen.getByRole('alert').textContent).toContain('offline');
        expect(refresh.disabled).toBe(false);
        await user.click(refresh);
        expect(onRefresh).toHaveBeenCalledTimes(2);
        view.rerender(<CommitHashPicker hash={CURRENT.hash} picker={{ ...picker, commits: [SIBLING, CURRENT] }} />);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getByTestId(`commit-hash-picker-option-${SIBLING.hash}`)).toBeTruthy();
        expect(screen.getByTestId(`commit-hash-picker-option-${CURRENT.hash}`).getAttribute('aria-current')).toBe('true');
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('rejects input that is not a 7–40 character hex SHA without a lookup', async () => {
        const lookup = vi.fn();
        renderPicker({ lookup });
        await open();
        await submit('main');
        expect(screen.getByTestId('commit-hash-picker-error').textContent).toBe('Enter 7–40 hex characters of a commit SHA');
        expect(input().getAttribute('aria-invalid')).toBe('true');
        await submit('a335f');
        expect(screen.getByTestId('commit-hash-picker-error')).toBeTruthy();
        expect(lookup).not.toHaveBeenCalled();
    });

    it('opens an abbreviated SHA from the recent list without a server lookup', async () => {
        const lookup = vi.fn();
        const { onSelect } = renderPicker({ lookup });
        await open();
        await submit('  A335FD7 ');
        expect(onSelect).toHaveBeenCalledWith(OTHER);
        expect(lookup).not.toHaveBeenCalled();
    });

    it('looks up a SHA outside the recent list and opens the result', async () => {
        const found = commit('feedface00000000000000000000000000000000', 'older commit');
        let resolve!: (value: GitCommitItem) => void;
        const lookup = vi.fn(() => new Promise<GitCommitItem>(r => { resolve = r; }));
        const { onSelect } = renderPicker({ lookup });
        await open();
        await submit('feedface');
        expect(lookup).toHaveBeenCalledWith('feedface');
        expect(screen.getByRole('status').textContent).toBe('Looking up commit…');
        expect(input().disabled).toBe(true);
        await act(async () => { resolve(found); });
        expect(onSelect).toHaveBeenCalledWith(found);
        expect(screen.queryByTestId('commit-hash-picker')).toBeNull();
    });

    it('defers an ambiguous recent prefix to the server lookup', async () => {
        const lookup = vi.fn().mockResolvedValue(SIBLING);
        const { onSelect } = renderPicker({ commits: [CURRENT, OTHER, SIBLING], lookup });
        await open();
        await submit('a335fd7');
        expect(lookup).toHaveBeenCalledWith('a335fd7');
        expect(onSelect).toHaveBeenCalledWith(SIBLING);
    });

    it('distinguishes not-found from other lookup failures', async () => {
        const lookup = vi.fn()
            .mockRejectedValueOnce(new CocApiError({ status: 404, statusText: 'Not Found', url: '/x', message: 'Commit not found' }))
            .mockRejectedValueOnce(new Error('Network down'));
        const { onSelect } = renderPicker({ lookup });
        await open();
        await submit('deadbeef');
        expect(screen.getByTestId('commit-hash-picker-error').textContent).toBe('Commit not found or ambiguous SHA');
        await submit('deadbeef');
        expect(screen.getByTestId('commit-hash-picker-error').textContent).toBe('Could not look up commit: Network down');
        expect(onSelect).not.toHaveBeenCalled();
        expect(screen.getByTestId('commit-hash-picker')).toBeTruthy();
        await act(async () => { fireEvent.change(input(), { target: { value: 'deadbeef1' } }); });
        expect(screen.queryByTestId('commit-hash-picker-error')).toBeNull();
    });

    it('reports unmatched or ambiguous SHAs locally when direct lookup is off', async () => {
        const { onSelect } = renderPicker({ commits: [CURRENT, OTHER, SIBLING] });
        await open();
        await submit('deadbeef');
        expect(screen.getByTestId('commit-hash-picker-error').textContent).toBe('No recent commit matches this SHA');
        await submit('a335fd7');
        expect(screen.getByTestId('commit-hash-picker-error').textContent).toBe('Ambiguous SHA: add more characters');
        await submit('a335fd73');
        expect(onSelect).toHaveBeenCalledWith(OTHER);
    });

    it('ignores a lookup that settles after the picker closed', async () => {
        let resolve!: (value: GitCommitItem) => void;
        const lookup = vi.fn(() => new Promise<GitCommitItem>(r => { resolve = r; }));
        const { onSelect } = renderPicker({ lookup });
        await open();
        await submit('feedface');
        await act(async () => { fireEvent.keyDown(screen.getByTestId('commit-hash-picker'), { key: 'Escape' }); });
        await act(async () => { resolve(commit('feedface00000000000000000000000000000000', 'late')); });
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('keeps compact header targets at least 24px wide', () => {
        const css = readFileSync(join(__dirname, '../../../../src/server/spa/client/react/features/git/diff/git-file-review.css'), 'utf8');
        expect(css).toMatch(/\.git-review-tools \.git-review-hash-trigger\{[^}]*min-width:24px/);
        // The icon-only Classify caret shares the guarantee.
        expect(css).toMatch(/\.git-review-split>button:nth-child\(2\)\{[^}]*min-width:24px/);
        expect(css).toMatch(/\.git-review-tools button,[^{]*\{[^}]*min-height:26px/);
    });
});
