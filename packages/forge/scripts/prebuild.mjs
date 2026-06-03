import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

export function getNpmExecutable(platform = process.platform) {
    return platform === 'win32' ? 'npm.cmd' : 'npm';
}

export const REQUIRED_BUILD_WORKSPACES = [
    '@plusplusoneplusplus/coc-agent-sdk',
    '@plusplusoneplusplus/coc-workflow',
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
