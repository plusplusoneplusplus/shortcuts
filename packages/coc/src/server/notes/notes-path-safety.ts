/**
 * Cross-platform, symlink-aware path containment for non-default Notes roots.
 *
 * The managed default root intentionally keeps its broader legacy path contract.
 * Every external Notes collection uses this helper before filesystem access.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ResolvedSafeNotesPath {
    /** Lexical path used for the filesystem operation. */
    absolutePath: string;
    /** Normalized forward-slash path relative to the selected root. */
    relativePath: string;
}

export interface NotesPathSafetyError {
    error: string;
    statusCode: 403;
}

export type NotesPathSafetyResult = ResolvedSafeNotesPath | NotesPathSafetyError;

export function isNotesPathSafetyError(result: NotesPathSafetyResult): result is NotesPathSafetyError {
    return 'error' in result;
}

function comparisonPath(filePath: string): string {
    const normalized = path.normalize(filePath);
    return process.platform === 'win32'
        ? normalized.toLocaleLowerCase('en-US')
        : normalized;
}

function isSameOrWithinDirectory(candidate: string, root: string): boolean {
    const relative = path.relative(comparisonPath(root), comparisonPath(candidate));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR');
}

/**
 * Resolve symlinks in the existing prefix of a path while preserving missing
 * trailing components. A dangling symlink is rejected instead of being treated
 * as a normal missing component.
 */
async function canonicalizePotentialPath(filePath: string): Promise<string> {
    const missingSegments: string[] = [];
    let current = path.resolve(filePath);

    while (true) {
        try {
            const canonical = await fs.promises.realpath(current);
            return path.resolve(canonical, ...missingSegments.reverse());
        } catch (error) {
            if (!isMissingPathError(error)) {
                throw error;
            }

            try {
                const stat = await fs.promises.lstat(current);
                if (stat.isSymbolicLink()) {
                    throw new Error('Dangling symbolic links are not valid Notes paths.');
                }
            } catch (lstatError) {
                if (!isMissingPathError(lstatError)) {
                    throw lstatError;
                }
            }

            const parent = path.dirname(current);
            if (parent === current) {
                throw error;
            }
            missingSegments.push(path.basename(current));
            current = parent;
        }
    }
}

async function hasSymlinkBelowRoot(root: string, target: string): Promise<boolean> {
    const relative = path.relative(root, target);
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        try {
            if ((await fs.promises.lstat(current)).isSymbolicLink()) {
                return true;
            }
        } catch (error) {
            if (isMissingPathError(error)) {
                return false;
            }
            throw error;
        }
    }
    return false;
}

function normalizeRelativeNotesPath(requestedPath: string): string | NotesPathSafetyError {
    if (requestedPath.includes('\0')) {
        return { error: 'Access denied: path contains an invalid null byte', statusCode: 403 };
    }

    const slashPath = requestedPath.replace(/\\/g, '/');
    if (
        path.posix.isAbsolute(slashPath)
        || path.win32.isAbsolute(requestedPath)
        || /^[A-Za-z]:/.test(requestedPath)
    ) {
        return { error: 'Access denied: absolute paths are not allowed for this Notes collection', statusCode: 403 };
    }

    const segments = slashPath.split('/');
    if (segments.includes('..')) {
        return { error: 'Access denied: parent directory references are not allowed', statusCode: 403 };
    }

    return segments.filter(segment => segment !== '' && segment !== '.').join(path.sep);
}

/**
 * Resolve a client path under one selected non-default Notes root.
 *
 * Both slash styles are treated as separators on every platform. Existing
 * symlinks are resolved for the containment check, including symlinks in the
 * parent of a not-yet-created target.
 */
export async function resolveSafeNotesPath(
    notesRoot: string,
    requestedPath: string,
    options: { allowRoot?: boolean; rejectSymlinks?: boolean } = {},
): Promise<NotesPathSafetyResult> {
    const normalized = normalizeRelativeNotesPath(requestedPath);
    if (typeof normalized !== 'string') {
        return normalized;
    }
    if (!normalized && !options.allowRoot) {
        return { error: 'Access denied: path must identify an entry within the Notes collection', statusCode: 403 };
    }

    const lexicalRoot = path.resolve(notesRoot);
    const absolutePath = normalized ? path.resolve(lexicalRoot, normalized) : lexicalRoot;
    if (!isSameOrWithinDirectory(absolutePath, lexicalRoot)) {
        return { error: 'Access denied: path is outside the selected Notes collection', statusCode: 403 };
    }

    try {
        if (options.rejectSymlinks && await hasSymlinkBelowRoot(lexicalRoot, absolutePath)) {
            return { error: 'Access denied: symbolic links are not allowed in this managed Notes path', statusCode: 403 };
        }
        const [canonicalRoot, canonicalTarget] = await Promise.all([
            canonicalizePotentialPath(lexicalRoot),
            canonicalizePotentialPath(absolutePath),
        ]);
        if (!isSameOrWithinDirectory(canonicalTarget, canonicalRoot)) {
            return { error: 'Access denied: path escapes the selected Notes collection through a symbolic link', statusCode: 403 };
        }
    } catch {
        return { error: 'Access denied: path could not be safely resolved within the selected Notes collection', statusCode: 403 };
    }

    return {
        absolutePath,
        relativePath: path.relative(lexicalRoot, absolutePath).split(path.sep).join('/'),
    };
}
