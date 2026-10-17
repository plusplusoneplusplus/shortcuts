import * as fs from 'fs';
import * as path from 'path';
import { isInsideRoot } from './uri-mapping';
import { normalizeRelativePath } from './file-match';

/** Directory spelling, without coalescing symlinks or hard links. */
export function resolveFileIdentity(root: string, relative: string): string {
    const components = normalizeRelativePath(relative).split('/');
    if (!relative || /^[\\/]/.test(relative) || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)
        || components.some(part => !part || part === '..' || part === '.' || part.includes('\0'))) {
        throw new Error('Invalid workspace file path.');
    }
    const canonicalRoot = fs.realpathSync.native(root);
    let parent = path.resolve(root);
    const spelling: string[] = [];
    for (const component of components) {
        const requested = path.join(parent, component);
        const info = fs.lstatSync(requested, { bigint: true });
        const entries = fs.readdirSync(parent);
        let name = entries.find(entry => entry === component);
        if (!name) {
            // A lexical resemblance is only a candidate. The owning filesystem
            // must prove that the requested spelling actually opens this entry.
            const fold = (value: string) => value.replace(/[ .]+$/g, '').toUpperCase().toLowerCase().normalize('NFC');
            const matches = entries.filter(entry => {
                if (fold(entry) !== fold(component)) return false;
                const candidate = fs.lstatSync(path.join(parent, entry), { bigint: true });
                return info.ino !== 0n && candidate.ino === info.ino && candidate.dev === info.dev;
            });
            if (matches.length !== 1) throw new Error('File identity is ambiguous. Retry opening the file.');
            name = matches[0];
        }
        spelling.push(name);
        parent = path.join(parent, name);
        const canonical = fs.realpathSync.native(parent);
        const boundary = canonicalRoot.replace(/[\\/]+$/g, '') + path.sep;
        if (!isInsideRoot(canonicalRoot, canonical)
            || (canonical !== canonicalRoot && !canonical.startsWith(boundary))) {
            throw new Error('File identity escapes the workspace.');
        }
    }
    if (!fs.statSync(parent).isFile()) throw new Error('File identity requires a regular file.');
    return spelling.join('/');
}
