/**
 * DeliveryMode — Type Guard & Option Extension Tests
 *
 * Verifies:
 * - Runtime type narrowing for DeliveryMode values
 * - SendMessageOptions accepts deliveryMode field without TypeScript error
 * - Default value behaviour: undefined resolves to 'enqueue'
 * - Type shape: only 'immediate' and 'enqueue' are valid
 *
 * No production source files are modified by these tests.
 * The isDeliveryMode helper is defined locally here to represent the pattern
 * used by any caller that must narrow `unknown → DeliveryMode` (e.g. HTTP
 * request body validation in api-handler.ts).
 */
import { describe, it, expect } from 'vitest';
import type { DeliveryMode, SendMessageOptions } from '../../src/copilot-sdk-wrapper/types';

// ---------------------------------------------------------------------------
// Local type-guard helper (mirrors the inline validation in api-handler.ts)
// ---------------------------------------------------------------------------

const VALID_DELIVERY_MODES: readonly string[] = ['immediate', 'enqueue'] as const;

function isDeliveryMode(value: unknown): value is DeliveryMode {
    return typeof value === 'string' && (VALID_DELIVERY_MODES as readonly string[]).includes(value);
}

/**
 * Resolves the effective delivery mode from SendMessageOptions.
 * Mirrors the `options.deliveryMode ?? 'enqueue'` default in api-handler.ts.
 */
function resolveDeliveryMode(options: Pick<SendMessageOptions, 'deliveryMode'>): DeliveryMode {
    return options.deliveryMode ?? 'enqueue';
}

// ---------------------------------------------------------------------------
// isDeliveryMode — type guard
// ---------------------------------------------------------------------------

describe('isDeliveryMode type guard', () => {
    it('returns true for "immediate"', () => {
        expect(isDeliveryMode('immediate')).toBe(true);
    });

    it('returns true for "enqueue"', () => {
        expect(isDeliveryMode('enqueue')).toBe(true);
    });

    it('returns false for "stream"', () => {
        expect(isDeliveryMode('stream')).toBe(false);
    });

    it('returns false for an empty string', () => {
        expect(isDeliveryMode('')).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isDeliveryMode(undefined)).toBe(false);
    });

    it('returns false for null', () => {
        expect(isDeliveryMode(null)).toBe(false);
    });

    it('returns false for a number', () => {
        expect(isDeliveryMode(42)).toBe(false);
    });

    it('returns false for a mixed-case variant', () => {
        expect(isDeliveryMode('IMMEDIATE')).toBe(false);
    });

    it('narrows type correctly inside a conditional', () => {
        const value: unknown = 'immediate';
        if (isDeliveryMode(value)) {
            // TypeScript knows value is DeliveryMode here
            const mode: DeliveryMode = value;
            expect(mode).toBe('immediate');
        } else {
            expect.fail('Expected isDeliveryMode to return true for "immediate"');
        }
    });
});

// ---------------------------------------------------------------------------
// SendMessageOptions.deliveryMode field shape
// ---------------------------------------------------------------------------

describe('SendMessageOptions.deliveryMode field', () => {
    it('accepts deliveryMode: "immediate"', () => {
        const opts: Pick<SendMessageOptions, 'deliveryMode'> = { deliveryMode: 'immediate' };
        expect(opts.deliveryMode).toBe('immediate');
    });

    it('accepts deliveryMode: "enqueue"', () => {
        const opts: Pick<SendMessageOptions, 'deliveryMode'> = { deliveryMode: 'enqueue' };
        expect(opts.deliveryMode).toBe('enqueue');
    });

    it('allows deliveryMode to be omitted', () => {
        const opts: SendMessageOptions = { prompt: 'hello' };
        expect(opts.deliveryMode).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// resolveDeliveryMode — default value behaviour
// ---------------------------------------------------------------------------

describe('resolveDeliveryMode default value', () => {
    it('returns "enqueue" when deliveryMode is undefined', () => {
        expect(resolveDeliveryMode({})).toBe('enqueue');
    });

    it('returns "immediate" when deliveryMode is "immediate"', () => {
        expect(resolveDeliveryMode({ deliveryMode: 'immediate' })).toBe('immediate');
    });

    it('returns "enqueue" when deliveryMode is explicitly "enqueue"', () => {
        expect(resolveDeliveryMode({ deliveryMode: 'enqueue' })).toBe('enqueue');
    });
});
