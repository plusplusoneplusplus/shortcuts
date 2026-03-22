/**
 * Unit tests for sdk-loader.ts
 *
 * Tests binary path resolution with mocked filesystem and confirms the
 * loader function is callable via an injected import function (required to
 * avoid ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING in Vitest's VM context).
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { findSdkBinaryPath, loadSdk } from '../../src/copilot-sdk-wrapper/sdk-loader';

// ---------------------------------------------------------------------------
// findSdkBinaryPath — path resolution
// ---------------------------------------------------------------------------

describe('findSdkBinaryPath', () => {
    it('returns undefined when no candidate paths contain dist/index.js', () => {
        const result = findSdkBinaryPath(() => false);

        expect(result).toBeUndefined();
    });

    it('returns the first path where dist/index.js exists', () => {
        let callCount = 0;
        const result = findSdkBinaryPath(() => {
            // Only the first call returns true
            callCount++;
            return callCount === 1;
        });

        expect(typeof result).toBe('string');
        // The returned path ends with the SDK package name
        expect(result).toMatch(/copilot-sdk[/\\]?$/);
    });

    it('skips non-matching candidates and returns the second hit', () => {
        let callCount = 0;
        const existsFn = vi.fn().mockImplementation(() => {
            callCount++;
            // Second probe returns true, all others false
            return callCount === 2;
        });

        const result = findSdkBinaryPath(existsFn);

        expect(typeof result).toBe('string');
        expect(existsFn).toHaveBeenCalledTimes(2);
    });

    it('probes exactly four candidate directories', () => {
        const existsFn = vi.fn().mockReturnValue(false);

        findSdkBinaryPath(existsFn);

        // Each candidate triggers exactly one existsSync call for dist/index.js
        expect(existsFn).toHaveBeenCalledTimes(4);
    });

    it('probes paths containing node_modules/@github/copilot-sdk with dist/index.js', () => {
        const probedPaths: string[] = [];
        findSdkBinaryPath((p) => {
            probedPaths.push(p);
            return false;
        });

        expect(probedPaths).toHaveLength(4);
        for (const p of probedPaths) {
            expect(p).toContain('copilot-sdk');
            expect(p).toContain(path.join('dist', 'index.js'));
        }
    });

    it('returns a string or undefined without throwing regardless of filesystem state', () => {
        // Exercise the real filesystem — we do not care about the value, only the contract
        expect(() => findSdkBinaryPath()).not.toThrow();
        const result = findSdkBinaryPath();
        expect(result === undefined || typeof result === 'string').toBe(true);
    });
});

// ---------------------------------------------------------------------------
// loadSdk — ESM dynamic import via injected importFn
// ---------------------------------------------------------------------------

describe('loadSdk', () => {
    it('returns a SdkModule with CopilotClient when import resolves with it', async () => {
        const MockCopilotClient = class {};
        const importFn = vi.fn().mockResolvedValue({ CopilotClient: MockCopilotClient });

        const result = await loadSdk('/some/sdk', importFn);

        expect(result.CopilotClient).toBe(MockCopilotClient);
        expect(importFn).toHaveBeenCalledOnce();
    });

    it('throws when the loaded module does not export CopilotClient', async () => {
        const importFn = vi.fn().mockResolvedValue({ someOtherExport: {} });

        await expect(loadSdk('/some/sdk', importFn)).rejects.toThrow(
            'CopilotClient not found in SDK module',
        );
    });

    it('passes a file:// URL built from sdkPath + dist/index.js to the importFn', async () => {
        const MockCopilotClient = class {};
        const capturedSpecifiers: string[] = [];
        const importFn = vi.fn().mockImplementation((specifier: string) => {
            capturedSpecifiers.push(specifier);
            return Promise.resolve({ CopilotClient: MockCopilotClient });
        });

        const sdkPath = path.join('/fake', 'sdk');
        await loadSdk(sdkPath, importFn);

        expect(capturedSpecifiers).toHaveLength(1);
        expect(capturedSpecifiers[0]).toMatch(/^file:/i);
        expect(capturedSpecifiers[0]).toContain('dist');
        expect(capturedSpecifiers[0]).toContain('index.js');
    });

    it('propagates errors thrown by the importFn', async () => {
        const importFn = vi.fn().mockRejectedValue(new Error('Cannot find module'));

        await expect(loadSdk('/bad/path', importFn)).rejects.toThrow('Cannot find module');
    });

    it('calls importFn with the correct path segment for sdkPath', async () => {
        const MockCopilotClient = class {};
        const importFn = vi.fn().mockResolvedValue({ CopilotClient: MockCopilotClient });

        const sdkPath = path.normalize('/my/copilot-sdk');
        await loadSdk(sdkPath, importFn);

        const specifier: string = importFn.mock.calls[0][0];
        // The URL must include dist/index.js (normalised to OS separators via pathToFileURL)
        expect(specifier).toMatch(/dist.*index\.js/);
    });
});
