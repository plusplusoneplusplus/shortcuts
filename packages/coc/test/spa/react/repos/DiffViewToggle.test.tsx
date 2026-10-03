/**
 * Tests for DiffViewToggle — segmented button pair for switching diff view mode.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DiffViewToggle } from '../../../../src/server/spa/client/react/features/git/diff/DiffViewToggle';

describe('DiffViewToggle', () => {
    it('renders both buttons with correct labels', () => {
        render(<DiffViewToggle mode="unified" onChange={() => {}} />);
        expect(screen.getByTestId('diff-view-toggle-unified')).toBeTruthy();
        expect(screen.getByTestId('diff-view-toggle-split')).toBeTruthy();
        expect(screen.getByTestId('diff-view-toggle-unified').textContent).toBe('☰Unified');
        expect(screen.getByTestId('diff-view-toggle-split').textContent).toBe('⬜Split');
    });

    it('keeps an accessible name and tooltip when the label collapses to an icon', () => {
        render(<DiffViewToggle mode="unified" onChange={() => {}} />);
        for (const [value, name] of [['unified', 'Unified view'], ['split', 'Split view']]) {
            const btn = screen.getByTestId(`diff-view-toggle-${value}`);
            expect(btn.getAttribute('aria-label')).toBe(name);
            expect(btn.getAttribute('title')).toBe(name);
            expect(btn.className).toContain('whitespace-nowrap');
            expect(screen.getByTestId(`diff-view-toggle-${value}-label`).className).toContain('[@container_(max-width:559px)]:hidden');
        }
    });

    it('quiet appearance uses line icons and retains accessible selection and switching', () => {
        const onChange = vi.fn();
        render(<DiffViewToggle mode="unified" onChange={onChange} appearance="quiet" />);
        const unified = screen.getByRole('button', { name: 'Unified view' });
        const split = screen.getByRole('button', { name: 'Split view' });
        expect(unified.getAttribute('aria-pressed')).toBe('true');
        expect(unified.className).toContain('bg-[#e8f0fc]');
        expect(split.querySelector('svg')).toBeTruthy();
        expect(split.textContent).toBe('Split');
        fireEvent.click(split);
        expect(onChange).toHaveBeenCalledWith('split');
    });

    it('active button has aria-pressed="true", inactive has aria-pressed="false" (unified mode)', () => {
        render(<DiffViewToggle mode="unified" onChange={() => {}} />);
        expect(screen.getByTestId('diff-view-toggle-unified').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('diff-view-toggle-split').getAttribute('aria-pressed')).toBe('false');
    });

    it('active button has aria-pressed="true", inactive has aria-pressed="false" (split mode)', () => {
        render(<DiffViewToggle mode="split" onChange={() => {}} />);
        expect(screen.getByTestId('diff-view-toggle-split').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('diff-view-toggle-unified').getAttribute('aria-pressed')).toBe('false');
    });

    it('clicking the inactive button calls onChange with the correct mode', () => {
        const onChange = vi.fn();
        render(<DiffViewToggle mode="unified" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('diff-view-toggle-split'));
        expect(onChange).toHaveBeenCalledWith('split');
    });

    it('clicking the active button still calls onChange (idempotent)', () => {
        const onChange = vi.fn();
        render(<DiffViewToggle mode="unified" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('diff-view-toggle-unified'));
        expect(onChange).toHaveBeenCalledWith('unified');
    });

    it('renders the container with correct accessibility attributes', () => {
        render(<DiffViewToggle mode="unified" onChange={() => {}} />);
        const group = screen.getByTestId('diff-view-toggle');
        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-label')).toBe('Diff view mode');
    });
});
