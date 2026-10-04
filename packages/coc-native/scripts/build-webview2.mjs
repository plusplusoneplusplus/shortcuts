import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEBVIEW2_BINARY_NAME = 'coc-webview2.win32-x64-msvc.exe';

export function supportsWebView2(platform = process.platform, arch = process.arch) {
    return platform === 'win32' && arch === 'x64';
}

export function buildWebView2({ profile = 'release', target = process.env.CARGO_BUILD_TARGET } = {}) {
    if (!supportsWebView2() || (target && target !== 'x86_64-pc-windows-msvc')) return;
    const args = ['build', '--manifest-path', path.join('rust', 'Cargo.toml'), '-p', 'coc-webview2'];
    if (profile === 'release') args.push('--release');
    if (target) args.push('--target', target);
    execFileSync('cargo', args, { cwd: packageRoot, stdio: 'inherit' });
    const source = path.join(packageRoot, 'rust', 'target', ...(target ? [target] : []), profile, 'coc-webview2.exe');
    fs.copyFileSync(source, path.join(packageRoot, WEBVIEW2_BINARY_NAME));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    buildWebView2({ profile: process.env.COC_NATIVE_PROFILE === 'debug' ? 'debug' : 'release' });
}
