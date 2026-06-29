/**
 * Icon-path resolution for the CoC desktop app.
 *
 * Kept electron-free so the logic is unit-testable without an Electron runtime.
 * The caller is responsible for loading the resolved path via nativeImage.
 */

import * as path from 'path';

/**
 * Candidate search order (first existing path wins):
 *
 *  1. Packaged    — bundled via electron-builder `extraResources` to
 *     `<resourcesDir>/coc-icon.png` (i.e. `process.resourcesPath`). This is the
 *     ONLY copy present in a production `.app`/installer: `media/` lives at the
 *     repo root, outside the app's file glob. Without it the dock icon falls
 *     back to a placeholder glyph.
 *  2. dev layout  — main.js lives in `packages/coc-desktop/dist/`, icon is 3
 *     directories up at the repo root under `media/`.
 *  3. Alternate   — one directory up (e.g. a flat staging layout).
 *  4. Same-dir    — icon was copied next to main.js at pack time.
 */
const ICON_CANDIDATES = (fromDir: string, resourcesDir?: string): string[] => [
    ...(resourcesDir ? [path.join(resourcesDir, 'coc-icon.png')] : []), // packaged (extraResources)
    path.join(fromDir, '..', '..', '..', 'media', 'coc-icon.png'),      // dev
    path.join(fromDir, '..', 'media', 'coc-icon.png'),                  // alternate
    path.join(fromDir, 'media', 'coc-icon.png'),                        // same-dir
];

/**
 * Returns the absolute path to `coc-icon.png`, or `null` if none of the
 * candidate locations contain the file.
 *
 * @param fromDir      The directory to search from (normally `__dirname` in main.ts).
 * @param resourcesDir Electron's `process.resourcesPath` in packaged builds; the
 *                     bundled icon lives directly under it. Omit in dev/tests.
 * @param existsFn     Injectable file-existence check — defaults to `fs.existsSync`
 *                     so callers can substitute a mock in unit tests.
 */
export function resolveIconPath(
    fromDir: string,
    resourcesDir?: string,
    existsFn: (p: string) => boolean = require('fs').existsSync,
): string | null {
    for (const candidate of ICON_CANDIDATES(fromDir, resourcesDir)) {
        if (existsFn(candidate)) {
            return candidate;
        }
    }
    return null;
}
