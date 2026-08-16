/**
 * ProgrammerCalculatorCard — the wiring between the inputs, the readouts and
 * the bit grid. The arithmetic itself is covered by calculator.test.ts.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ProgrammerCalculatorCard } from '../../../../../src/server/spa/client/react/features/dev-tools/ProgrammerCalculatorCard';

function readout(base: string): string {
    return screen.getByTestId(`calc-readout-${base}`).textContent ?? '';
}

describe('ProgrammerCalculatorCard', () => {
    it('evaluates the expression into all four readouts', () => {
        render(<ProgrammerCalculatorCard />);
        fireEvent.change(screen.getByTestId('calc-expression'), { target: { value: '0xFF << 4' } });
        expect(readout('hex')).toBe('FF0');
        expect(readout('dec')).toBe('4080');
        expect(readout('oct')).toBe('7760');
        expect(readout('bin')).toBe(
            '0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 1111 1111 0000'
        );
    });

    it('wraps the value when the width shrinks', () => {
        render(<ProgrammerCalculatorCard />);
        fireEvent.change(screen.getByTestId('calc-expression'), { target: { value: '0xFF << 4' } });
        fireEvent.change(screen.getByTestId('calc-width'), { target: { value: '8' } });
        expect(readout('hex')).toBe('F0');
        expect(readout('bin')).toBe('1111 0000');
    });

    it('toggles a bit from the grid and writes it back into the expression', () => {
        render(<ProgrammerCalculatorCard />);
        fireEvent.change(screen.getByTestId('calc-expression'), { target: { value: '0xF0' } });
        fireEvent.change(screen.getByTestId('calc-width'), { target: { value: '8' } });
        fireEvent.click(screen.getByTestId('calc-bit-0'));
        expect(readout('hex')).toBe('F1');
        expect((screen.getByTestId('calc-expression') as HTMLInputElement).value).toBe('0xF1');
        expect(screen.getByTestId('calc-bit-0').getAttribute('aria-pressed')).toBe('true');
    });

    it('renders one button per bit of the selected width', () => {
        render(<ProgrammerCalculatorCard />);
        expect(screen.getAllByTestId(/^calc-bit-\d+$/).length).toBe(64);
        fireEvent.change(screen.getByTestId('calc-width'), { target: { value: '8' } });
        expect(screen.getAllByTestId(/^calc-bit-\d+$/).length).toBe(8);
    });

    it('shows the negative decimal once signed is on', () => {
        render(<ProgrammerCalculatorCard />);
        fireEvent.change(screen.getByTestId('calc-expression'), { target: { value: '0xFF' } });
        fireEvent.change(screen.getByTestId('calc-width'), { target: { value: '8' } });
        expect(readout('dec')).toBe('255');
        fireEvent.click(screen.getByTestId('calc-signed'));
        expect(readout('dec')).toBe('-1');
        expect(readout('hex')).toBe('FF');
    });

    it('keeps the last good value visible when the expression breaks', () => {
        render(<ProgrammerCalculatorCard />);
        const input = screen.getByTestId('calc-expression');
        fireEvent.change(input, { target: { value: '0xFF' } });
        expect(screen.queryByTestId('calc-error')).toBeNull();
        fireEvent.change(input, { target: { value: '0xFF +' } });
        expect(screen.getByTestId('calc-error').textContent).toBe('Unexpected end of expression');
        expect(readout('hex')).toBe('FF');
        fireEvent.change(input, { target: { value: '1 / 0' } });
        expect(screen.getByTestId('calc-error').textContent).toBe('Divide by zero');
        expect(readout('hex')).toBe('FF');
        fireEvent.change(input, { target: { value: '0x10' } });
        expect(screen.queryByTestId('calc-error')).toBeNull();
        expect(readout('hex')).toBe('10');
    });

    it('clears the error and holds the value on an empty expression', () => {
        render(<ProgrammerCalculatorCard />);
        const input = screen.getByTestId('calc-expression');
        fireEvent.change(input, { target: { value: '0x10' } });
        fireEvent.change(input, { target: { value: '' } });
        expect(screen.queryByTestId('calc-error')).toBeNull();
        expect(readout('hex')).toBe('10');
    });

    it('shows a real result in DEC without an error', () => {
        render(<ProgrammerCalculatorCard />);
        fireEvent.change(screen.getByTestId('calc-expression'), { target: { value: '4850*0.1' } });
        expect(screen.queryByTestId('calc-error')).toBeNull();
        expect(readout('dec')).toBe('485');
    });

    it('notes that the bit views are truncated for a non-integral result', () => {
        render(<ProgrammerCalculatorCard />);
        const input = screen.getByTestId('calc-expression');
        fireEvent.change(input, { target: { value: '22/7.0' } });
        expect(screen.queryByTestId('calc-error')).toBeNull();
        expect(readout('dec')).toBe('3.14285714285714');
        expect(readout('hex')).toBe('3');
        expect(screen.getByTestId('calc-truncation-note').textContent).toBe(
            'bit views truncated from 3.14285714285714'
        );
    });

    it('hides the truncation note for an integral result', () => {
        render(<ProgrammerCalculatorCard />);
        const input = screen.getByTestId('calc-expression');
        fireEvent.change(input, { target: { value: '22/7.0' } });
        expect(screen.getByTestId('calc-truncation-note')).toBeTruthy();
        fireEvent.change(input, { target: { value: '4850*0.1' } });
        expect(screen.queryByTestId('calc-truncation-note')).toBeNull();
        fireEvent.change(input, { target: { value: '0xFF' } });
        expect(screen.queryByTestId('calc-truncation-note')).toBeNull();
    });

    it('keeps the bit grid clickable after a real result', () => {
        render(<ProgrammerCalculatorCard />);
        const input = screen.getByTestId('calc-expression');
        fireEvent.change(screen.getByTestId('calc-width'), { target: { value: '8' } });
        fireEvent.change(input, { target: { value: '22/7.0' } });
        expect(screen.getByTestId('calc-bit-0').getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByTestId('calc-bit-2'));
        expect((input as HTMLInputElement).value).toBe('0x7');
        expect(readout('dec')).toBe('7');
        expect(screen.queryByTestId('calc-truncation-note')).toBeNull();
    });

    it('offers a copy button for every readout', () => {
        render(<ProgrammerCalculatorCard />);
        for (const base of ['dec', 'hex', 'oct', 'bin']) {
            const button = screen.getByTestId(`calc-copy-${base}`);
            expect(button.textContent).toBe('Copy');
            // jsdom has no clipboard; the button must still not throw.
            fireEvent.click(button);
            expect(button.textContent).toBe('Copied');
        }
    });
});
