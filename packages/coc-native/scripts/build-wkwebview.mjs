import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_ARCH = { 'aarch64-apple-darwin': 'arm64', 'x86_64-apple-darwin': 'x64' };

/** Name the resolver looks for. Must agree with `src/wkwebview.ts`. */
export function wkWebViewBinaryName(arch = process.arch) {
    return `coc-wkwebview.darwin-${arch}`;
}

export function supportsWkWebView(platform = process.platform, arch = process.arch) {
    return platform === 'darwin' && (arch === 'arm64' || arch === 'x64');
}

export function buildWkWebView({ profile = 'release', target = process.env.CARGO_BUILD_TARGET } = {}) {
    if (!supportsWkWebView() || (target && !TARGET_ARCH[target])) return;
    const args = ['build', '--manifest-path', path.join('rust', 'Cargo.toml'), '-p', 'coc-wkwebview'];
    if (profile === 'release') args.push('--release');
    if (target) args.push('--target', target);
    execFileSync('cargo', args, { cwd: packageRoot, stdio: 'inherit' });
    const source = path.join(packageRoot, 'rust', 'target', ...(target ? [target] : []), profile, 'coc-wkwebview');
    fs.copyFileSync(source, path.join(packageRoot, wkWebViewBinaryName(target ? TARGET_ARCH[target] : process.arch)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildWkWebView({ profile: process.env.COC_NATIVE_PROFILE === 'debug' ? 'debug' : 'release' });
}
