import * as fs from 'node:fs';
import * as path from 'node:path';
import { asarUnpackedPath } from './symbols-lsp';

export const WEBVIEW2_BINARY_NAME = 'coc-webview2.win32-x64-msvc.exe';

export function webview2BinaryCandidates(packageRoot = path.resolve(__dirname, '..')): string[] {
    const root = asarUnpackedPath(packageRoot);
    return [path.join(root, WEBVIEW2_BINARY_NAME), path.join(root, 'prebuilt', 'win32-x64-msvc', WEBVIEW2_BINARY_NAME)];
}

export function loadWebView2Binary(): string {
    if (process.platform !== 'win32' || process.arch !== 'x64') {
        throw new Error('WebView2 requires Windows x64.');
    }
    const candidates = process.env.COC_WEBVIEW2_PATH ? [process.env.COC_WEBVIEW2_PATH] : webview2BinaryCandidates();
    for (const candidate of candidates) {
        try { if (fs.statSync(candidate).isFile()) { return candidate; } }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
    }
    throw new Error('The native WebView2 host is missing. Reinstall CoC or build it with npm run build:native -w packages/coc-native.');
}
