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
 * Return every enabled server that claims a document, in deterministic
 * preference order: highest priority, then the most specific matching pattern,
 * then the lexicographically smallest id.
 */
export function selectDefinitionsForFile(
    definitions: LanguageServerDefinition[],
    relativePath: string,
): LanguageServerDefinition[] {
    return definitions
        .filter((definition) => definition.enabled !== false)
        .map((definition) => ({
            definition,
            pattern: bestMatchingPattern(definition.filePatterns, relativePath),
        }))
        .filter((entry): entry is { definition: LanguageServerDefinition; pattern: string } =>
            entry.pattern !== undefined)
        .sort(comparePreference)
        .map((entry) => entry.definition);
}

/**
 * Every enabled server, in the same preference order, for a query that names no
 * document at all — the Go To All palette asking a workspace-wide question.
 *
 * Selection is by definition rather than by file pattern deliberately: a
 * workspace symbol query is not about one file, and attaching a sentinel path
 * just to satisfy pattern matching would pick servers by a lie.
 */
export function selectDefinitionsForWorkspace(
    definitions: LanguageServerDefinition[],
): LanguageServerDefinition[] {
    return definitions
        .filter((definition) => definition.enabled !== false)
        .map((definition) => ({ definition, pattern: '' }))
        .sort(comparePreference)
        .map((entry) => entry.definition);
}

/** Preferred server for call sites that intentionally consume one definition. */
export function selectDefinitionForFile(
    definitions: LanguageServerDefinition[],
    relativePath: string,
): LanguageServerDefinition | undefined {
    return selectDefinitionsForFile(definitions, relativePath)[0];
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
