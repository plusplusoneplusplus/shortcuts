/**
 * Tests for SearchBar component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBar } from '../../../../../src/server/spa/client/react/repos/explorer/SearchBar';
import { createRef } from 'react';

describe('SearchBar', () => {
    it('renders input with default placeholder "Filter files…"', () => {
        render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} />);
        const input = screen.getByTestId('explorer-search-input');
        expect(input).toBeDefined();
        expect(input.getAttribute('placeholder')).toBe('Filter files…');
    });

    it('renders input with custom placeholder', () => {
        render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} placeholder="Search…" />);
        const input = screen.getByTestId('explorer-search-input');
        expect(input.getAttribute('placeholder')).toBe('Search…');
    });

    it('calls onChange on user typing', () => {
        const onChange = vi.fn();
        render(<SearchBar value="" onChange={onChange} onClear={vi.fn()} />);
        const input = screen.getByTestId('explorer-search-input');
        fireEvent.change(input, { target: { value: 'test' } });
        expect(onChange).toHaveBeenCalledWith('test');
    });

    it('shows clear button only when value is non-empty', () => {
        const { rerender } = render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} />);
        expect(screen.queryByTestId('explorer-search-clear')).toBeNull();

        rerender(<SearchBar value="abc" onChange={vi.fn()} onClear={vi.fn()} />);
        expect(screen.getByTestId('explorer-search-clear')).toBeDefined();
    });

    it('calls onClear on clear button click', () => {
        const onClear = vi.fn();
        render(<SearchBar value="abc" onChange={vi.fn()} onClear={onClear} />);
        fireEvent.click(screen.getByTestId('explorer-search-clear'));
        expect(onClear).toHaveBeenCalledOnce();
    });

    it('forwards inputRef for programmatic focus', () => {
        const inputRef = createRef<HTMLInputElement>();
        render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} inputRef={inputRef} />);
        expect(inputRef.current).toBeDefined();
        expect(inputRef.current?.tagName).toBe('INPUT');
    });

    it('has data-testid="explorer-search-bar" on container', () => {
        render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} />);
        expect(screen.getByTestId('explorer-search-bar')).toBeDefined();
    });

    it('displays the current value', () => {
        render(<SearchBar value="hello" onChange={vi.fn()} onClear={vi.fn()} />);
        const input = screen.getByTestId('explorer-search-input') as HTMLInputElement;
        expect(input.value).toBe('hello');
    });
});
