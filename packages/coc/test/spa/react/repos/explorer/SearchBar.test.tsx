import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBar, type SearchBarToggle } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/SearchBar';
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

    it('renders no toggles by default', () => {
        render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} />);
        expect(document.querySelectorAll('[data-testid^="explorer-search-toggle-"]')).toHaveLength(0);
    });

    describe('mode toggles (content search)', () => {
        const toggle = (overrides: Partial<SearchBarToggle> = {}): SearchBarToggle => ({
            id: 'case',
            label: 'Aa',
            title: 'Match case',
            active: false,
            onToggle: vi.fn(),
            ...overrides,
        });

        it('renders one button per toggle, keyed by its id', () => {
            render(
                <SearchBar
                    value=""
                    onChange={vi.fn()}
                    onClear={vi.fn()}
                    toggles={[toggle(), toggle({ id: 'regex', label: '.*', title: 'Use regular expression' })]}
                />,
            );
            expect(screen.getByTestId('explorer-search-toggle-case').textContent).toBe('Aa');
            expect(screen.getByTestId('explorer-search-toggle-regex').textContent).toBe('.*');
        });

        it('exposes the toggle title as its accessible name', () => {
            render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} toggles={[toggle()]} />);
            expect(screen.getByLabelText('Match case')).toBeDefined();
        });

        it('reflects the active state through aria-pressed', () => {
            const { rerender } = render(
                <SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} toggles={[toggle()]} />,
            );
            expect(screen.getByTestId('explorer-search-toggle-case').getAttribute('aria-pressed')).toBe('false');

            rerender(
                <SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} toggles={[toggle({ active: true })]} />,
            );
            expect(screen.getByTestId('explorer-search-toggle-case').getAttribute('aria-pressed')).toBe('true');
        });

        it('calls onToggle on click', () => {
            const onToggle = vi.fn();
            render(<SearchBar value="" onChange={vi.fn()} onClear={vi.fn()} toggles={[toggle({ onToggle })]} />);
            fireEvent.click(screen.getByTestId('explorer-search-toggle-case'));
            expect(onToggle).toHaveBeenCalledOnce();
        });

        it('reserves input padding for the toggles so text never slides under them', () => {
            render(
                <SearchBar
                    value=""
                    onChange={vi.fn()}
                    onClear={vi.fn()}
                    toggles={[toggle(), toggle({ id: 'word' }), toggle({ id: 'regex' })]}
                />,
            );
            const input = screen.getByTestId('explorer-search-input') as HTMLInputElement;
            expect(input.style.paddingRight).toBe('106px');
        });
    });

    describe('testIdPrefix override', () => {
        it('derives every id from the prefix, leaving the default ids unused', () => {
            render(
                <SearchBar
                    value="abc"
                    onChange={vi.fn()}
                    onClear={vi.fn()}
                    testIdPrefix="content-search"
                    toggles={[{ id: 'case', label: 'Aa', title: 'Match case', active: false, onToggle: vi.fn() }]}
                />,
            );
            expect(screen.getByTestId('content-search-bar')).toBeDefined();
            expect(screen.getByTestId('content-search-input')).toBeDefined();
            expect(screen.getByTestId('content-search-clear')).toBeDefined();
            expect(screen.getByTestId('content-search-toggle-case')).toBeDefined();
            expect(screen.queryByTestId('explorer-search-input')).toBeNull();
            expect(screen.queryByTestId('explorer-search-bar')).toBeNull();
        });
    });
});
