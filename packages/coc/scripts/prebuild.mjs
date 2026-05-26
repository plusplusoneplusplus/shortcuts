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

export function buildCocMemory({
    rootDir = repoRoot,
    run = execFileSync,
    npmExecutable = getNpmExecutable(),
} = {}) {
    run(npmExecutable, ['run', 'build', '-w', '@plusplusoneplusplus/coc-memory'], {
        cwd: rootDir,
        stdio: 'inherit',
    });
}

export function resolveBuildCommit({
    rootDir = repoRoot,
    run = execFileSync,
} = {}) {
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
} = {}) {
    const packageJsonPath = path.join(cocPackageRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const commit = resolveBuildCommit({ rootDir, run });
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
    buildCocMemory();
    writeBuildInfo();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runPrebuild();
}
