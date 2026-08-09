/**
 * The four utility cards added alongside the calculator: base converter,
 * encoders, timestamp and byte size. These cover the wiring only — the maths
 * and parsing live in the matching logic tests.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BaseConverterCard } from '../../../../../src/server/spa/client/react/features/dev-tools/BaseConverterCard';
import { ByteSizeCard } from '../../../../../src/server/spa/client/react/features/dev-tools/ByteSizeCard';
import { EncodersCard } from '../../../../../src/server/spa/client/react/features/dev-tools/EncodersCard';
import { TimestampCard } from '../../../../../src/server/spa/client/react/features/dev-tools/TimestampCard';

function text(testId: string): string {
    return screen.getByTestId(testId).textContent ?? '';
}

describe('BaseConverterCard', () => {
    it('converts between the chosen bases', () => {
        render(<BaseConverterCard />);
        fireEvent.change(screen.getByTestId('base-input'), { target: { value: '255' } });
        expect(text('base-output')).toBe('ff');
        fireEvent.change(screen.getByTestId('base-to'), { target: { value: '2' } });
        expect(text('base-output')).toBe('11111111');
    });

    it('swaps the two bases and carries the converted value across', () => {
        render(<BaseConverterCard />);
        fireEvent.change(screen.getByTestId('base-input'), { target: { value: '255' } });
        fireEvent.click(screen.getByTestId('base-swap'));
        expect((screen.getByTestId('base-input') as HTMLInputElement).value).toBe('ff');
        expect(text('base-output')).toBe('255');
    });

    it('shows an inline error for a digit the base does not have', () => {
        render(<BaseConverterCard />);
        fireEvent.change(screen.getByTestId('base-from'), { target: { value: '2' } });
        fireEvent.change(screen.getByTestId('base-input'), { target: { value: '129' } });
        expect(text('base-error')).toContain('not a valid digit in base 2');
        expect(screen.queryByTestId('base-presets')).toBeNull();
    });

    it('copies without throwing in a clipboard-less environment', () => {
        render(<BaseConverterCard />);
        expect(() => fireEvent.click(screen.getByTestId('base-copy'))).not.toThrow();
    });
});

describe('EncodersCard', () => {
    it('base64-encodes and decodes the same text, unicode included', () => {
        render(<EncodersCard />);
        const input = screen.getByTestId('encoder-input');
        fireEvent.change(input, { target: { value: 'héllo' } });
        expect(text('encoder-output')).toBe('aMOpbGxv');

        fireEvent.click(screen.getByTestId('encoder-mode-base64-decode'));
        fireEvent.change(input, { target: { value: 'aMOpbGxv' } });
        expect(text('encoder-output')).toBe('héllo');
    });

    it('switches to URL and HTML modes', () => {
        render(<EncodersCard />);
        const input = screen.getByTestId('encoder-input');
        fireEvent.click(screen.getByTestId('encoder-mode-url-encode'));
        fireEvent.change(input, { target: { value: 'a b&c' } });
        expect(text('encoder-output')).toBe('a%20b%26c');

        fireEvent.click(screen.getByTestId('encoder-mode-html-escape'));
        expect(text('encoder-output')).toBe('a b&amp;c');
    });

    it('shows an inline error for undecodable input and keeps rendering', () => {
        render(<EncodersCard />);
        fireEvent.click(screen.getByTestId('encoder-mode-base64-decode'));
        fireEvent.change(screen.getByTestId('encoder-input'), { target: { value: 'not*base64' } });
        expect(text('encoder-error')).toContain('not a valid base64 character');
        expect(text('encoder-output')).toBe('');
    });
});

describe('TimestampCard', () => {
    it('renders every representation of a pasted epoch value', () => {
        render(<TimestampCard />);
        fireEvent.change(screen.getByTestId('timestamp-input'), { target: { value: '1704067200' } });
        expect(text('timestamp-detected')).toContain('seconds');
        expect(text('timestamp-iso')).toBe('2024-01-01T00:00:00.000Z');
        expect(text('timestamp-epochSeconds')).toBe('1704067200');
        expect(text('timestamp-epochMs')).toBe('1704067200000');
    });

    it('detects a millisecond value', () => {
        render(<TimestampCard />);
        fireEvent.change(screen.getByTestId('timestamp-input'), { target: { value: '1704067200000' } });
        expect(text('timestamp-detected')).toContain('milliseconds');
        expect(text('timestamp-iso')).toBe('2024-01-01T00:00:00.000Z');
    });

    it('resets to the current time from the Now button', () => {
        render(<TimestampCard />);
        fireEvent.change(screen.getByTestId('timestamp-input'), { target: { value: 'nope' } });
        expect(screen.getByTestId('timestamp-error')).toBeTruthy();
        fireEvent.click(screen.getByTestId('timestamp-now'));
        expect(screen.queryByTestId('timestamp-error')).toBeNull();
        expect(text('timestamp-detected')).toContain('seconds');
    });
});

describe('ByteSizeCard', () => {
    it('shows decimal and binary columns for the same byte count', () => {
        render(<ByteSizeCard />);
        fireEvent.change(screen.getByTestId('bytes-input'), { target: { value: '1536' } });
        expect(text('bytes-decimal-kb')).toBe('1.536');
        expect(text('bytes-binary-kib')).toBe('1.5');
        expect(text('bytes-summary')).toContain('1.54 KB');
        expect(text('bytes-summary')).toContain('1.5 KiB');
    });

    it('accepts a unit suffix on the input', () => {
        render(<ByteSizeCard />);
        fireEvent.change(screen.getByTestId('bytes-input'), { target: { value: '1 GiB' } });
        expect(text('bytes-summary')).toContain('1073741824 bytes');
    });

    it('shows an inline error for an unknown unit', () => {
        render(<ByteSizeCard />);
        fireEvent.change(screen.getByTestId('bytes-input'), { target: { value: '5 furlongs' } });
        expect(text('bytes-error')).toContain('Unknown unit');
        expect(screen.queryByTestId('bytes-summary')).toBeNull();
    });
});
