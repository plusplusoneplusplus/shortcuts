import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../src/wiki/router';

describe('getErrorMessage', () => {
    it('extracts message from Error instance', () => {
        expect(getErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('extracts message from Error subclass', () => {
        expect(getErrorMessage(new TypeError('bad type'))).toBe('bad type');
    });

    it('converts string to itself', () => {
        expect(getErrorMessage('oops')).toBe('oops');
    });

    it('converts number to string', () => {
        expect(getErrorMessage(42)).toBe('42');
    });

    it('converts null to string', () => {
        expect(getErrorMessage(null)).toBe('null');
    });

    it('converts undefined to string', () => {
        expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('converts object to string', () => {
        expect(getErrorMessage({ key: 'val' })).toBe('[object Object]');
    });
});
