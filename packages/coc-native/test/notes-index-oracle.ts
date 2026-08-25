/**
 * Test-only reference for the production Notes scanner being replaced.
 * Production modules must never import this file.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { NativeNotesSearchResponse } from '../src/notes-index';

const MAX_FILES = 50;
const MAX_MATCHES = 100;

/**
 * Directory order from `fs.readdirSync` is not portable: on Unix libuv sorts
 * the scandir result byte-wise, while on Windows the entries arrive in NTFS
 * index order, which is case-insensitive — `bytes.md` before `Needle.md`,
 * the opposite of the byte order the native walk defines. Walking in the same
 * byte order here keeps parity a statement about search semantics instead of
 * about the host filesystem.
 */
function byFilenameBytes(left: fs.Dirent, right: fs.Dirent): number {
    return Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8'));
}

/** Reproduce the existing recursive scanner for native parity tests only. */
export function searchNotesOracle(
    root: string,
    query: string,
    skipSymlinks = false,
): NativeNotesSearchResponse {
    const results: NativeNotesSearchResponse['results'] = [];
    const totalMatches = { count: 0 };

    function visit(directory: string, relativeDirectory: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort(byFilenameBytes);

        const lowerQuery = query.toLowerCase();
        for (const entry of entries) {
            if (results.length >= MAX_FILES || totalMatches.count >= MAX_MATCHES) return;
            if (skipSymlinks && entry.isSymbolicLink()) continue;

            const relative = relativeDirectory
                ? `${relativeDirectory}/${entry.name}`
                : entry.name;
            if (entry.isDirectory()) {
                visit(path.join(directory, entry.name), relative);
            } else if (entry.name.endsWith('.md')) {
                const matches: NativeNotesSearchResponse['results'][number]['matches'] = [];
                if (entry.name.toLowerCase().includes(lowerQuery)) {
                    matches.push({ line: 0, text: entry.name });
                    totalMatches.count++;
                }

                if (totalMatches.count < MAX_MATCHES) {
                    try {
                        const lines = fs.readFileSync(path.join(directory, entry.name), 'utf8').split('\n');
                        for (let index = 0; index < lines.length; index++) {
                            if (totalMatches.count >= MAX_MATCHES) break;
                            if (lines[index].toLowerCase().includes(lowerQuery)) {
                                matches.push({ line: index + 1, text: lines[index] });
                                totalMatches.count++;
                            }
                        }
                    } catch {
                        // The current scanner keeps any filename match and skips content.
                    }
                }

                if (matches.length > 0) results.push({ path: relative, matches });
            }
        }
    }

    visit(root, '');
    return {
        results,
        truncated: results.length >= MAX_FILES || totalMatches.count >= MAX_MATCHES,
    };
}
