import { existsSync, readdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';

/** On-disk Electron profile cookies, for persistence diagnostics. */
export function diskCookies(directory: string) {
    const profile = path.join(directory, 'coc', 'browser', 'electron');
    if (!existsSync(profile)) return null;
    const files = readdirSync(profile, { recursive: true, encoding: 'utf8' }).filter(file =>
        path.basename(file).toLowerCase() === 'cookies' && statSync(path.join(profile, file)).isFile());
    return files.map(file => {
        const full = path.join(profile, file);
        let rows: unknown;
        let db: DatabaseSync | undefined;
        try {
            db = new DatabaseSync(full, { readOnly: true });
            rows = db.prepare('select host_key, name, length(value) as plain, length(encrypted_value) as encrypted, is_persistent from cookies').all();
        } catch (error) { rows = String(error); }
        finally { db?.close(); }
        return { file, size: statSync(full).size, rows };
    });
}
