import * as fs from 'fs';
import * as path from 'path';
import {
    bestMatchingPattern,
    fileExtension,
    matchesPattern,
    normalizeRelativePath,
    patternSpecificity,
} from './file-match';
import type { LanguageServerDefinition } from './types';

/**
 * Pick the one semantic server for a document.
 *
 * Ties are broken deterministically so the same file always resolves to the
 * same server: highest priority, then the most specific matching pattern, then
 * the lexicographically smallest id.
 */
export function selectDefinitionForFile(
    definitions: LanguageServerDefinition[],
    relativePath: string,
): LanguageServerDefinition | undefined {
    let best: { definition: LanguageServerDefinition; pattern: string } | undefined;
    for (const definition of definitions) {
        if (definition.enabled === false) {
            continue;
        }
        const pattern = bestMatchingPattern(definition.filePatterns, relativePath);
        if (pattern === undefined) {
            continue;
        }
        if (best === undefined || comparePreference({ definition, pattern }, best) < 0) {
            best = { definition, pattern };
        }
    }
    return best?.definition;
}

/** Negative when `a` should win over `b`. */
function comparePreference(
    a: { definition: LanguageServerDefinition; pattern: string },
    b: { definition: LanguageServerDefinition; pattern: string },
): number {
    const priority = (b.definition.priority ?? 0) - (a.definition.priority ?? 0);
    if (priority !== 0) {
        return priority;
    }
    const literals = patternSpecificity(b.pattern) - patternSpecificity(a.pattern);
    if (literals !== 0) {
        return literals;
    }
    return a.definition.id < b.definition.id ? -1 : a.definition.id > b.definition.id ? 1 : 0;
}

/**
 * LSP language id for a document, from the definition's extension map with the
 * first declared language id as the fallback.
 */
export function resolveLanguageId(definition: LanguageServerDefinition, relativePath: string): string {
    return definition.extensionLanguageIds?.[fileExtension(relativePath)] ?? definition.languageIds[0];
}

/** True when the definition claims the file, ignoring the enabled flag. */
export function definitionMatchesFile(definition: LanguageServerDefinition, relativePath: string): boolean {
    return definition.filePatterns.some((pattern) => matchesPattern(pattern, relativePath));
}

/**
 * Nearest ancestor directory of the file that holds a root marker, bounded by
 * the workspace root. Falls back to the workspace root when nothing matches.
 *
 * `exists` is injectable so tests do not need a real tree.
 */
export function resolveServerRoot(
    definition: LanguageServerDefinition,
    workspaceRoot: string,
    relativePath: string,
    exists: (candidate: string) => boolean = fs.existsSync,
): string {
    const root = path.resolve(workspaceRoot);
    let dir = path.dirname(path.resolve(root, normalizeRelativePath(relativePath)));
    while (dir === root || dir.startsWith(`${root}${path.sep}`)) {
        for (const marker of definition.rootMarkers) {
            if (exists(path.join(dir, marker))) {
                return dir;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return root;
}
