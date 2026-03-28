/**
 * Unit tests for sdk-loader.ts
 *
 * Tests the availability check via require.resolve.
 */

import { describe, it, expect, vi } from 'vitest';
import { findSdkBinaryPath } from '../../src/copilot-sdk-wrapper/sdk-loader';

describe('findSdkBinaryPath', () => {
    it('returns undefined when require.resolve throws', () => {
        const resolveFn = vi.fn().mockImplementation(() => { throw new Error('MODULE_NOT_FOUND'); });
        const result = findSdkBinaryPath(resolveFn);
        expect(result).toBeUndefined();
    });

    it('returns the resolved path when require.resolve succeeds', () => {
        const resolveFn = vi.fn().mockReturnValue('/some/node_modules/@github/copilot-sdk/dist/index.js');
        const result = findSdkBinaryPath(resolveFn);
        expect(result).toBe('/some/node_modules/@github/copilot-sdk/dist/index.js');
        expect(resolveFn).toHaveBeenCalledWith('@github/copilot-sdk');
    });

    it('returns a string or undefined without throwing regardless of environment', () => {
        expect(() => findSdkBinaryPath()).not.toThrow();
        const result = findSdkBinaryPath();
        expect(result === undefined || typeof result === 'string').toBe(true);
    });
});
