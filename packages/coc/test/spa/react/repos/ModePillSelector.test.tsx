/**
 * Tests for ModePillSelector — the segmented pill control used by the
 * redesigned chat input.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    ModePillSelector,
    DEFAULT_MODE_PILL_OPTIONS,
} from '../../../../src/server/spa/client/react/features/chat/ModePillSelector';

describe('ModePillSelector', () => {
    it('renders one button per option using the default mode set', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        expect(screen.getByTestId('mode-pill-ask')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
    });

    it('marks the current value with aria-checked="true"', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="autopilot"
                onChange={() => {}}
            />,
        );
        expect(screen.getByTestId('mode-pill-autopilot').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('mode-pill-ask').getAttribute('aria-checked')).toBe('false');
    });

    it('exposes data-selected attribute alongside aria-checked', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        expect(screen.getByTestId('mode-pill-ask').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('mode-pill-autopilot').getAttribute('data-selected')).toBe('false');
    });

    it('calls onChange with the clicked pill value', () => {
        const onChange = vi.fn();
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByTestId('mode-pill-autopilot'));
        expect(onChange).toHaveBeenCalledWith('autopilot');
    });

    it('renders labels without emoji prefix (clean text)', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        expect(screen.getByTestId('mode-pill-ask').textContent).toBe('Ask');
        expect(screen.getByTestId('mode-pill-autopilot').textContent).toBe('Autopilot');
    });

    it('dot colors match the chat-input border colors (ask=yellow, autopilot=green)', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const askDot = screen.getByTestId('mode-pill-ask').querySelector('span[aria-hidden="true"]');
        const autopilotDot = screen
            .getByTestId('mode-pill-autopilot')
            .querySelector('span[aria-hidden="true"]');
        expect(askDot?.className).toContain('bg-yellow-500');
        expect(autopilotDot?.className).toContain('bg-green-500');
    });

    it('exposes the radiogroup role on the container', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const group = screen.getByRole('radiogroup');
        expect(group).toBeTruthy();
        expect(group.getAttribute('aria-label')).toBe('Chat mode');
    });

    // ── Compact density (matches OpenDesign chats.html .mode-opt) ─────────

    it('uses ultra-compact pill padding (px-2 py-[2px], text-[11px])', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const pill = screen.getByTestId('mode-pill-ask');
        expect(pill.className).toContain('px-2');
        expect(pill.className).toContain('py-[2px]');
        expect(pill.className).toContain('text-[11px]');
        expect(pill.className).not.toContain('px-3');
        expect(pill.className).not.toContain('text-sm');
        expect(pill.className).not.toContain('text-[11.5px]');
    });

    it('mode dot uses tight 4px diameter to match the compact toolbar', () => {
        const { container } = render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const dot = container.querySelector('span.bg-yellow-500') as HTMLElement | null;
        expect(dot).not.toBeNull();
        expect(dot?.className).toContain('h-[4px]');
        expect(dot?.className).toContain('w-[4px]');
    });

    it('uses a rectangular rounded-md container (not a fully-rounded pill)', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const group = screen.getByRole('radiogroup');
        const tokens = group.className.split(/\s+/);
        expect(tokens).toContain('rounded-md');
        expect(tokens).not.toContain('rounded-full');
    });

    it('selected pill uses an inset border shadow instead of an outer border', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const selected = screen.getByTestId('mode-pill-ask');
        expect(selected.getAttribute('aria-checked')).toBe('true');
        // Inset shadow gives the highlighted look without expanding the box.
        expect(selected.className).toContain('shadow-[inset_0_0_0_1px_#d0d0d0]');
        expect(selected.className).toContain('bg-[#f3f3f3]');
    });

    it('container is height-leveled at 22px with p-px so it matches the sibling chips', () => {
        // The composer toolbar places the mode pill next to the agent, model
        // and effort chips, which are all h-[22px] ghost buttons. Keep the
        // mode pill container at the same 22px height (h-[22px] + p-px) so
        // the four elements line up on the same baseline. The older
        // p-0.5 / p-1 paddings rendered ~24px tall and looked bulkier than
        // the surrounding chips.
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="ask"
                onChange={() => {}}
            />,
        );
        const group = screen.getByRole('radiogroup');
        const tokens = group.className.split(/\s+/);
        expect(tokens).toContain('h-[22px]');
        expect(tokens).toContain('p-px');
        expect(tokens).not.toContain('p-0.5');
        expect(tokens).not.toContain('p-1');
    });

    it('honours custom options (subset/order)', () => {
        const onChange = vi.fn();
        render(
            <ModePillSelector
                options={[
                    { value: 'autopilot', label: 'Auto', dotClass: 'bg-orange-500' },
                    { value: 'ask', label: 'Q&A', dotClass: 'bg-blue-500' },
                ]}
                value="autopilot"
                onChange={onChange}
            />,
        );
        const ids = Array.from(document.querySelectorAll('button[data-testid^="mode-pill-"]')).map(
            (el) => (el as HTMLElement).dataset.testid,
        );
        expect(ids).toEqual(['mode-pill-autopilot', 'mode-pill-ask']);
        expect(screen.queryByTestId('mode-pill-plan')).toBeNull();
        expect(screen.getByTestId('mode-pill-ask').textContent).toBe('Q&A');
    });
});
