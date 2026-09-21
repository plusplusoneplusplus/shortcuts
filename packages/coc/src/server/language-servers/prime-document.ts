/**
 * The document a session opens on its own behalf so a project-scoped server
 * has something loaded when the editor has nothing open.
 *
 * `tsserver` answers `workspace/symbol` from the project containing the first
 * open file, and answers nothing at all when no file is open. Go To All
 * attaches a workspace without opening any document, so without a priming
 * document the palette gets an empty answer and reports "No symbols found".
 *
 * One representative source file from the project root is enough: opening it
 * loads its project, and queued queries wait for that load rather than racing
 * it. The session closes the priming document again the moment the editor
 * opens a real one, so the user's own file — never this one — decides which
 * project answers.
 *
 * The search is deliberately bounded and deterministic: entries are visited
 * breadth-first and in name order, so the same project always primes with the
 * same file on every platform.
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { DETECTION_EXCLUDED_DIRECTORIES } from './detection';
import { definitionMatchesFile, resolveLanguageId } from './selection';
import type { LanguageServerDefinition, LanguageServerPrimeDocument } from './types';

/** Directory levels below the project root the search descends. */
export const PRIME_MAX_DEPTH = 6;
/** Upper bound on directory entries read, so a huge project cannot stall a query. */
export const PRIME_MAX_ENTRIES = 20_000;
/** Largest file used as a prime. A smaller one loads the same project sooner. */
export const PRIME_MAX_BYTES = 512 * 1024;

export interface PrimeDocumentLimits {
    maxDepth?: number;
    maxEntries?: number;
    maxBytes?: number;
}

/**
 * First file under `rootPath` the definition claims, as a `didOpen` payload.
 *
 * Returns undefined when the project holds no file the definition matches, or
 * when every match is unreadable — a session that cannot prime simply behaves
 * as it did before.
 */
export function resolvePrimeDocument(
    definition: LanguageServerDefinition,
    rootPath: string,
    limits: PrimeDocumentLimits = {},
): LanguageServerPrimeDocument | undefined {
    const maxDepth = limits.maxDepth ?? PRIME_MAX_DEPTH;
    const maxEntries = limits.maxEntries ?? PRIME_MAX_ENTRIES;
    const maxBytes = limits.maxBytes ?? PRIME_MAX_BYTES;
    const root = path.resolve(rootPath);
    let budget = maxEntries;
    let queue: { dir: string; relative: string; depth: number }[] = [{ dir: root, relative: '', depth: 0 }];

    while (queue.length > 0 && budget > 0) {
        const next: typeof queue = [];
        for (const { dir, relative, depth } of queue) {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
            for (const entry of entries) {
                if (budget <= 0) {
                    return undefined;
                }
                budget--;
                const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (depth + 1 <= maxDepth && !DETECTION_EXCLUDED_DIRECTORIES.includes(entry.name)) {
                        next.push({ dir: path.join(dir, entry.name), relative: childRelative, depth: depth + 1 });
                    }
                    continue;
                }
                if (!entry.isFile() || !definitionMatchesFile(definition, childRelative)) {
                    continue;
                }
                const document = readPrimeDocument(definition, path.join(dir, entry.name), childRelative, maxBytes);
                if (document) {
                    return document;
                }
            }
        }
        queue = next;
    }
    return undefined;
}

function readPrimeDocument(
    definition: LanguageServerDefinition,
    absolutePath: string,
    relativePath: string,
    maxBytes: number,
): LanguageServerPrimeDocument | undefined {
    try {
        if (fs.statSync(absolutePath).size > maxBytes) {
            return undefined;
        }
        return {
            uri: pathToFileURL(absolutePath).href,
            languageId: resolveLanguageId(definition, relativePath),
            text: fs.readFileSync(absolutePath, 'utf8'),
        };
    } catch {
        // An unreadable candidate is not a prime; the search moves on.
        return undefined;
    }
}
