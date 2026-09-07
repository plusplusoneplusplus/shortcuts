/**
 * Regression coverage for the de-vendored platform utilities.
 *
 * The four utility modules under `src/utils` are compatibility entry points over
 * `@plusplusoneplusplus/coc-agent-sdk/platform`. These tests pin the surface
 * forge still has to publish, and pin that forge and the SDK reach the *same*
 * module instance — the WSL distro cache is process-global state that
 * `warmWslDistroCache` on one side must be observable from the other.
 */
import { describe, it, expect } from 'vitest';

import * as forgeWorkspaceExecution from '../../src/utils/workspace-execution';
import * as forgePathUtils from '../../src/utils/path-utils';
import * as forgePathSecurity from '../../src/utils/path-security';
import * as forgeExecUtils from '../../src/utils/exec-utils';
import * as forgeUtils from '../../src/utils';
import * as forgeRoot from '../../src/index';

import * as sdkPlatform from '@plusplusoneplusplus/coc-agent-sdk/platform';
import * as sdkPathUtils from '@plusplusoneplusplus/coc-agent-sdk/platform/path-utils';
import { warmSdkWslDistroCache } from '@plusplusoneplusplus/coc-agent-sdk';

const WORKSPACE_EXECUTION_EXPORTS = [
    'getWslExecutablePath',
    'clearWorkspaceExecutionCaches',
    'getDefaultWslDistro',
    'getDefaultWslDistroAsync',
    'warmWslDistroCache',
    'resolveWorkspaceExecutionContext',
    'resolveWorkspaceExecutionContextAsync',
    'translatePathForExecution',
    'translatePathForHostFilesystem',
    'translatePathForHostFilesystemAsync',
    'resolvePathInExecutionContext',
    'resolvePathForHostFilesystem',
    'resolvePathForHostFilesystemAsync',
    'buildWslCommandArgs',
    'normalizeWslExecutionPath',
    'normalizeExecutionPath',
    'normalizeExecutionPathAsync',
    'isWslExecutionContext',
    'isWslPath',
] as const;

const PATH_UTILS_EXPORTS = [
    'toForwardSlashes',
    'isWindowsDrivePath',
    'isLinuxAbsolutePath',
    'isWslUncPath',
    'getWslUncRoot',
    'parseWslUncPath',
    'trimTrailingPathSeparators',
    'windowsPathToWslPath',
    'toNativePath',
    'toWslUncPath',
] as const;

describe('forge platform compatibility entry points', () => {
    it('keeps the workspace-execution surface and forwards to the SDK module', () => {
        for (const name of WORKSPACE_EXECUTION_EXPORTS) {
            expect(typeof (forgeWorkspaceExecution as never)[name]).toBe('function');
            expect((forgeWorkspaceExecution as never)[name]).toBe((sdkPlatform as never)[name]);
        }
    });

    it('keeps the path-utils surface and forwards to the pure SDK leaf', () => {
        for (const name of PATH_UTILS_EXPORTS) {
            expect(typeof (forgePathUtils as never)[name]).toBe('function');
            expect((forgePathUtils as never)[name]).toBe((sdkPathUtils as never)[name]);
        }
    });

    it('keeps isWithinDirectory and the exec helpers', () => {
        expect(forgePathSecurity.isWithinDirectory).toBe(sdkPlatform.isWithinDirectory);
        expect(forgeExecUtils.execAsync).toBe(sdkPlatform.execAsync);
        expect(forgeExecUtils.execFileAsync).toBe(sdkPlatform.execFileAsync);
    });

    it('keeps the utils barrel and root re-exports pointing at the same functions', () => {
        expect(forgeUtils.toForwardSlashes).toBe(sdkPathUtils.toForwardSlashes);
        expect(forgeUtils.toNativePath).toBe(sdkPathUtils.toNativePath);
        expect(forgeUtils.toWslUncPath).toBe(sdkPathUtils.toWslUncPath);
        expect(forgeUtils.getWslUncRoot).toBe(sdkPathUtils.getWslUncRoot);
        expect(forgeUtils.isWithinDirectory).toBe(sdkPlatform.isWithinDirectory);
        expect(forgeUtils.execAsync).toBe(sdkPlatform.execAsync);
        expect(forgeUtils.warmWslDistroCache).toBe(sdkPlatform.warmWslDistroCache);
        expect(forgeRoot.resolveWorkspaceExecutionContext).toBe(sdkPlatform.resolveWorkspaceExecutionContext);
    });

    it('shares one WSL distro cache between forge and the SDK warming alias', () => {
        // The server warms both aliases at startup; they must not be two caches.
        expect(warmSdkWslDistroCache).toBe(forgeWorkspaceExecution.warmWslDistroCache);
        expect(() => forgeWorkspaceExecution.clearWorkspaceExecutionCaches()).not.toThrow();
    });

    it('still resolves an execution context after a shared cache reset', async () => {
        forgeWorkspaceExecution.clearWorkspaceExecutionCaches();
        await warmSdkWslDistroCache();
        await forgeWorkspaceExecution.warmWslDistroCache();
        const context = forgeWorkspaceExecution.resolveWorkspaceExecutionContext(process.cwd());
        expect(['windows', 'wsl']).toContain(context.kind);
        forgeWorkspaceExecution.clearWorkspaceExecutionCaches();
    });
});
