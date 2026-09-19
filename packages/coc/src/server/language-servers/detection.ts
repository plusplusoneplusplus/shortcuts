/**
 * Which built-in presets a workspace's files call for.
 *
 * Detection is language-neutral: every signal comes from the preset's own
 * `rootMarkers` and `filePatterns`, so a new preset is detected without
 * touching this file. It is cheap enough to run inline on a config read —
 * root markers are a handful of `existsSync` calls, and the extension scan
 * only runs for presets no marker claimed.
 *
 * Detection never checks whether the server binary is installed. A missing
 * binary surfaces through the existing start-failure path, which explains
 * itself far better than a silently undetected language would.
 */

import * as fs from 'fs';
import * as path from 'path';
import { matchesPattern } from './file-match';
import { builtInLanguageServerDefinitions } from './presets';
import type { LanguageServerDefinition } from './types';

/** Directories that never say anything about the languages a repo is written in. */
export const DETECTION_EXCLUDED_DIRECTORIES: readonly string[] = [
    'node_modules',
    '.git',
    'target',
    'dist',
    'build',
    '__pycache__',
    '.venv',
];

/** Directory levels below the workspace root the fallback scan descends. */
export const DETECTION_MAX_DEPTH = 3;

/** Upper bound on entries the fallback scan reads, so a huge repo cannot stall a read. */
export const DETECTION_MAX_ENTRIES = 5000;

export interface DetectLanguagesOptions {
    /** Presets to consider. Defaults to the built-ins that ship disabled. */
    definitions?: LanguageServerDefinition[];
    maxDepth?: number;
    maxEntries?: number;
}

/**
 * Presets that ship off and therefore have something to detect. `coc-symbols`
 * is already on by default, so detecting it would be a no-op.
 */
export function detectableLanguageServerDefinitions(): LanguageServerDefinition[] {
    return builtInLanguageServerDefinitions().filter((definition) => definition.enabled !== true);
}

/**
 * Ids of the presets this workspace appears to use, in preset order.
 *
 * A preset matches when one of its root markers sits at the workspace root, or
 * — for presets no marker claimed — when the bounded scan finds a file its
 * `filePatterns` match.
 */
export function detectWorkspaceLanguages(
    workspaceRoot: string,
    options: DetectLanguagesOptions = {},
): string[] {
    const definitions = options.definitions ?? detectableLanguageServerDefinitions();
    const matched = new Set<string>();
    const unmatched: LanguageServerDefinition[] = [];

    for (const definition of definitions) {
        if (hasRootMarker(workspaceRoot, definition)) {
            matched.add(definition.id);
        } else if ((definition.filePatterns ?? []).length > 0) {
            unmatched.push(definition);
        }
    }

    if (unmatched.length > 0) {
        scanForFilePatterns(workspaceRoot, unmatched, matched, {
            maxDepth: options.maxDepth ?? DETECTION_MAX_DEPTH,
            maxEntries: options.maxEntries ?? DETECTION_MAX_ENTRIES,
        });
    }

    return definitions.filter((definition) => matched.has(definition.id)).map((definition) => definition.id);
}

function hasRootMarker(workspaceRoot: string, definition: LanguageServerDefinition): boolean {
    for (const marker of definition.rootMarkers ?? []) {
        try {
            if (fs.existsSync(path.join(workspaceRoot, marker))) {
                return true;
            }
        } catch {
            // An unreadable root is simply not a match.
        }
    }
    return false;
}

/**
 * Breadth-first so shallow files — the ones most likely to identify the repo —
 * are seen before the entry budget runs out.
 */
function scanForFilePatterns(
    workspaceRoot: string,
    pending: LanguageServerDefinition[],
    matched: Set<string>,
    limits: { maxDepth: number; maxEntries: number },
): void {
    let remaining = pending;
    let budget = limits.maxEntries;
    let queue: Array<{ dir: string; relative: string; depth: number }> = [
        { dir: workspaceRoot, relative: '', depth: 0 },
    ];

    while (queue.length > 0 && remaining.length > 0 && budget > 0) {
        const next: typeof queue = [];
        for (const { dir, relative, depth } of queue) {
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (budget <= 0 || remaining.length === 0) {
                    return;
                }
                budget--;
                const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    if (depth + 1 <= limits.maxDepth && !DETECTION_EXCLUDED_DIRECTORIES.includes(entry.name)) {
                        next.push({ dir: path.join(dir, entry.name), relative: childRelative, depth: depth + 1 });
                    }
                    continue;
                }
                if (!entry.isFile()) {
                    continue;
                }
                remaining = remaining.filter((definition) => {
                    if (!definition.filePatterns.some((pattern) => matchesPattern(pattern, childRelative))) {
                        return true;
                    }
                    matched.add(definition.id);
                    return false;
                });
            }
        }
        queue = next;
    }
}
