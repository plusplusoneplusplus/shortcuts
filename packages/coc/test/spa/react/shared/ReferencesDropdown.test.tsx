/**
 * Tests for ReferencesDropdown shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReferencesDropdown } from '../../../../src/server/spa/client/react/shared/ReferencesDropdown';

// FilePathLink renders a span with the path — no context needed
describe('ReferencesDropdown', () => {
    it('renders nothing when no planPath and no files', () => {
        const { container } = render(<ReferencesDropdown />);
        expect(container.innerHTML).toBe('');
    });

    it('renders nothing when files is empty array', () => {
        const { container } = render(<ReferencesDropdown files={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders button with count of references (planPath only)', () => {
        render(<ReferencesDropdown planPath="/some/plan.md" />);
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (1)');
    });

    it('renders button with count of references (files only)', () => {
        render(
            <ReferencesDropdown files={[{ filePath: '/a.ts' }, { filePath: '/b.ts' }]} />
        );
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (2)');
    });

    it('renders button with combined count', () => {
        render(
            <ReferencesDropdown
                planPath="/plan.md"
                files={[{ filePath: '/a.ts' }, { filePath: '/b.ts' }]}
            />
        );
        expect(screen.getByTestId('references-dropdown-btn').textContent).toContain('References (3)');
    });

    it('dropdown is hidden by default', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        // The dropdown list is not rendered until opened
        expect(screen.queryByTitle('/plan.md')).toBeNull();
    });

    it('shows dropdown when button is clicked', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        // After opening, the FilePathLink for planPath should appear
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
    });

    it('hides dropdown on second click (toggle)', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        const btn = screen.getByTestId('references-dropdown-btn');
        fireEvent.click(btn);
        fireEvent.click(btn);
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeNull();
    });

    it('closes dropdown on outside click', () => {
        render(
            <div>
                <ReferencesDropdown planPath="/plan.md" />
                <button data-testid="outside">Outside</button>
            </div>
        );
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeTruthy();
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(document.querySelector('[data-full-path="/plan.md"]')).toBeNull();
    });

    it('popover has max-width and scroll constraints', () => {
        render(<ReferencesDropdown planPath="/plan.md" />);
        fireEvent.click(screen.getByTestId('references-dropdown-btn'));
        const popover = document.querySelector('.max-w-\\[320px\\]');
        expect(popover).not.toBeNull();
    });
});
