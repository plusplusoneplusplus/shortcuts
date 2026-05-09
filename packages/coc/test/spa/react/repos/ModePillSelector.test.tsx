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
        expect(screen.getByTestId('mode-pill-plan')).toBeTruthy();
        expect(screen.getByTestId('mode-pill-autopilot')).toBeTruthy();
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
        expect(screen.getByTestId('mode-pill-plan').getAttribute('aria-checked')).toBe('false');
    });

    it('exposes data-selected attribute alongside aria-checked', () => {
        render(
            <ModePillSelector
                options={DEFAULT_MODE_PILL_OPTIONS}
                value="plan"
                onChange={() => {}}
            />,
        );
        expect(screen.getByTestId('mode-pill-plan').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('mode-pill-ask').getAttribute('data-selected')).toBe('false');
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
        fireEvent.click(screen.getByTestId('mode-pill-plan'));
        expect(onChange).toHaveBeenCalledWith('plan');
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
        expect(screen.getByTestId('mode-pill-plan').textContent).toBe('Plan');
        expect(screen.getByTestId('mode-pill-autopilot').textContent).toBe('Autopilot');
    });

    it('renders a coloured leading dot per option', () => {
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
        expect(askDot?.className).toContain('bg-blue-500');
        expect(autopilotDot?.className).toContain('bg-orange-500');
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
