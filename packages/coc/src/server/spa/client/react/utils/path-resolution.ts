/**
 * Path resolution utilities for md-link click handling.
 *
 * Used by the App-level event handler to resolve relative file references
 * (e.g. `./other-file.md`, `../sibling.md`) against the currently viewed file.
 */

/** Check whether a path is absolute (Unix `/...` or Windows `C:/...` / `C:\...`). */
export function isAbsolutePath(p: string): boolean {
    if (p.startsWith('/')) return true;
    return /^[a-zA-Z]:[\\/]/.test(p);
}

/** Resolve a relative path (e.g. `./foo.md`, `../bar.md`) against a directory. */
export function resolveRelativePath(dir: string, rel: string): string {
    const parts = dir.split('/').concat(rel.split('/'));
    const resolved: string[] = [];
    for (const segment of parts) {
        if (segment === '.' || segment === '') continue;
        if (segment === '..') {
            resolved.pop();
        } else {
            resolved.push(segment);
        }
    }
    // Preserve leading slash for absolute Unix paths
    const prefix = dir.startsWith('/') ? '/' : '';
    return prefix + resolved.join('/');
}
