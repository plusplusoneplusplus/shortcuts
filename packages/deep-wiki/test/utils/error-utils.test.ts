/**
 * Tests for getErrorMessage utility.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../../src/utils/error-utils';

describe('getErrorMessage', () => {
    it('returns message for Error instances', () => {
        const error = new Error('something went wrong');
        expect(getErrorMessage(error)).toBe('something went wrong');
    });

    it('returns message for Error subclasses (TypeError)', () => {
        const error = new TypeError('invalid type');
        expect(getErrorMessage(error)).toBe('invalid type');
    });

    it('returns message for Error subclasses (RangeError)', () => {
        const error = new RangeError('out of range');
        expect(getErrorMessage(error)).toBe('out of range');
    });

    it('returns string representation for string throws', () => {
        expect(getErrorMessage('oops')).toBe('oops');
    });

    it('returns string representation for number throws', () => {
        expect(getErrorMessage(42)).toBe('42');
    });

    it('returns string representation for null', () => {
        expect(getErrorMessage(null)).toBe('null');
    });

    it('returns string representation for undefined', () => {
        expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('returns string representation for objects', () => {
        expect(getErrorMessage({ code: 404 })).toBe('[object Object]');
    });

    it('returns empty string for empty Error message', () => {
        expect(getErrorMessage(new Error(''))).toBe('');
    });
});
