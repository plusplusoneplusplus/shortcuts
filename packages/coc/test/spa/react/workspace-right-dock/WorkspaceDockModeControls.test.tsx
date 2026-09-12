/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import {
    WorkspaceDockToggle,
    workspaceDockOpenStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

describe('WorkspaceDockToggle', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('renders one icon-only panel toggle with an accessible name and focus styling', () => {
        render(<WorkspaceDockToggle workspaceId="repo-a" />);

        const toggle = screen.getByRole('button', { name: 'Show right panel' });
        expect(toggle.textContent).toBe('');
        expect(toggle.getAttribute('title')).toBe('Show right panel');
        expect(toggle.className).toContain('focus-visible:outline');
        expect(toggle.querySelector('rect')).toBeTruthy();
        expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    it('opens and closes the panel without changing its selected mode', () => {
        render(<WorkspaceDockToggle workspaceId="repo-a" />);

        const toggle = screen.getByRole('button', { name: 'Show right panel' });
        fireEvent.click(toggle);
        const openToggle = screen.getByRole('button', { name: 'Hide right panel' });
        expect(openToggle.getAttribute('aria-expanded')).toBe('true');
        expect(openToggle.className).toContain('bg-[#ddf4ff]');
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('1');

        fireEvent.click(openToggle);
        expect(screen.getByRole('button', { name: 'Show right panel' }).getAttribute('aria-expanded')).toBe('false');
        expect(localStorage.getItem(workspaceDockOpenStorageKey('repo-a'))).toBe('0');
    });

    it('restores each workspace open state independently', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('repo-a'), '1');

        const { rerender } = render(<WorkspaceDockToggle workspaceId="repo-a" />);
        expect(screen.getByRole('button', { name: 'Hide right panel' })).toBeTruthy();

        rerender(<WorkspaceDockToggle workspaceId="repo-b" />);
        expect(screen.getByRole('button', { name: 'Show right panel' })).toBeTruthy();
    });
});
