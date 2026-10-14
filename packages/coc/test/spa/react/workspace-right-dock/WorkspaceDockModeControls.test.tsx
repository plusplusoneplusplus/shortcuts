/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
    WorkspaceDockToggle, cycleWorkspaceDock, openWorkspaceDock,
    setWorkspaceDockExpanded, setWorkspaceDockOpen, toggleWorkspaceDockOpen,
    workspaceDockOpenStorageKey, workspaceDockModeStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
    cleanup();
    setWorkspaceDockExpanded('repo-a', false);
    setWorkspaceDockExpanded('repo-b', false);
});

describe('WorkspaceDockToggle', () => {
    it('cycles hidden → docked → expanded → hidden with distinct icons and next-action labels', () => {
        localStorage.setItem(workspaceDockModeStorageKey('repo-a'), 'search');
        render(<WorkspaceDockToggle workspaceId="repo-a" />);
        const toggle = screen.getByRole('button', { name: 'Show right panel' });
        expect(toggle.textContent).toBe('');
        expect(toggle.className).toContain('focus-visible:outline');
        expect(toggle.getAttribute('aria-keyshortcuts')).toBe('Control+\\');
        const icons: string[] = [];
        for (const label of ['Show right panel', 'Expand right panel', 'Hide right panel']) {
            expect(toggle.getAttribute('aria-label')).toBe(label);
            expect(toggle.getAttribute('title')).toContain(label);
            icons.push(toggle.querySelector('svg')!.innerHTML);
            fireEvent.click(toggle);
        }
        expect(new Set(icons).size).toBe(3);
        expect(toggle.getAttribute('aria-label')).toBe('Show right panel');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('0');
        expect(localStorage.getItem(workspaceDockModeStorageKey('repo-a'))).toBe('search');
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('shares state across controls and isolates workspace scopes', () => {
        const view = render(<><WorkspaceDockToggle workspaceId="repo-a" /><WorkspaceDockToggle workspaceId="repo-a" /></>);
        act(() => { cycleWorkspaceDock('repo-a'); cycleWorkspaceDock('repo-a'); });
        expect(screen.getAllByRole('button', { name: 'Hide right panel' })).toHaveLength(2);
        view.rerender(<WorkspaceDockToggle workspaceId="repo-b" />);
        expect(screen.getByRole('button', { name: 'Show right panel' })).toBeTruthy();
        view.rerender(<WorkspaceDockToggle workspaceId="repo-a" />);
        expect(screen.getByRole('button', { name: 'Hide right panel' })).toBeTruthy();
    });

    it('closing without a mounted panel clears expansion before immediate reopen', () => {
        act(() => { cycleWorkspaceDock('repo-a'); cycleWorkspaceDock('repo-a'); });
        // Visibility shortcut closes an expanded panel; a source link reopens docked.
        act(() => { toggleWorkspaceDockOpen('repo-a'); openWorkspaceDock('repo-a'); });
        render(<WorkspaceDockToggle workspaceId="repo-a" />);
        expect(screen.getByRole('button', { name: 'Expand right panel' })).toBeTruthy();
        act(() => { cycleWorkspaceDock('repo-a'); setWorkspaceDockOpen('repo-a', false); openWorkspaceDock('repo-a'); });
        expect(screen.getByRole('button', { name: 'Expand right panel' })).toBeTruthy();
    });

    it('hydrates persisted visibility as docked and preserves dialog Escape', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('repo-a'), '1');
        render(<WorkspaceDockToggle workspaceId="repo-a" />);
        fireEvent.click(screen.getByRole('button', { name: 'Expand right panel' }));
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        document.body.appendChild(dialog);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.getByRole('button', { name: 'Hide right panel' })).toBeTruthy();
        dialog.remove();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.getByRole('button', { name: 'Expand right panel' })).toBeTruthy();
    });
});
