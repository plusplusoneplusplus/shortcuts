/**
 * Tests for DiffViewToggle — single toggle buttons for diff view mode and engine.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DiffViewToggle, DiffEngineToggle } from '../../../../src/server/spa/client/react/features/git/diff/DiffViewToggle';

describe('DiffViewToggle', () => {
    it('shows only the current mode as one button', () => {
        render(<DiffViewToggle mode="unified" onChange={() => {}} />);
        const btn = screen.getByTestId('diff-view-toggle');
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.textContent).toBe('☰Unified');
        expect(btn.getAttribute('data-value')).toBe('unified');
        expect(screen.getAllByRole('button')).toHaveLength(1);
        expect(screen.queryByText('Split')).toBeNull();
    });

    it('clicking switches to the other mode, both ways', () => {
        const onChange = vi.fn();
        const { rerender } = render(<DiffViewToggle mode="unified" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('diff-view-toggle'));
        expect(onChange).toHaveBeenLastCalledWith('split');
        rerender(<DiffViewToggle mode="split" onChange={onChange} />);
        expect(screen.getByTestId('diff-view-toggle').textContent).toBe('⬜Split');
        fireEvent.click(screen.getByTestId('diff-view-toggle'));
        expect(onChange).toHaveBeenLastCalledWith('unified');
    });

    it('keeps an accessible name and tooltip naming the switch target when the label collapses', () => {
        render(<DiffViewToggle mode="unified" onChange={() => {}} />);
        const btn = screen.getByTestId('diff-view-toggle');
        expect(btn.getAttribute('aria-label')).toBe('Unified view — switch to Split');
        expect(btn.getAttribute('title')).toBe('Unified view — switch to Split');
        expect(btn.className).toContain('whitespace-nowrap');
        expect(screen.getByTestId('diff-view-toggle-label').className).toContain('[@container_(max-width:559px)]:hidden');
    });

    it('quiet appearance uses a line icon for the current mode', () => {
        const onChange = vi.fn();
        render(<DiffViewToggle mode="split" onChange={onChange} appearance="quiet" />);
        const btn = screen.getByRole('button', { name: 'Split view — switch to Unified' });
        expect(btn.querySelector('svg path')?.getAttribute('d')).toBe('M8 2v12');
        expect(btn.textContent).toBe('Split');
        fireEvent.click(btn);
        expect(onChange).toHaveBeenCalledWith('unified');
    });
});

describe('DiffEngineToggle', () => {
    it('shows only the current engine and switches to the other on click', () => {
        const onChange = vi.fn();
        const { rerender } = render(<DiffEngineToggle engine="monaco" onChange={onChange} />);
        const btn = screen.getByTestId('diff-engine-toggle');
        expect(btn.textContent).toBe('✎Editor');
        expect(screen.queryByText('Classic')).toBeNull();
        fireEvent.click(btn);
        expect(onChange).toHaveBeenLastCalledWith('legacy');
        rerender(<DiffEngineToggle engine="legacy" onChange={onChange} />);
        expect(screen.getByTestId('diff-engine-toggle').textContent).toBe('≡Classic');
        expect(screen.getByTestId('diff-engine-toggle').getAttribute('title')).toBe('Classic diff viewer — switch to Editor');
        fireEvent.click(screen.getByTestId('diff-engine-toggle'));
        expect(onChange).toHaveBeenLastCalledWith('monaco');
    });
});
