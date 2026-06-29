/**
 * Map a path that resolves *inside* an Electron `app.asar` archive to the
 * `app.asar.unpacked` copy on disk, when that copy exists.
 *
 * Why this is needed: in a packaged desktop build, `require.resolve()` returns
 * paths inside `app.asar` (a single archive file). `fs.existsSync` succeeds on
 * those paths because Electron's fs shim transparently redirects reads — but
 * `child_process.spawn` does NOT go through that shim:
 *   - spawning a native binary at an `app.asar/...` path fails with `ENOTDIR`
 *     (the OS sees `app.asar` as a file, not a directory), and
 *   - handing such a path to the *system* `node` (which has no asar support at
 *     all) fails to load the module.
 * electron-builder unpacks the agent CLIs to `app.asar.unpacked`, so the real,
 * spawnable file lives there. This rewrites the path accordingly.
 *
 * It is a no-op when the path contains no `app.asar` segment (the normal CLI
 * install, where binaries are plain files), so it is safe to call
 * unconditionally from code shared by the CLI and the desktop app.
 */

import * as fs from 'fs';

export function preferUnpackedPath(
    p: string,
    existsSync: (filePath: string) => boolean = fs.existsSync,
): string {
    // Only rewrite a real `app.asar` *segment* (bounded by path separators),
    // never an unrelated substring like `app.asared`.
    const unpacked = p.replace(/([\\/])app\.asar([\\/])/g, '$1app.asar.unpacked$2');
    if (unpacked !== p) {
        try {
            if (existsSync(unpacked)) {
                return unpacked;
            }
        } catch {
            // Fall through to the original path on any fs error.
        }
    }
    return p;
}
