/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
    WorkspaceDockModeControls,
    workspaceDockModeStorageKey,
    workspaceDockOpenStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

describe('WorkspaceDockModeControls', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('renders peer icon-only controls with accessible names, tooltips, and focus styling', () => {
        render(<WorkspaceDockModeControls workspaceId="repo-a" />);

        const search = screen.getByRole('button', { name: 'Search' });
        const explorer = screen.getByRole('button', { name: 'Explorer' });
        expect(search.textContent).toBe('');
        expect(explorer.textContent).toBe('');
        expect(search.getAttribute('title')).toBe('Search panel');
        expect(explorer.getAttribute('title')).toBe('Explorer panel');
        expect(search.className).toContain('focus-visible:outline');
        expect(explorer.className).toContain('focus-visible:outline');
        expect(search.querySelector('circle')).toBeTruthy();
        expect(explorer.querySelector('rect')).toBeTruthy();
    });

    it('opens Search, switches to Explorer, and closes from the active control', () => {
        render(<WorkspaceDockModeControls workspaceId="repo-a" />);

        const search = screen.getByRole('button', { name: 'Search' });
        const explorer = screen.getByRole('button', { name: 'Explorer' });
        fireEvent.click(search);
        expect(search.getAttribute('aria-pressed')).toBe('true');
        expect(search.className).toContain('bg-[#ddf4ff]');

        fireEvent.click(explorer);
        expect(search.getAttribute('aria-pressed')).toBe('false');
        expect(explorer.getAttribute('aria-pressed')).toBe('true');
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('1');
        expect(localStorage.getItem(workspaceDockModeStorageKey('repo-a'))).toBe('explorer');

        fireEvent.click(explorer);
        expect(explorer.getAttribute('aria-pressed')).toBe('false');
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('0');
    });

    it('restores each workspace mode independently', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('repo-a'), '1');
        localStorage.setItem(workspaceDockModeStorageKey('repo-a'), 'search');
        localStorage.setItem(workspaceDockOpenStorageKey('repo-b'), '1');

        const { rerender } = render(<WorkspaceDockModeControls workspaceId="repo-a" />);
        expect(screen.getByRole('button', { name: 'Search' }).getAttribute('aria-pressed')).toBe('true');

        rerender(<WorkspaceDockModeControls workspaceId="repo-b" />);
        expect(screen.getByRole('button', { name: 'Search' }).getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Explorer' }).getAttribute('aria-pressed')).toBe('true');
    });
});
