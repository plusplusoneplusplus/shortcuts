/**
 * Workspace execution helpers for routing operations to either the native host
 * environment or WSL.
 *
 * Compatibility entry point; the implementation lives in
 * `@plusplusoneplusplus/coc-agent-sdk/platform`. Forge and the SDK therefore
 * share one module instance — and one WSL distro cache — so
 * `warmWslDistroCache` / `clearWorkspaceExecutionCaches` reached through either
 * package affect the same state.
 */

export {
    WindowsExecutionContext,
    WslExecutionContext,
    WorkspaceExecutionContext,
    getWslExecutablePath,
    clearWorkspaceExecutionCaches,
    getDefaultWslDistro,
    getDefaultWslDistroAsync,
    warmWslDistroCache,
    resolveWorkspaceExecutionContext,
    resolveWorkspaceExecutionContextAsync,
    translatePathForExecution,
    translatePathForHostFilesystem,
    translatePathForHostFilesystemAsync,
    resolvePathInExecutionContext,
    resolvePathForHostFilesystem,
    resolvePathForHostFilesystemAsync,
    buildWslCommandArgs,
    normalizeWslExecutionPath,
    normalizeExecutionPath,
    normalizeExecutionPathAsync,
    isWslExecutionContext,
    isWslPath,
} from '@plusplusoneplusplus/coc-agent-sdk/platform';
