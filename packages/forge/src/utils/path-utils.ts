/**
 * Cross-platform path string utilities.
 *
 * Browser-safe — no Node.js dependencies. The implementation lives in
 * `@plusplusoneplusplus/coc-agent-sdk/platform/path-utils`; this module is a
 * compatibility entry point that forwards to the pure leaf export, never the
 * Node-only `platform` barrel, so browser bundles stay free of `child_process`
 * and `path`.
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
} from '@plusplusoneplusplus/coc-agent-sdk/platform/path-utils';
