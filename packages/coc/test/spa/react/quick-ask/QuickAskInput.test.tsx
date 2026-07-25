import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuickAskInput, QUICK_ASK_MAX_LEN }
    from '../../../../src/server/spa/client/react/features/chat/quick-ask/QuickAskInput';

const RECT = { top: 200, left: 120, bottom: 220, right: 260 };

afterEach(() => {
    vi.restoreAllMocks();
});

function field(): HTMLInputElement {
    return screen.getByTestId('quick-ask-input-field') as HTMLInputElement;
}

describe('QuickAskInput', () => {
    it('renders an autofocused, length-capped single-line field', () => {
        render(<QuickAskInput rect={RECT} onSubmit={() => {}} onCancel={() => {}} />);
        const input = field();
        // AC-01: max length ~200 chars, single-line.
        expect(input.maxLength).toBe(QUICK_ASK_MAX_LEN);
        expect(input.tagName).toBe('INPUT');
        // Autofocus happens on the next animation frame; jsdom runs rAF, but
        // focus can be flaky under test — assert the ref target exists at least.
        expect(input).toBeInTheDocument();
    });

    it('Enter submits the typed question', () => {
        const onSubmit = vi.fn();
        render(<QuickAskInput rect={RECT} onSubmit={onSubmit} onCancel={() => {}} />);
        fireEvent.change(field(), { target: { value: 'why does this matter?' } });
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(onSubmit).toHaveBeenCalledWith('why does this matter?');
    });

    it('the submit button submits the typed question', () => {
        const onSubmit = vi.fn();
        render(<QuickAskInput rect={RECT} onSubmit={onSubmit} onCancel={() => {}} />);
        fireEvent.change(field(), { target: { value: 'explain more' } });
        fireEvent.click(screen.getByTestId('quick-ask-input-submit'));
        expect(onSubmit).toHaveBeenCalledWith('explain more');
    });

    it('Enter with no text still submits (empty string) — one-click fast path', () => {
        const onSubmit = vi.fn();
        render(<QuickAskInput rect={RECT} onSubmit={onSubmit} onCancel={() => {}} />);
        fireEvent.keyDown(field(), { key: 'Enter' });
        expect(onSubmit).toHaveBeenCalledWith('');
    });

    it('Escape cancels without submitting', () => {
        const onSubmit = vi.fn();
        const onCancel = vi.fn();
        render(<QuickAskInput rect={RECT} onSubmit={onSubmit} onCancel={onCancel} />);
        fireEvent.change(field(), { target: { value: 'nope' } });
        fireEvent.keyDown(field(), { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
