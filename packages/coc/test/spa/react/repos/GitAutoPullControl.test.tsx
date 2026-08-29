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
    const utils = render(
        <GitAutoPullControl
            value={overrides.value}
            onChange={onChange}
            status={overrides.status}
            compact={overrides.compact}
        />,
    );
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

    it('keeps the 30-minute default interval when Off is selected without a prior value', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-off'));
        expect(onChange).toHaveBeenCalledWith({ enabled: false, intervalMinutes: 30 });
    });
});

// ── Selecting a preset ──────────────────────────────────────────────────────

describe('selecting a preset', () => {
    it('renders all five preset options with their intended labels', () => {
        renderControl();
        open();
        for (const [min, label] of [[30, '30m'], [60, '1h'], [240, '4h'], [480, '8h'], [1440, '1d']] as const) {
            expect(screen.getByTestId(`git-autopull-option-${min}`)).toBeTruthy();
            expect(screen.getByTestId(`git-autopull-option-${min}`).textContent).toContain(label);
        }
    });

    it('enables auto-pull with the chosen preset interval', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-60'));
        expect(onChange).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 60 });
    });

    it('closes the dropdown after selecting a preset', () => {
        renderControl();
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-240'));
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });

    it('reflects an enabled preset value on the toggle and marks it selected', () => {
        renderControl({ value: { enabled: true, intervalMinutes: 60 } });
        expect(screen.getByTestId('git-autopull-current').textContent).toBe('1h');
        open();
        expect(screen.getByTestId('git-autopull-option-60').textContent).toContain('✓');
        expect(screen.getByTestId('git-autopull-option-off').textContent).not.toContain('✓');
    });
});

// ── Turning Off ─────────────────────────────────────────────────────────────

describe('turning off', () => {
    it('disables while preserving the last interval so re-enabling restores it', () => {
        const { onChange } = renderControl({ value: { enabled: true, intervalMinutes: 120 } });
        open();
        fireEvent.click(screen.getByTestId('git-autopull-option-off'));
        expect(onChange).toHaveBeenCalledWith({ enabled: false, intervalMinutes: 120 });
    });
});

// ── Custom value ────────────────────────────────────────────────────────────

describe('custom hours', () => {
    it('enables auto-pull with a valid custom hour value on Set', () => {
        const { onChange } = renderControl();
        open();
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '12' } });
        fireEvent.click(screen.getByTestId('git-autopull-custom-apply'));
        expect(onChange).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 720 });
        expect(screen.queryByTestId('git-autopull-dropdown')).toBeNull();
    });

    it('applies a valid custom hour value on Enter', () => {
        const { onChange } = renderControl();
        open();
        const input = screen.getByTestId('git-autopull-custom-input');
        fireEvent.change(input, { target: { value: '7' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onChange).toHaveBeenCalledWith({ enabled: true, intervalMinutes: 420 });
    });

    it('seeds the custom field with the active custom hour value when opened', () => {
        renderControl({ value: { enabled: true, intervalMinutes: 120 } });
        expect(screen.getByTestId('git-autopull-current').textContent).toBe('2h');
        open();
        expect((screen.getByTestId('git-autopull-custom-input') as HTMLInputElement).value).toBe('2');
        // A non-preset custom value must not mark any preset as selected.
        expect(screen.getByTestId('git-autopull-option-60').textContent).not.toContain('✓');
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
        fireEvent.change(screen.getByTestId('git-autopull-custom-input'), { target: { value: '25' } });
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
        const value: AutoPullSetting = { enabled: true, intervalMinutes: 60 };
        renderControl({ value, compact: true });
        const toggle = screen.getByTestId('git-autopull-toggle');
        expect(toggle.className).toContain('h-[18px]');
    });
});

// ── Server-owned status (AC-05) ─────────────────────────────────────────────

describe('server-owned status', () => {
    /** Far enough out that the label is stable regardless of when the test runs. */
    function statusIn(minutes: number, extra: Record<string, unknown> = {}) {
        return {
            enabled: true,
            intervalMinutes: 30,
            nextRunAt: new Date(Date.now() + minutes * 60_000).toISOString(),
            ...extra,
        } as any;
    }

    it('renders nothing extra when the server has no status yet', () => {
        renderControl({ value: { enabled: true, intervalMinutes: 30 } });
        expect(screen.queryByTestId('git-autopull-next-run')).toBeNull();
        open();
        expect(screen.queryByTestId('git-autopull-status')).toBeNull();
    });

    it('shows the server countdown in the pill', () => {
        renderControl({ value: { enabled: true, intervalMinutes: 30 }, status: statusIn(10) });
        expect(screen.getByTestId('git-autopull-next-run').textContent).toBe('in 10m');
    });

    it('omits the countdown while auto-pull is off', () => {
        renderControl({ value: { enabled: false, intervalMinutes: 30 }, status: statusIn(10) });
        expect(screen.queryByTestId('git-autopull-next-run')).toBeNull();
    });

    it('shows the next run and the last outcome in the dropdown', () => {
        renderControl({
            value: { enabled: true, intervalMinutes: 30 },
            status: statusIn(10, {
                lastRunAt: new Date(Date.now() - 60_000).toISOString(),
                outcome: 'skipped-dirty',
                message: 'uncommitted changes in the working tree',
            }),
        });
        open();
        expect(screen.getByTestId('git-autopull-status-next').textContent).toBe('Next run in 10m');
        expect(screen.getByTestId('git-autopull-status-last').textContent)
            .toContain('skipped — uncommitted changes');
    });

    it('puts the server message in the last-run title', () => {
        renderControl({
            value: { enabled: true, intervalMinutes: 30 },
            status: statusIn(10, {
                lastRunAt: new Date(Date.now() - 60_000).toISOString(),
                outcome: 'skipped-dirty',
                message: 'uncommitted changes in the working tree',
            }),
        });
        open();
        expect(screen.getByTestId('git-autopull-status-last').getAttribute('title'))
            .toContain('uncommitted changes in the working tree');
    });

    it('shows a last run even when nothing is scheduled', () => {
        renderControl({
            value: { enabled: false, intervalMinutes: 30 },
            status: { enabled: false, lastRunAt: new Date(Date.now() - 60_000).toISOString(), outcome: 'success' } as any,
        });
        open();
        expect(screen.queryByTestId('git-autopull-status-next')).toBeNull();
        expect(screen.getByTestId('git-autopull-status-last').textContent).toContain('pulled');
    });
});
