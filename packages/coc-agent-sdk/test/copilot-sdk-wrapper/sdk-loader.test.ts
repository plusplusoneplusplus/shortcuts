/**
 * Unit tests for sdk-loader.ts
 *
 * Tests the filesystem-based availability check for the ESM-only SDK.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { findSdkBinaryPath } from '../../src/sdk-loader';

describe('findSdkBinaryPath', () => {
    it('returns undefined when the SDK is not in any ancestor node_modules', () => {
        const result = findSdkBinaryPath(os.tmpdir());
        expect(result).toBeUndefined();
    });

    it('finds the SDK when starting from a directory that has it in node_modules', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-loader-test-'));
        const sdkDir = path.join(tmpDir, 'node_modules', '@github', 'copilot-sdk');
        fs.mkdirSync(sdkDir, { recursive: true });
        fs.writeFileSync(path.join(sdkDir, 'package.json'), '{}');
        try {
            const result = findSdkBinaryPath(tmpDir);
            expect(result).toBe(sdkDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('walks up to find the SDK in a parent node_modules', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-loader-test-'));
        const sdkDir = path.join(tmpDir, 'node_modules', '@github', 'copilot-sdk');
        fs.mkdirSync(sdkDir, { recursive: true });
        fs.writeFileSync(path.join(sdkDir, 'package.json'), '{}');
        const nested = path.join(tmpDir, 'packages', 'forge', 'dist');
        fs.mkdirSync(nested, { recursive: true });
        try {
            const result = findSdkBinaryPath(nested);
            expect(result).toBe(sdkDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns a string or undefined without throwing regardless of environment', () => {
        expect(() => findSdkBinaryPath()).not.toThrow();
        const result = findSdkBinaryPath();
        expect(result === undefined || typeof result === 'string').toBe(true);
    });
});
