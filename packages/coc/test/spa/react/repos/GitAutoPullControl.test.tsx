/**
 * Tests for GitAutoPullControl — the per-repo auto-pull interval selector.
 *
 * Covers AC-2: default Off, selecting a preset, entering a valid custom value,
 * rejecting an invalid custom value (affordance + no persist), reflecting the
 * persisted value on (re)mount, and dropdown open/close behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GitAutoPullControl, type AutoPullSetting } from '../../../../src/server/spa/client/react/features/git/GitAutoPullControl';

function renderControl(overrides: Partial<Parameters<typeof GitAutoPullControl>[0]> = {}) {
    const onChange = overrides.onChange ?? vi.fn();
    const utils = render(<GitAutoPullControl value={overrides.value} onChange={onChange} compact={overrides.compact} />);
    return { ...utils, onChange };
}

function open() {
    fireEvent.click(screen.getByTestId('git-autopull-toggle'));
}

// ── Default (Off) ───────────────────────────────────────────────────────────

describe('default Off', () => {
    it('shows "Off" on the toggle when value is undefined', () => {
        renderControl();
        expect(screen.getByTestId('git-autopull-current').textContent).toBe('Off');
    });

    it('shows "Off" when value is present but disabled', () => {
        renderControl({ value: { enabled: false, intervalMinutes: 15 } });
        expect(screen.getByTestId('git-autopull-current').textContent).toBe('Off');
    });

    it('dropdown is closed by default', () => {
        renderControl();
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });

    it('marks the Off option as selected when disabled', () => {
        renderControl();
        open();
        expect(screen.getByTestId('git-autopull-option-off').textContent).toContain('✓');
    });
});

// ── Selecting a preset ──────────────────────────────────────────────────────

describe('selecting a preset', () => {
    it('renders all five preset options', () => {
        renderControl();
        open();
        for (const min of [1, 5, 15, 30, 60]) {
            expect(screen.getByTestId(`git-autopull-option-${min}`)).toBeTruthy();
        }
    });

    it('enables auto-pull with the chosen preset interval', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-5'));
        expect(onChange).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 5 });
    });

    it('closes the dropdown after selecting a preset', () => {
        renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-15'));
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });

    it('reflects an enabled preset value on the toggle and marks it selected', () => {
        renderControl({ value: { enabled: true, intervalMinutes: 30 } });
        expect(screen.getByTestId('git-autopull-current').textContent).toBe('30m');
        open();
        expect(screen.getByTestId('git-autopull-option-30').textContent).toContain('✓');
        expect(screen.getByTestId('git-autopull-option-off').textContent).not.toContain('✓');
    });
});

// ── Turning Off ─────────────────────────────────────────────────────────────

describe('turning off', () => {
    it('disables while preserving the last interval so re-enabling restores it', () => {
        const { onChange } = renderControl({ value: { enabled: true, intervalMinutes: 15 } });
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-off'));
        expect(onChange).toHaveBeenCalledWith({ enabled: false, intervalMinutes: 15 });
    });
});

// ── Custom value ────────────────────────────────────────────────────────────

describe('custom value', () => {
    it('enables auto-pull with a valid custom interval on Set', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '12' } });
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(onChange).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 12 });
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });

    it('applies a valid custom interval on Enter', () => {
        const { onChange } = renderControl();
        open();
        const input = screen.getByTestId('git-autopull-custom-input');
        fireEvent.change(input, { target: { value: '7' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 7 });
    });

    it('seeds the custom field with the active custom value when opened', () => {
        renderControl({ value: { enabled: true, intervalMinutes: 12 } });
        expect(screen.getByTestId('git-autopull-current').textContent).toBe('12m');
        open();
        expect((screen.getByTestId('git-autopull-custom-input') as HTMLInputElement).value).toBe('12');
        // A non-preset custom value must not mark any preset as selected.
        expect(screen.getByTestId('git-autopull-option-5').textContent).not.toContain('✓');
    });

    it('rejects a below-range value with an affordance and does not persist', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByTestId('git-autopull-custom-error')).toBeTruthy();
        // Dropdown stays open so the user can correct the value.
        expect(screen.getByTestId('git-autopull-dropdown')).toBeTruthy();
    });

    it('rejects an above-max value and does not persist', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '9999' } });
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByTestId('git-autopull-custom-error')).toBeTruthy();
    });

    it('rejects a non-integer value and does not persist', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '3.5' } });
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByTestId('git-autopull-custom-error')).toBeTruthy();
    });

    it('rejects an empty value and does not persist', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByTestId('git-autopull-custom-error')).toBeTruthy();
    });

    it('clears the error affordance once the user edits the field again', () => {
        renderControl();
        open();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(screen.getByTestId('git-autopull-custom-error')).toBeTruthy();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '10' } });
        expect(screen.queryByTestId('git-autopull-custom-error')).toBeNull();
    });
});

// ── Dropdown lifecycle ──────────────────────────────────────────────────────

describe('dropdown lifecycle', () => {
    it('opens on toggle click', () => {
        renderControl();
        open();
        expect(screen.getByTestId('git-autopull-dropdown')).toBeTruthy();
    });

    it('closes on a second toggle click', () => {
        renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-toggle'));
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });

    it('closes on outside click', () => {
        renderControl();
        open();
        expect(screen.getByTestId('git-autopull-dropdown')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });
});

// ── Compact variant ─────────────────────────────────────────────────────────

describe('compact variant', () => {
    it('renders the toggle in compact mode', () => {
        const value: AutoPullSetting = { enabled: true, intervalMinutes: 5 };
        renderControl({ value, compact: true });
        const toggle = screen.getByTestId('git-autopull-toggle');
        expect(toggle.className).toContain('h-[18px]');
    });
});
