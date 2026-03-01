/**
 * Tests for ContextMenu — mobile BottomSheet rendering.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextMenu } from '../../../../../src/server/spa/client/react/tasks/comments/ContextMenu';
import { mockViewport } from '../../../helpers/viewport-mock';

describe('ContextMenu mobile rendering', () => {
    let viewportCleanup: (() => void) | undefined;

    afterEach(() => {
        viewportCleanup?.();
        viewportCleanup = undefined;
    });

    const items = [
        { label: 'Cut', icon: '✂️', onClick: vi.fn() },
        { label: 'Copy', icon: '📋', onClick: vi.fn() },
        { label: 'Paste', icon: '📄', onClick: vi.fn() },
    ];

    it('renders as BottomSheet on mobile viewport', () => {
        viewportCleanup = mockViewport(375);
        render(
            <ContextMenu
                position={{ x: 100, y: 100 }}
                items={items}
                onClose={vi.fn()}
            />
        );
        // BottomSheet renders a backdrop with data-testid="bottomsheet-backdrop"
        expect(document.querySelector('[data-testid="bottomsheet-backdrop"]')).not.toBeNull();
        // Should not have the desktop floating menu
        expect(document.querySelector('[data-testid="context-menu"]')).toBeNull();
    });

    it('renders as floating menu on desktop viewport', () => {
        viewportCleanup = mockViewport(1280);
        render(
            <ContextMenu
                position={{ x: 100, y: 100 }}
                items={items}
                onClose={vi.fn()}
            />
        );
        expect(document.querySelector('[data-testid="context-menu"]')).not.toBeNull();
        expect(document.querySelector('[data-testid="bottomsheet-backdrop"]')).toBeNull();
    });

    it('flattens submenus in BottomSheet mode', () => {
        viewportCleanup = mockViewport(375);
        const itemsWithChildren = [
            { label: 'Edit', icon: '✏️', onClick: vi.fn(), children: [
                { label: 'Undo', icon: '↩️', onClick: vi.fn() },
                { label: 'Redo', icon: '↪️', onClick: vi.fn() },
            ] },
            { label: 'Delete', icon: '🗑️', onClick: vi.fn() },
        ];
        render(
            <ContextMenu
                position={{ x: 100, y: 100 }}
                items={itemsWithChildren as any}
                onClose={vi.fn()}
            />
        );
        // "Edit" appears as section header, "Undo" and "Redo" as flat items, "Delete" as regular item
        expect(screen.getByText('Edit')).toBeDefined();
        expect(screen.getByText('Undo')).toBeDefined();
        expect(screen.getByText('Redo')).toBeDefined();
        expect(screen.getByText('Delete')).toBeDefined();
    });

    it('mobile menu items have min-h-[44px] class', () => {
        viewportCleanup = mockViewport(375);
        render(
            <ContextMenu
                position={{ x: 100, y: 100 }}
                items={items}
                onClose={vi.fn()}
            />
        );
        const buttons = document.querySelectorAll('[role="menuitem"]');
        expect(buttons.length).toBeGreaterThan(0);
        for (const btn of buttons) {
            expect((btn as HTMLElement).className).toContain('min-h-[44px]');
        }
    });
});
