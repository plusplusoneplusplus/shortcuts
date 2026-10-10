// @vitest-environment jsdom
/**
 * Unit tests for `useAdminSaveShortcut` — the shared Ctrl/Cmd+S handler for
 * the admin configuration pages.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAdminSaveShortcut, type AdminSaveShortcutTarget } from '../../../../src/server/spa/client/react/admin/useAdminSaveShortcut';

function press(init: KeyboardEventInit = { key: 's', ctrlKey: true }): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
    window.dispatchEvent(event);
    return event;
}

function render(active: boolean, target: AdminSaveShortcutTarget | AdminSaveShortcutTarget[] | null) {
    const targets = target === null ? [] : Array.isArray(target) ? target : [target];
    return renderHook(
        ({ active, targets }: { active: boolean; targets: AdminSaveShortcutTarget[] }) => useAdminSaveShortcut(active, targets),
        { initialProps: { active, targets } },
    );
}

describe('useAdminSaveShortcut', () => {
    it.each([
        ['Ctrl+S', { key: 's', ctrlKey: true }],
        ['Command+S', { key: 's', metaKey: true }],
        ['uppercase S', { key: 'S', ctrlKey: true }],
    ])('%s saves a dirty section', (_label, init) => {
        const onSave = vi.fn();
        render(true, { dirty: true, saving: false, onSave });
        const event = press(init);
        expect(event.defaultPrevented).toBe(true);
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('prevents the browser dialog but does not save a clean section', () => {
        const onSave = vi.fn();
        render(true, { dirty: false, saving: false, onSave });
        expect(press().defaultPrevented).toBe(true);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('does not save while a save is in flight', () => {
        const onSave = vi.fn();
        render(true, { dirty: true, saving: true, onSave });
        expect(press().defaultPrevented).toBe(true);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('prevents the browser dialog for a section without a save target', () => {
        render(true, null);
        expect(press().defaultPrevented).toBe(true);
    });

    it('ignores the shortcut when inactive', () => {
        const onSave = vi.fn();
        render(false, { dirty: true, saving: false, onSave });
        expect(press().defaultPrevented).toBe(false);
        expect(onSave).not.toHaveBeenCalled();
    });

    it.each([
        ['Alt', { key: 's', ctrlKey: true, altKey: true }],
        ['Shift', { key: 's', ctrlKey: true, shiftKey: true }],
        ['no modifier', { key: 's' }],
        ['other key', { key: 'p', ctrlKey: true }],
    ])('ignores %s', (_label, init) => {
        const onSave = vi.fn();
        render(true, { dirty: true, saving: false, onSave });
        expect(press(init).defaultPrevented).toBe(false);
        expect(onSave).not.toHaveBeenCalled();
    });

    it('uses the latest target after a rerender (tab switch)', () => {
        const first = vi.fn();
        const second = vi.fn();
        const view = render(true, { dirty: true, saving: false, onSave: first });
        view.rerender({ active: true, targets: [{ dirty: true, saving: false, onSave: second }] });
        press();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    // Regression: multi-card pages (a section card plus its feature card)
    // must save every dirty card, not just the first.
    it('saves every dirty target and skips clean or in-flight ones', () => {
        const dirty = vi.fn();
        const clean = vi.fn();
        const inFlight = vi.fn();
        const alsoDirty = vi.fn();
        render(true, [
            { dirty: true, saving: false, onSave: dirty },
            { dirty: false, saving: false, onSave: clean },
            { dirty: true, saving: true, onSave: inFlight },
            { dirty: true, saving: false, onSave: alsoDirty },
        ]);
        expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(true);
        expect(dirty).toHaveBeenCalledTimes(1);
        expect(alsoDirty).toHaveBeenCalledTimes(1);
        expect(clean).not.toHaveBeenCalled();
        expect(inFlight).not.toHaveBeenCalled();
    });

    it('does not save again once the target reports saving', () => {
        const onSave = vi.fn();
        const view = render(true, { dirty: true, saving: false, onSave });
        press();
        view.rerender({ active: true, targets: [{ dirty: true, saving: true, onSave }] });
        press();
        expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('removes the listener on unmount', () => {
        const onSave = vi.fn();
        const view = render(true, { dirty: true, saving: false, onSave });
        view.unmount();
        expect(press().defaultPrevented).toBe(false);
        expect(onSave).not.toHaveBeenCalled();
    });
});
