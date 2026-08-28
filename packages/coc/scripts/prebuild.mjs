import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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
    '@plusplusoneplusplus/forge',
    '@plusplusoneplusplus/coc-client',
    '@plusplusoneplusplus/coc-connector',
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

export function resolveBuildCommit({
    rootDir = repoRoot,
    run = execFileSync,
    env = process.env,
} = {}) {
    // Builds without a .git directory (the Docker image build context excludes
    // it) pass the commit in explicitly.
    const fromEnv = env.COC_BUILD_COMMIT?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    try {
        return run('git', ['rev-parse', 'HEAD'], {
            cwd: rootDir,
            encoding: 'utf8',
        }).trim();
    } catch {
        return 'unknown';
    }
}

export function writeBuildInfo({
    rootDir = repoRoot,
    cocPackageRoot = packageRoot,
    run = execFileSync,
    env = process.env,
} = {}) {
    // The product version is the workspace root version — that is what the
    // release bumps (in lockstep with coc-desktop). The coc package's own
    // version is not published and drifts, so it must not be reported.
    const packageJsonPath = path.join(rootDir, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const commit = resolveBuildCommit({ rootDir, run, env });
    const outputPath = path.join(cocPackageRoot, 'src', 'server', 'core', 'build-info.ts');

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
        outputPath,
        `// Auto-generated at build time. Do not edit manually.\n` +
            `export const BUILD_COMMIT = ${JSON.stringify(commit)};\n` +
            `export const BUILD_VERSION = ${JSON.stringify(packageJson.version)};\n`,
    );
}

export function runPrebuild() {
    buildRequiredWorkspacePackages();
    writeBuildInfo();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runPrebuild();
}
