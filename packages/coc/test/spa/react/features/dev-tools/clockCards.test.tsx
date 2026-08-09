/**
 * Wiring tests for the last three cards: cron explainer, hash generator and
 * JWT decoder. The parsing, hashing and decoding themselves are covered by the
 * matching logic tests — this file only checks the controls are hooked up and
 * that errors render inline.
 *
 * jsdom does not ship `crypto.subtle`, so Node's WebCrypto is installed on the
 * global before the hash card renders. That is exactly the shape the card reads
 * in a real browser.
 *
 * @vitest-environment jsdom
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';

import { CronCard } from '../../../../../src/server/spa/client/react/features/dev-tools/CronCard';
import { HashCard } from '../../../../../src/server/spa/client/react/features/dev-tools/HashCard';
import { JwtDecoderCard } from '../../../../../src/server/spa/client/react/features/dev-tools/JwtDecoderCard';

function text(testId: string): string {
    return screen.getByTestId(testId).textContent ?? '';
}

describe('CronCard', () => {
    it('describes the default expression and lists five runs', () => {
        render(<CronCard />);
        expect(text('cron-description')).toBe('At 09:00, on Monday through Friday (local time)');
        expect(screen.getAllByTestId(/^cron-run-\d+$/).length).toBe(5);
    });

    it('re-reads the description when the expression changes', () => {
        render(<CronCard />);
        fireEvent.change(screen.getByTestId('cron-input'), { target: { value: '*/15 * * * *' } });
        expect(text('cron-description')).toBe('Every 15 minutes (local time)');
    });

    it('fills the input from an example button', () => {
        render(<CronCard />);
        fireEvent.click(screen.getByTestId('cron-example-30-3-1-'));
        expect((screen.getByTestId('cron-input') as HTMLInputElement).value).toBe('30 3 1 * *');
        expect(text('cron-description')).toContain('At 03:30');
    });

    it('shows an inline error for an invalid expression and hides the runs', () => {
        render(<CronCard />);
        fireEvent.change(screen.getByTestId('cron-input'), { target: { value: '99 * * * *' } });
        expect(text('cron-error')).toContain('minute');
        expect(screen.queryByTestId('cron-runs')).toBeNull();
    });

    it('says so when the expression can never fire', () => {
        render(<CronCard />);
        fireEvent.change(screen.getByTestId('cron-input'), { target: { value: '0 0 31 2 *' } });
        expect(text('cron-runs-empty')).toContain('never fires');
    });

    it('copies without throwing in a clipboard-less environment', () => {
        render(<CronCard />);
        expect(() => fireEvent.click(screen.getByTestId('cron-copy-description'))).not.toThrow();
    });
});

describe('HashCard', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

    beforeAll(() => {
        Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
    });
    afterAll(() => {
        if (original) Object.defineProperty(globalThis, 'crypto', original);
    });

    it('shows all three digests of the default input', async () => {
        render(<HashCard />);
        await waitFor(() =>
            expect(text('hash-sha-256')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
        );
        expect(text('hash-sha-1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
        expect(text('hash-sha-512')).toHaveLength(128);
    });

    it('re-hashes when the input changes', async () => {
        render(<HashCard />);
        await waitFor(() => expect(text('hash-sha-256')).not.toBe('…'));
        fireEvent.change(screen.getByTestId('hash-input'), { target: { value: '' } });
        await waitFor(() =>
            expect(text('hash-sha-256')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'),
        );
    });

    it('states that MD5 is omitted', () => {
        render(<HashCard />);
        expect(text('hash-md5-note')).toContain('MD5 is omitted');
    });

    it('copies without throwing in a clipboard-less environment', async () => {
        render(<HashCard />);
        await waitFor(() => expect(screen.getByTestId('hash-copy-sha-256')).toBeTruthy());
        expect(() => fireEvent.click(screen.getByTestId('hash-copy-sha-256'))).not.toThrow();
    });
});

describe('JwtDecoderCard', () => {
    it('pretty-prints the header and payload of the sample token', () => {
        render(<JwtDecoderCard />);
        expect(text('jwt-header')).toContain('"alg": "HS256"');
        expect(text('jwt-payload')).toContain('"name": "Ada Lovelace"');
        expect(text('jwt-alg')).toContain('HS256');
    });

    it('marks the long-past sample token as expired and lists its time claims', () => {
        render(<JwtDecoderCard />);
        expect(text('jwt-status')).toBe('Expired');
        expect(text('jwt-time-exp')).toContain('ago');
        expect(screen.getByTestId('jwt-time-iat')).toBeTruthy();
        expect(screen.getByTestId('jwt-time-nbf')).toBeTruthy();
    });

    it('always says the signature is not verified', () => {
        render(<JwtDecoderCard />);
        expect(text('jwt-signature-note')).toContain('never verified');
    });

    it('shows an inline error for a malformed token and hides the output', () => {
        render(<JwtDecoderCard />);
        fireEvent.change(screen.getByTestId('jwt-input'), { target: { value: 'not-a-jwt' } });
        expect(text('jwt-error')).toContain('3 dot-separated segments');
        expect(screen.queryByTestId('jwt-header')).toBeNull();
    });

    it('copies without throwing in a clipboard-less environment', () => {
        render(<JwtDecoderCard />);
        expect(() => fireEvent.click(screen.getByTestId('jwt-copy-payload'))).not.toThrow();
    });
});
