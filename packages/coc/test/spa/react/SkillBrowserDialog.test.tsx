/**
 * Tests for SkillBrowserDialog — single-select searchable skill modal used by
 * the Git tab commit context menu in place of a third-tier hover submenu.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SkillBrowserDialog } from '../../../src/server/spa/client/react/queue/SkillBrowserDialog';

// jsdom doesn't implement scrollIntoView
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

afterEach(cleanup);

const SKILLS = [
    { name: 'impl', description: 'Implement with tests' },
    { name: 'code-review', description: 'Review a diff' },
    { name: 'draft', description: 'Draft a UX spec', source: 'global' },
    { name: 'go-deep', description: 'Deep research', source: 'custom' },
];

function renderDialog(props: Partial<Parameters<typeof SkillBrowserDialog>[0]> = {}) {
    const onSelect = props.onSelect ?? vi.fn();
    const onClose = props.onClose ?? vi.fn();
    render(
        <SkillBrowserDialog
            open={props.open ?? true}
            skills={props.skills ?? SKILLS}
            onSelect={onSelect}
            onClose={onClose}
            title={props.title}
        />
    );
    return { onSelect, onClose };
}

describe('SkillBrowserDialog', () => {
    it('renders nothing when closed', () => {
        renderDialog({ open: false });
        expect(screen.queryByTestId('skill-browser-dialog')).toBeNull();
    });

    it('renders the searchable panel when open', () => {
        renderDialog();
        expect(screen.getByTestId('skill-browser-dialog')).toBeTruthy();
        expect(screen.getByTestId('skill-picker-search')).toBeTruthy();
        expect(screen.getByTestId('skill-picker-item-impl')).toBeTruthy();
        expect(screen.getByTestId('skill-picker-item-go-deep')).toBeTruthy();
    });

    it('groups skills into repo and global sections', () => {
        renderDialog();
        expect(screen.getByTestId('skill-picker-section-repo')).toBeTruthy();
        expect(screen.getByTestId('skill-picker-section-global')).toBeTruthy();
    });

    it('autofocuses the search input', async () => {
        renderDialog();
        const input = screen.getByTestId('skill-picker-search');
        await vi.waitFor(() => expect(document.activeElement).toBe(input));
    });

    it('filters the list by search query', () => {
        renderDialog();
        fireEvent.change(screen.getByTestId('skill-picker-search'), { target: { value: 'revi' } });
        expect(screen.getByTestId('skill-picker-item-code-review')).toBeTruthy();
        expect(screen.queryByTestId('skill-picker-item-impl')).toBeNull();
    });

    it('matches on description as well as name', () => {
        renderDialog();
        fireEvent.change(screen.getByTestId('skill-picker-search'), { target: { value: 'research' } });
        expect(screen.getByTestId('skill-picker-item-go-deep')).toBeTruthy();
        expect(screen.queryByTestId('skill-picker-item-impl')).toBeNull();
    });

    it('shows a no-results message when nothing matches', () => {
        renderDialog();
        fireEvent.change(screen.getByTestId('skill-picker-search'), { target: { value: 'zzzz' } });
        expect(screen.getByTestId('skill-picker-no-results')).toBeTruthy();
    });

    it('selects a skill on click and closes', () => {
        const { onSelect, onClose } = renderDialog();
        fireEvent.click(screen.getByTestId('skill-picker-item-code-review'));
        expect(onSelect).toHaveBeenCalledWith('code-review');
        expect(onClose).toHaveBeenCalled();
    });

    it('selects the highlighted skill on Enter', () => {
        const { onSelect, onClose } = renderDialog();
        const input = screen.getByTestId('skill-picker-search');
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });
        // Repo skills come first: index 0 = impl, index 1 = code-review
        expect(onSelect).toHaveBeenCalledWith('code-review');
        expect(onClose).toHaveBeenCalled();
    });

    it('arrow keys do not run past the ends of the list', () => {
        const { onSelect } = renderDialog();
        const input = screen.getByTestId('skill-picker-search');
        fireEvent.keyDown(input, { key: 'ArrowUp' });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith('impl');
    });

    it('closes on Escape without selecting', () => {
        const { onSelect, onClose } = renderDialog();
        fireEvent.keyDown(screen.getByTestId('skill-picker-search'), { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('does not render selection checkmarks (single-select surface)', () => {
        renderDialog();
        expect(screen.queryByTestId('skill-picker-check-impl')).toBeNull();
    });

    it('handles an empty skill list', () => {
        renderDialog({ skills: [] });
        expect(screen.getByTestId('skill-browser-dialog')).toBeTruthy();
        expect(screen.queryByTestId('skill-picker-section-repo')).toBeNull();
    });
});
