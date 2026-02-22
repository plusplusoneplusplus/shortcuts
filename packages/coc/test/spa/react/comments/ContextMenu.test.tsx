/**
 * Tests for ContextMenu React component.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ContextMenu, clampMenuPosition } from '../../../../src/server/spa/client/react/tasks/comments/ContextMenu';

afterEach(cleanup);

describe('ContextMenu', () => {
    it('renders at the specified position', () => {
        render(
            <ContextMenu
                position={{ x: 120, y: 80 }}
                items={[{ label: 'Test', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        const menu = screen.getByTestId('context-menu');
        expect(menu).toBeTruthy();
    });

    it('renders all menu items', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'Add comment', icon: '💬', onClick: vi.fn() },
                    { label: 'Copy', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText(/Add comment/)).toBeTruthy();
        expect(screen.getByText('Copy')).toBeTruthy();
    });

    it('calls onClick and onClose when an enabled item is clicked', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Action', onClick }]}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByTestId('context-menu-item-0'));
        expect(onClick).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not call onClick when a disabled item is clicked', () => {
        const onClick = vi.fn();
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Disabled', disabled: true, onClick }]}
                onClose={onClose}
            />
        );
        fireEvent.click(screen.getByTestId('context-menu-item-0'));
        expect(onClick).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders icon when provided', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Comment', icon: '💬', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByText('💬')).toBeTruthy();
    });

    it('closes on Escape key', () => {
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Item', onClick: vi.fn() }]}
                onClose={onClose}
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('has menu role', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Item', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByRole('menu')).toBeTruthy();
    });

    it('renders menuitem role on items', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[{ label: 'Item', onClick: vi.fn() }]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    });

    // ── Separator support ──────────────────────────────────────────────

    it('renders separator elements between groups', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'Copy', onClick: vi.fn() },
                    { separator: true, label: '', onClick: vi.fn() },
                    { label: 'Delete', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getAllByRole('separator')).toHaveLength(1);
        expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    });

    it('separator items are not clickable buttons', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'A', onClick: vi.fn() },
                    { separator: true, label: '', onClick: vi.fn() },
                    { label: 'B', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        const seps = screen.getAllByRole('separator');
        expect(seps[0].tagName).toBe('DIV');
    });

    it('item indices skip separators', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'First', onClick: vi.fn() },
                    { separator: true, label: '', onClick: vi.fn() },
                    { label: 'Second', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByTestId('context-menu-item-0').textContent).toContain('First');
        expect(screen.getByTestId('context-menu-item-1').textContent).toContain('Second');
    });

    it('renders multiple separators for multiple groups', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'A', onClick: vi.fn() },
                    { separator: true, label: '', onClick: vi.fn() },
                    { label: 'B', onClick: vi.fn() },
                    { separator: true, label: '', onClick: vi.fn() },
                    { label: 'C', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getAllByRole('separator')).toHaveLength(2);
        expect(screen.getAllByRole('menuitem')).toHaveLength(3);
    });

    // ── Submenu support ──────────────────────────────────────────────

    it('renders a submenu indicator arrow for items with children', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    {
                        label: 'Parent',
                        icon: '▶',
                        onClick: vi.fn(),
                        children: [
                            { label: 'Child A', onClick: vi.fn() },
                            { label: 'Child B', onClick: vi.fn() },
                        ],
                    },
                ]}
                onClose={vi.fn()}
            />
        );
        const parent = screen.getByTestId('context-menu-item-0');
        expect(parent).toBeTruthy();
        expect(parent.textContent).toContain('Parent');
        expect(parent.querySelector('[aria-haspopup="true"]')).toBeTruthy();
    });

    it('shows submenu on hover', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    {
                        label: 'Parent',
                        onClick: vi.fn(),
                        children: [
                            { label: 'Child A', onClick: vi.fn() },
                            { label: 'Child B', onClick: vi.fn() },
                        ],
                    },
                ]}
                onClose={vi.fn()}
            />
        );
        const parent = screen.getByTestId('context-menu-item-0');
        fireEvent.mouseEnter(parent);
        expect(screen.getByTestId('context-submenu-0')).toBeTruthy();
        expect(screen.getByTestId('context-submenu-0-item-0').textContent).toContain('Child A');
        expect(screen.getByTestId('context-submenu-0-item-1').textContent).toContain('Child B');
    });

    it('calls child onClick and onClose when submenu item is clicked', () => {
        const childClick = vi.fn();
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    {
                        label: 'Parent',
                        onClick: vi.fn(),
                        children: [
                            { label: 'Child A', onClick: childClick },
                        ],
                    },
                ]}
                onClose={onClose}
            />
        );
        fireEvent.mouseEnter(screen.getByTestId('context-menu-item-0'));
        fireEvent.click(screen.getByTestId('context-submenu-0-item-0'));
        expect(childClick).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not call onClick for disabled submenu children', () => {
        const childClick = vi.fn();
        const onClose = vi.fn();
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    {
                        label: 'Parent',
                        onClick: vi.fn(),
                        children: [
                            { label: 'Disabled Child', disabled: true, onClick: childClick },
                        ],
                    },
                ]}
                onClose={onClose}
            />
        );
        fireEvent.mouseEnter(screen.getByTestId('context-menu-item-0'));
        fireEvent.click(screen.getByTestId('context-submenu-0-item-0'));
        expect(childClick).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('submenu is not visible before hover', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    {
                        label: 'Parent',
                        onClick: vi.fn(),
                        children: [
                            { label: 'Child', onClick: vi.fn() },
                        ],
                    },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.queryByTestId('context-submenu-0')).toBeNull();
    });

    it('items without children render as regular buttons (no submenu arrow)', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'Regular', onClick: vi.fn() },
                    {
                        label: 'With Sub',
                        onClick: vi.fn(),
                        children: [{ label: 'Child', onClick: vi.fn() }],
                    },
                ]}
                onClose={vi.fn()}
            />
        );
        const regular = screen.getByTestId('context-menu-item-0');
        expect(regular.tagName).toBe('BUTTON');
        expect(regular.querySelector('[aria-haspopup]')).toBeNull();

        const withSub = screen.getByTestId('context-menu-item-1');
        expect(withSub.querySelector('[aria-haspopup="true"]')).toBeTruthy();
    });

    it('submenu items count correctly alongside regular items', () => {
        render(
            <ContextMenu
                position={{ x: 0, y: 0 }}
                items={[
                    { label: 'First', onClick: vi.fn() },
                    {
                        label: 'Parent',
                        onClick: vi.fn(),
                        children: [{ label: 'Child', onClick: vi.fn() }],
                    },
                    { label: 'Last', onClick: vi.fn() },
                ]}
                onClose={vi.fn()}
            />
        );
        expect(screen.getByTestId('context-menu-item-0').textContent).toContain('First');
        expect(screen.getByTestId('context-menu-item-1').textContent).toContain('Parent');
        expect(screen.getByTestId('context-menu-item-2').textContent).toContain('Last');
    });
});

// ── clampMenuPosition unit tests ───────────────────────────────────────

describe('clampMenuPosition', () => {
    const VP_W = 1024;
    const VP_H = 768;
    const MENU_W = 200;
    const MENU_H = 300;
    const MARGIN = 8;

    it('returns the original position when menu fits within viewport', () => {
        const result = clampMenuPosition({ x: 100, y: 100 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result).toEqual({ x: 100, y: 100 });
    });

    it('clamps x when menu overflows the right edge', () => {
        const result = clampMenuPosition({ x: 900, y: 100 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result.x).toBe(VP_W - MENU_W - MARGIN);
        expect(result.y).toBe(100);
    });

    it('clamps y when menu overflows the bottom edge', () => {
        const result = clampMenuPosition({ x: 100, y: 600 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result.x).toBe(100);
        expect(result.y).toBe(VP_H - MENU_H - MARGIN);
    });

    it('clamps both x and y when menu overflows bottom-right corner', () => {
        const result = clampMenuPosition({ x: 900, y: 600 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result.x).toBe(VP_W - MENU_W - MARGIN);
        expect(result.y).toBe(VP_H - MENU_H - MARGIN);
    });

    it('clamps x to margin when position is negative', () => {
        const result = clampMenuPosition({ x: -50, y: 100 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result.x).toBe(MARGIN);
        expect(result.y).toBe(100);
    });

    it('clamps y to margin when position is negative', () => {
        const result = clampMenuPosition({ x: 100, y: -20 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result.x).toBe(100);
        expect(result.y).toBe(MARGIN);
    });

    it('clamps both axes when position is negative on both', () => {
        const result = clampMenuPosition({ x: -10, y: -10 }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result.x).toBe(MARGIN);
        expect(result.y).toBe(MARGIN);
    });

    it('handles menu exactly at the edge (no overflow)', () => {
        const x = VP_W - MENU_W - MARGIN;
        const y = VP_H - MENU_H - MARGIN;
        const result = clampMenuPosition({ x, y }, MENU_W, MENU_H, VP_W, VP_H, MARGIN);
        expect(result).toEqual({ x, y });
    });

    it('handles zero-size menu', () => {
        const result = clampMenuPosition({ x: 500, y: 400 }, 0, 0, VP_W, VP_H, MARGIN);
        expect(result).toEqual({ x: 500, y: 400 });
    });

    it('handles custom margin', () => {
        const result = clampMenuPosition({ x: 1000, y: 100 }, MENU_W, MENU_H, VP_W, VP_H, 20);
        expect(result.x).toBe(VP_W - MENU_W - 20);
    });

    it('handles very small viewport', () => {
        const result = clampMenuPosition({ x: 50, y: 50 }, MENU_W, MENU_H, 100, 100, MARGIN);
        expect(result.x).toBe(MARGIN);
        expect(result.y).toBe(MARGIN);
    });
});
