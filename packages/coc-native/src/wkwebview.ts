import * as fs from 'node:fs';
import * as path from 'node:path';
import { asarUnpackedPath } from './symbols-lsp';

export function wkWebViewBinaryName(arch: string = process.arch): string {
    return `coc-wkwebview.darwin-${arch}`;
}

export function wkWebViewBinaryCandidates(packageRoot = path.resolve(__dirname, '..'), arch: string = process.arch): string[] {
    const root = asarUnpackedPath(packageRoot);
    const name = wkWebViewBinaryName(arch);
    return [path.join(root, name), path.join(root, 'prebuilt', `darwin-${arch}`, name)];
}

export function loadWkWebViewBinary(): string {
    if (process.platform !== 'darwin' || (process.arch !== 'arm64' && process.arch !== 'x64')) {
        throw new Error('WKWebView requires macOS on arm64 or x64.');
    }
    const candidates = process.env.COC_WKWEBVIEW_PATH ? [process.env.COC_WKWEBVIEW_PATH] : wkWebViewBinaryCandidates();
    for (const candidate of candidates) {
        try { if (fs.statSync(candidate).isFile()) { return candidate; } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
    }
    throw new Error('The native WKWebView host is missing. Reinstall CoC or build it with npm run build:native -w packages/coc-native.');
}
