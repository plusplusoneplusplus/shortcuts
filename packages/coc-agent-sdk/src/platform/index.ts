/**
 * Node-only platform utilities shared across CoC packages.
 *
 * This barrel pulls in `child_process` and `path`, so it must not be imported
 * from browser code. Pure path-string helpers live in `./path-utils` and are
 * published separately as `@plusplusoneplusplus/coc-agent-sdk/platform/path-utils`
 * so browser bundles can reach them without dragging Node builtins along.
 */

export {
    toForwardSlashes,
    isWindowsDrivePath,
    isLinuxAbsolutePath,
    isWslUncPath,
    getWslUncRoot,
    parseWslUncPath,
    trimTrailingPathSeparators,
    windowsPathToWslPath,
    toNativePath,
    toWslUncPath,
} from './path-utils';

export { isWithinDirectory } from './path-security';

export { execAsync, execFileAsync } from './exec-utils';

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
} from './workspace-execution';
