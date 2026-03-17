/**
 * Tests for the FilterDropdown shared component.
 *
 * Source-code inspection tests that verify structure, props, and behaviour
 * without a full DOM rendering environment.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FILTER_DROPDOWN_PATH = path.join(
    __dirname, '..', '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'shared', 'FilterDropdown.tsx'
);

describe('FilterDropdown component', () => {
    let source: string;

    beforeAll(() => {
        source = fs.readFileSync(FILTER_DROPDOWN_PATH, 'utf-8');
    });

    describe('exports', () => {
        it('exports FilterDropdown function', () => {
            expect(source).toContain('export function FilterDropdown(');
        });

        it('exports FilterItem interface', () => {
            expect(source).toContain('export interface FilterItem');
        });

        it('exports FilterDropdownProps interface', () => {
            expect(source).toContain('export interface FilterDropdownProps');
        });
    });

    describe('FilterItem type', () => {
        it('has value, label, and optional children fields', () => {
            const iface = source.substring(
                source.indexOf('export interface FilterItem'),
                source.indexOf('export interface FilterItem') + 150,
            );
            expect(iface).toContain('value: string');
            expect(iface).toContain('label: string');
            expect(iface).toContain('children?: FilterItem[]');
        });
    });

    describe('props', () => {
        it('accepts items: FilterItem[]', () => {
            expect(source).toContain('items: FilterItem[]');
        });

        it('accepts excludedValues: Set<string>', () => {
            expect(source).toContain('excludedValues: Set<string>');
        });

        it('accepts onChange callback', () => {
            expect(source).toContain('onChange: (excluded: Set<string>) => void');
        });

        it('accepts optional label prop', () => {
            expect(source).toContain("label?: string");
        });

        it('accepts data-testid prop', () => {
            expect(source).toContain("'data-testid'?: string");
        });
    });

    describe('trigger button', () => {
        it('renders trigger button with data-testid', () => {
            expect(source).toContain('data-testid="filter-dropdown-trigger"');
        });

        it('shows active count badge when excludedValues is non-empty', () => {
            expect(source).toContain('data-testid="filter-dropdown-badge"');
            expect(source).toContain('activeCount > 0');
        });

        it('sets aria-haspopup on trigger', () => {
            expect(source).toContain('aria-haspopup="listbox"');
        });

        it('sets aria-expanded on trigger', () => {
            expect(source).toContain('aria-expanded={open}');
        });

        it('toggles open state on click', () => {
            expect(source).toContain("setOpen(o => !o)");
        });
    });

    describe('popover', () => {
        it('renders popover with data-testid when open', () => {
            expect(source).toContain('data-testid="filter-dropdown-popover"');
        });

        it('renders checkboxes with data-testid per item value', () => {
            expect(source).toContain('data-testid={`filter-checkbox-${item.value}`}');
        });

        it('renders children checkboxes with data-testid', () => {
            expect(source).toContain('data-testid={`filter-checkbox-${child.value}`}');
        });

        it('renders children indented under parent', () => {
            expect(source).toContain('pl-7');
        });

        it('disables child checkboxes when parent is excluded', () => {
            expect(source).toContain('disabled={parentExcluded}');
        });

        it('dims children when parent is excluded', () => {
            expect(source).toContain('opacity-50 cursor-not-allowed');
        });
    });

    describe('footer actions', () => {
        it('renders Select All button with data-testid', () => {
            expect(source).toContain('data-testid="filter-dropdown-select-all"');
        });

        it('renders Clear button with data-testid', () => {
            expect(source).toContain('data-testid="filter-dropdown-clear"');
        });

        it('selectAll calls onChange with empty set', () => {
            expect(source).toContain('onChange(new Set())');
        });

        it('clearAll adds all item and child values to excluded set', () => {
            const fn = source.substring(
                source.indexOf('clearAll = useCallback'),
                source.indexOf('clearAll = useCallback') + 300,
            );
            expect(fn).toContain('next.add(item.value)');
            expect(fn).toContain('next.add(child.value)');
        });
    });

    describe('close behaviour', () => {
        it('listens for mousedown to close on outside click', () => {
            expect(source).toContain("document.addEventListener('mousedown'");
        });

        it('listens for keydown to close on Escape', () => {
            expect(source).toContain("document.addEventListener('keydown'");
            expect(source).toContain("e.key === 'Escape'");
        });

        it('returns cleanup functions for both event listeners', () => {
            const cleanupCount = (source.match(/document\.removeEventListener/g) || []).length;
            expect(cleanupCount).toBeGreaterThanOrEqual(2);
        });
    });

    describe('toggle logic', () => {
        it('defines toggle callback', () => {
            expect(source).toContain('toggle = useCallback(');
        });

        it('excludes parent and clears children on parent toggle-off', () => {
            const fn = source.substring(
                source.indexOf('toggle = useCallback'),
                source.indexOf('toggle = useCallback') + 500,
            );
            expect(fn).toContain('next.add(value)');
            // Clearing children when parent is excluded
            expect(fn).toContain('next.delete(child.value)');
        });

        it('re-enables parent and clears children on parent toggle-on', () => {
            const fn = source.substring(
                source.indexOf('toggle = useCallback'),
                source.indexOf('toggle = useCallback') + 500,
            );
            expect(fn).toContain('next.delete(value)');
        });
    });
});
