/**
 * Tests for ChatStyleSelector, the response-style chip that sits beside Effort
 * in the chat composers. Style changes presentation only, so every option is
 * always selectable — there is no per-provider configuration to gate on.
 *
 * Default is a first-class option: it leads the list, it is what a new chat
 * starts on, and the chip still reads `Style: Default` when it is selected.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CHAT_STYLES, CHAT_STYLE_LABELS, DEFAULT_CHAT_STYLE } from '@plusplusoneplusplus/coc-client';
import {
    ChatStyleSelector,
    CHAT_STYLE_DESCRIPTIONS,
} from '../../../../src/server/spa/client/react/features/chat/ChatStyleSelector';

describe('ChatStyleSelector', () => {
    it('shows the selected style in the trigger label', () => {
        render(<ChatStyleSelector selectedStyle="analytical" onChange={() => {}} />);
        expect(screen.getByTestId('chat-style-label').textContent).toBe('Style: Analytical');
    });

    it('still shows "Style: Default" when nothing will be injected', () => {
        render(<ChatStyleSelector selectedStyle={DEFAULT_CHAT_STYLE} onChange={() => {}} />);
        expect(screen.getByTestId('chat-style-label').textContent).toBe('Style: Default');
        expect(screen.getByTestId('chat-style-selector').getAttribute('data-style-value')).toBe('default');
    });

    it('drops the "Style:" prefix in compact mode', () => {
        render(<ChatStyleSelector selectedStyle="direct" onChange={() => {}} compact />);
        expect(screen.getByTestId('chat-style-label').textContent).toBe('Direct');
    });

    it('shows an S trigger glyph for the mobile tap target', () => {
        render(<ChatStyleSelector selectedStyle="human" onChange={() => {}} mobileTapTarget />);
        expect(screen.getByTestId('chat-style-trigger-btn').textContent).toContain('S');
    });

    it('explains what the control does in the trigger tooltip', () => {
        render(<ChatStyleSelector selectedStyle="human" onChange={() => {}} />);
        expect(screen.getByTestId('chat-style-trigger-btn').getAttribute('title'))
            .toBe('Choose how the response is written.');
    });

    it('lists all five styles, Default first, with their one-line descriptions', () => {
        render(<ChatStyleSelector selectedStyle={DEFAULT_CHAT_STYLE} onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('chat-style-trigger-btn'));

        expect(CHAT_STYLES).toEqual(['default', 'human', 'direct', 'analytical', 'structured']);
        const rendered = Array.from(
            screen.getByTestId('chat-style-menu').querySelectorAll('[role="option"]'),
        ).map(el => el.getAttribute('data-testid'));
        expect(rendered).toEqual(CHAT_STYLES.map(s => `chat-style-option-${s}`));

        for (const style of CHAT_STYLES) {
            const option = screen.getByTestId(`chat-style-option-${style}`);
            expect(option.textContent).toContain(CHAT_STYLE_LABELS[style]);
            expect(option.textContent).toContain(CHAT_STYLE_DESCRIPTIONS[style]);
            expect(option.getAttribute('title')).toBe(CHAT_STYLE_DESCRIPTIONS[style]);
        }
    });

    it('says plainly that Default adds no style instruction', () => {
        expect(CHAT_STYLE_DESCRIPTIONS.default).toBe('No style instruction is added to your message.');
    });

    it('marks the active option and exposes accessible listbox/option roles', () => {
        render(<ChatStyleSelector selectedStyle="structured" onChange={() => {}} />);
        const trigger = screen.getByTestId('chat-style-trigger-btn');
        expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.getAttribute('aria-label')).toBe('Style: Structured');

        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('chat-style-menu').getAttribute('role')).toBe('listbox');
        expect(screen.getByTestId('chat-style-option-structured').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('chat-style-option-structured').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('chat-style-option-human').getAttribute('aria-selected')).toBe('false');
    });

    it.each(CHAT_STYLES)('fires the change handler for %s and closes the menu', (style) => {
        const onChange = vi.fn();
        render(<ChatStyleSelector selectedStyle="human" onChange={onChange} />);

        fireEvent.click(screen.getByTestId('chat-style-trigger-btn'));
        fireEvent.click(screen.getByTestId(`chat-style-option-${style}`));

        expect(onChange).toHaveBeenCalledWith(style);
        expect(screen.queryByTestId('chat-style-menu')).toBeNull();
    });

    it('closes on an outside click without selecting anything', () => {
        const onChange = vi.fn();
        render(<ChatStyleSelector selectedStyle="human" onChange={onChange} />);

        fireEvent.click(screen.getByTestId('chat-style-trigger-btn'));
        expect(screen.getByTestId('chat-style-menu')).toBeTruthy();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('chat-style-menu')).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the menu open when the click lands inside the selector', () => {
        render(<ChatStyleSelector selectedStyle="human" onChange={() => {}} />);
        fireEvent.click(screen.getByTestId('chat-style-trigger-btn'));

        fireEvent.mouseDown(screen.getByTestId('chat-style-menu'));
        expect(screen.getByTestId('chat-style-menu')).toBeTruthy();
    });

    it('cannot be opened while disabled', () => {
        render(<ChatStyleSelector selectedStyle="human" onChange={() => {}} disabled />);
        const trigger = screen.getByTestId('chat-style-trigger-btn') as HTMLButtonElement;
        expect(trigger.disabled).toBe(true);

        fireEvent.click(trigger);
        expect(screen.queryByTestId('chat-style-menu')).toBeNull();
    });

    it('publishes the selected value on the container for downstream assertions', () => {
        render(<ChatStyleSelector selectedStyle="direct" onChange={() => {}} />);
        expect(screen.getByTestId('chat-style-selector').getAttribute('data-style-value')).toBe('direct');
    });
});
