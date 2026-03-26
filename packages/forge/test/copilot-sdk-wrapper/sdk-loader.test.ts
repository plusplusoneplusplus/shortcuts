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
        const noopResolve = () => { throw new Error('not found'); };
        const result = findSdkBinaryPath(() => false, noopResolve);

        expect(result).toBeUndefined();
    });

    it('uses require.resolve first (primary strategy)', () => {
        const sdkRoot = path.join('/installed', 'node_modules', '@github', 'copilot-sdk');
        const resolveFn = vi.fn().mockReturnValue(path.join(sdkRoot, 'dist', 'index.js'));
        const existsFn = vi.fn().mockImplementation((p: string) => {
            return p === path.join(sdkRoot, 'dist', 'index.js');
        });

        const result = findSdkBinaryPath(existsFn, resolveFn);

        expect(resolveFn).toHaveBeenCalledWith('@github/copilot-sdk');
        expect(result).toBe(sdkRoot);
        // existsFn called once for the require.resolve result — never reached relative probes
        expect(existsFn).toHaveBeenCalledTimes(1);
    });

    it('falls back to relative probes when require.resolve fails', () => {
        const resolveFn = vi.fn().mockImplementation(() => { throw new Error('MODULE_NOT_FOUND'); });
        let callCount = 0;
        const existsFn = vi.fn().mockImplementation(() => {
            callCount++;
            return callCount === 1; // first relative probe matches
        });

        const result = findSdkBinaryPath(existsFn, resolveFn);

        expect(typeof result).toBe('string');
        expect(result).toMatch(/copilot-sdk[/\\]?$/);
    });

    it('probes four relative candidate directories when require.resolve fails', () => {
        const resolveFn = vi.fn().mockImplementation(() => { throw new Error('MODULE_NOT_FOUND'); });
        const existsFn = vi.fn().mockReturnValue(false);

        findSdkBinaryPath(existsFn, resolveFn);

        expect(existsFn).toHaveBeenCalledTimes(4);
    });

    it('all relative probe paths contain node_modules/@github/copilot-sdk/dist/index.js', () => {
        const resolveFn = vi.fn().mockImplementation(() => { throw new Error('not found'); });
        const probedPaths: string[] = [];
        findSdkBinaryPath((p) => {
            probedPaths.push(p);
            return false;
        }, resolveFn);

        expect(probedPaths).toHaveLength(4);
        for (const p of probedPaths) {
            expect(p).toContain('copilot-sdk');
            expect(p).toContain(path.join('dist', 'index.js'));
        }
    });

    it('handles require.resolve returning a non-dist path', () => {
        const sdkRoot = path.join('/mock', 'node_modules', '@github', 'copilot-sdk');
        const resolveFn = vi.fn().mockReturnValue(path.join(sdkRoot, 'index.js'));
        const existsFn = vi.fn().mockImplementation((p: string) => {
            return p === path.join(sdkRoot, 'dist', 'index.js');
        });

        const result = findSdkBinaryPath(existsFn, resolveFn);

        expect(result).toBe(sdkRoot);
    });

    it('returns undefined when require.resolve also fails', () => {
        const resolveFn = vi.fn().mockImplementation(() => { throw new Error('MODULE_NOT_FOUND'); });
        const result = findSdkBinaryPath(() => false, resolveFn);

        expect(result).toBeUndefined();
    });

    it('returns a string or undefined without throwing regardless of filesystem state', () => {
        expect(() => findSdkBinaryPath()).not.toThrow();
        const result = findSdkBinaryPath();
        expect(result === undefined || typeof result === 'string').toBe(true);
    });
});

// ---------------------------------------------------------------------------
// loadSdk — ESM dynamic import via injected importFn
// ---------------------------------------------------------------------------

describe('loadSdk', () => {
    it('returns a SdkModule when import by package name succeeds', async () => {
        const MockCopilotClient = class {};
        const importFn = vi.fn().mockResolvedValue({ CopilotClient: MockCopilotClient });

        const result = await loadSdk('/some/sdk', importFn);

        expect(result.CopilotClient).toBe(MockCopilotClient);
        // Called once with the package name (strategy 1 succeeded)
        expect(importFn).toHaveBeenCalledWith('@github/copilot-sdk');
    });

    it('falls back to file-path import when package-name import fails', async () => {
        const MockCopilotClient = class {};
        const importFn = vi.fn().mockImplementation((specifier: string) => {
            if (specifier === '@github/copilot-sdk') {
                return Promise.reject(new Error('MODULE_NOT_FOUND'));
            }
            return Promise.resolve({ CopilotClient: MockCopilotClient });
        });

        const result = await loadSdk('/some/sdk', importFn);

        expect(result.CopilotClient).toBe(MockCopilotClient);
        expect(importFn).toHaveBeenCalledTimes(2);
        expect(importFn.mock.calls[0][0]).toBe('@github/copilot-sdk');
        expect(importFn.mock.calls[1][0]).toMatch(/^file:/i);
    });

    it('falls back to file-path import when package-name import has no CopilotClient', async () => {
        const MockCopilotClient = class {};
        let callCount = 0;
        const importFn = vi.fn().mockImplementation((specifier: string) => {
            callCount++;
            if (callCount === 1) {
                return Promise.resolve({ someOtherExport: {} });
            }
            return Promise.resolve({ CopilotClient: MockCopilotClient });
        });

        const result = await loadSdk('/some/sdk', importFn);

        expect(result.CopilotClient).toBe(MockCopilotClient);
        expect(importFn).toHaveBeenCalledTimes(2);
    });

    it('throws when the loaded module does not export CopilotClient from either strategy', async () => {
        const importFn = vi.fn().mockResolvedValue({ someOtherExport: {} });

        await expect(loadSdk('/some/sdk', importFn)).rejects.toThrow(
            'CopilotClient not found in SDK module',
        );
    });

    it('file-path fallback passes a file:// URL built from sdkPath + dist/index.js', async () => {
        const MockCopilotClient = class {};
        const capturedSpecifiers: string[] = [];
        const importFn = vi.fn().mockImplementation((specifier: string) => {
            capturedSpecifiers.push(specifier);
            if (specifier === '@github/copilot-sdk') {
                return Promise.reject(new Error('not found'));
            }
            return Promise.resolve({ CopilotClient: MockCopilotClient });
        });

        const sdkPath = path.join('/fake', 'sdk');
        await loadSdk(sdkPath, importFn);

        expect(capturedSpecifiers).toHaveLength(2);
        expect(capturedSpecifiers[1]).toMatch(/^file:/i);
        expect(capturedSpecifiers[1]).toContain('dist');
        expect(capturedSpecifiers[1]).toContain('index.js');
    });

    it('propagates errors thrown by the file-path import', async () => {
        const importFn = vi.fn().mockRejectedValue(new Error('Cannot find module'));

        await expect(loadSdk('/bad/path', importFn)).rejects.toThrow('Cannot find module');
    });
});
