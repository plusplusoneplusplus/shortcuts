import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

export function getNpmExecutable(platform = process.platform) {
    return platform === 'win32' ? 'npm.cmd' : 'npm';
}

/**
 * Built in order, and the order is a dependency order rather than a list.
 *
 * Each package resolves its workspace dependencies from their built `dist`, so
 * a package has to appear after everything in here that it imports — on a clean
 * checkout the earlier `dist` directories do not exist yet, and `tsc` fails with
 * TS2307 rather than with anything that names the ordering. `coc-native` leads
 * because `coc-agent-sdk` imports its git capability. `prebuild.test.ts` checks
 * the invariant against the real `package.json` files, so a new edge between
 * two of these fails there rather than in CI.
 */
export const REQUIRED_BUILD_WORKSPACES = [
    '@plusplusoneplusplus/coc-native',
    '@plusplusoneplusplus/coc-agent-sdk',
    '@plusplusoneplusplus/coc-workflow',
    '@plusplusoneplusplus/coc-memory',
];

export function buildRequiredWorkspacePackages({
    rootDir = repoRoot,
    run = execFileSync,
    npmExecutable = getNpmExecutable(),
} = {}) {
    for (const workspace of REQUIRED_BUILD_WORKSPACES) {
        run(npmExecutable, ['run', 'build', '-w', workspace], {
            cwd: rootDir,
            stdio: 'inherit',
            ...(npmExecutable.endsWith('.cmd') ? { shell: true } : {}),
        });
    }
}

export function runPrebuild() {
    buildRequiredWorkspacePackages();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runPrebuild();
}
