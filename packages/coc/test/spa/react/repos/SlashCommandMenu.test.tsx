/**
 * Tests for SlashCommandMenu — slash-command autocomplete dropdown.
 *
 * Covers rendering, filtering, truncation CSS classes, maxWidth cap,
 * keyboard highlight scrolling, outside-click dismiss, and selection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlashCommandMenu, SkillItem } from '../../../../src/server/spa/client/react/repos/SlashCommandMenu';

// jsdom doesn't implement scrollIntoView
beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
});

// ── Helpers ────────────────────────────────────────────────────────────

const skills: SkillItem[] = [
    { name: 'impl', description: 'Implement code changes with tests' },
    { name: 'draft', description: 'Draft a UX specification' },
    { name: 'go-deep', description: 'Advanced research and verification' },
];

const longDescSkills: SkillItem[] = [
    {
        name: 'verbose-skill',
        description: 'A'.repeat(300),
    },
];

function renderMenu(overrides: Partial<Parameters<typeof SlashCommandMenu>[0]> = {}) {
    const defaults = {
        skills,
        filter: '',
        onSelect: vi.fn(),
        onDismiss: vi.fn(),
        visible: true,
        highlightIndex: 0,
    };
    return render(<SlashCommandMenu {...defaults} {...overrides} />);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('SlashCommandMenu', () => {
    // --- Rendering ---

    it('renders nothing when not visible', () => {
        renderMenu({ visible: false });
        expect(screen.queryByTestId('slash-command-menu')).toBeNull();
    });

    it('renders nothing when filter matches no skills', () => {
        renderMenu({ filter: 'zzz-no-match' });
        expect(screen.queryByTestId('slash-command-menu')).toBeNull();
    });

    it('renders all skills when filter is empty', () => {
        renderMenu();
        const items = screen.getAllByText(/⚡/);
        expect(items).toHaveLength(skills.length);
    });

    it('renders skill names', () => {
        renderMenu();
        expect(screen.getByText('impl')).toBeTruthy();
        expect(screen.getByText('draft')).toBeTruthy();
        expect(screen.getByText('go-deep')).toBeTruthy();
    });

    it('renders descriptions with dash prefix', () => {
        renderMenu();
        expect(screen.getByText(/— Implement code changes/)).toBeTruthy();
    });

    it('omits description span when skill has no description', () => {
        renderMenu({ skills: [{ name: 'no-desc' }] });
        expect(screen.queryByText(/—/)).toBeNull();
    });

    // --- Filtering ---

    it('filters skills by prefix (case-insensitive)', () => {
        renderMenu({ filter: 'IM' });
        expect(screen.getByText('impl')).toBeTruthy();
        expect(screen.queryByText('draft')).toBeNull();
        expect(screen.queryByText('go-deep')).toBeNull();
    });

    it('shows multiple matches when prefix is shared', () => {
        const twoMatches: SkillItem[] = [
            { name: 'go-deep' },
            { name: 'go-fast' },
            { name: 'impl' },
        ];
        renderMenu({ skills: twoMatches, filter: 'go' });
        expect(screen.getByText('go-deep')).toBeTruthy();
        expect(screen.getByText('go-fast')).toBeTruthy();
        expect(screen.queryByText('impl')).toBeNull();
    });

    // --- Truncation / overflow CSS ---

    it('applies maxWidth: 480 to the container', () => {
        renderMenu();
        const menu = screen.getByTestId('slash-command-menu');
        expect(menu.style.maxWidth).toBe('480px');
    });

    it('applies minWidth: 220 to the container', () => {
        renderMenu();
        const menu = screen.getByTestId('slash-command-menu');
        expect(menu.style.minWidth).toBe('220px');
    });

    it('description span has truncate and min-w-0 classes', () => {
        renderMenu();
        const desc = screen.getByText(/— Implement code changes/);
        expect(desc.className).toContain('truncate');
        expect(desc.className).toContain('min-w-0');
    });

    it('menu item row has min-w-0 and overflow-hidden classes', () => {
        renderMenu();
        const menuItems = screen.getByTestId('slash-command-menu').querySelectorAll('[data-menu-item]');
        const first = menuItems[0] as HTMLElement;
        expect(first.className).toContain('min-w-0');
        expect(first.className).toContain('overflow-hidden');
    });

    it('handles very long descriptions without errors', () => {
        renderMenu({ skills: longDescSkills });
        const desc = screen.getByText(/— A{10,}/);
        expect(desc.className).toContain('truncate');
    });

    // --- Highlight ---

    it('applies highlight class to the correct item', () => {
        renderMenu({ highlightIndex: 1 });
        const items = screen.getByTestId('slash-command-menu').querySelectorAll('[data-menu-item]');
        expect((items[0] as HTMLElement).className).toContain('hover:bg-');
        expect((items[1] as HTMLElement).className).toContain('bg-[#e8e8e8]');
    });

    // --- Selection ---

    it('calls onSelect with skill name on mousedown', () => {
        const onSelect = vi.fn();
        renderMenu({ onSelect });
        const item = screen.getByText('draft');
        fireEvent.mouseDown(item);
        expect(onSelect).toHaveBeenCalledWith('draft');
    });

    it('prevents default on mousedown to avoid blur', () => {
        const onSelect = vi.fn();
        renderMenu({ onSelect });
        const item = screen.getByText('impl');
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        const prevented = !item.dispatchEvent(event);
        // The React handler calls e.preventDefault()
        expect(prevented).toBe(true);
    });

    // --- Dismiss on outside click ---

    it('calls onDismiss when clicking outside the menu', () => {
        const onDismiss = vi.fn();
        renderMenu({ onDismiss });
        fireEvent.mouseDown(document.body);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('does not call onDismiss when clicking inside the menu', () => {
        const onDismiss = vi.fn();
        renderMenu({ onDismiss });
        const menu = screen.getByTestId('slash-command-menu');
        fireEvent.mouseDown(menu);
        expect(onDismiss).not.toHaveBeenCalled();
    });

    // --- Position ---

    it('applies custom position when provided', () => {
        renderMenu({ position: { top: 100, left: 50 } });
        const menu = screen.getByTestId('slash-command-menu');
        expect(menu.style.left).toBe('50px');
        expect(menu.style.bottom).toContain('100');
    });

    it('defaults left to 0 when no position is provided', () => {
        renderMenu();
        const menu = screen.getByTestId('slash-command-menu');
        expect(menu.style.left).toBe('0px');
        expect(menu.style.bottom).toBe('100%');
    });
});
