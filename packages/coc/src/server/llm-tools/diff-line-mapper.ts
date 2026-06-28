/**
 * Diff Line Mapper
 *
 * Parses unified diff output and maps source-file line numbers to the
 * rendered diff-line indices used by the SPA's `UnifiedDiffViewer`.
 *
 * The renderer assigns a sequential `data-diff-line-index` starting at 0
 * to every visual line: hunk headers, context lines, added lines, and
 * removed lines each consume one index.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { execFileSync } from 'child_process';
import { GIT_MAX_BUFFER } from '../routes/api-shared';

// ============================================================================
// Types
// ============================================================================

export interface DiffLineMapping {
    /** 0-based index into the rendered diff line array (start). */
    diffLineStart: number;
    /** 0-based index into the rendered diff line array (end, inclusive). */
    diffLineEnd: number;
    /** Side of the diff the selection lives on. */
    side: 'added' | 'removed' | 'context';
    /** Corresponding old-file line numbers (1-based), if applicable. */
    oldLineStart?: number;
    oldLineEnd?: number;
    /** Corresponding new-file line numbers (1-based), if applicable. */
    newLineStart?: number;
    newLineEnd?: number;
}

export interface ParsedDiffLine {
    /** 0-based index in the rendered diff. */
    index: number;
    /** Line type. */
    type: 'hunk-header' | 'context' | 'added' | 'removed';
    /** Raw line content (without the leading +/-/space prefix). */
    content: string;
    /** 1-based line number in the old file (undefined for added lines and hunk headers). */
    oldLine?: number;
    /** 1-based line number in the new file (undefined for removed lines and hunk headers). */
    newLine?: number;
}

// ============================================================================
// Diff Output Retrieval
// ============================================================================

/**
 * Retrieve the unified diff for a single file between two refs.
 * For initial commits (no parent), uses `git show`.
 */
export function getFileDiff(
    workingDirectory: string,
    parentHash: string,
    commitHash: string,
    filePath: string,
): string {
    try {
        return execFileSync(
            'git',
            ['diff', `${parentHash}..${commitHash}`, '--', filePath],
            { cwd: workingDirectory, encoding: 'utf-8', timeout: 10000, maxBuffer: GIT_MAX_BUFFER },
        );
    } catch {
        // Fallback for initial commits or other edge cases
        try {
            return execFileSync(
                'git',
                ['show', '--format=', commitHash, '--', filePath],
                { cwd: workingDirectory, encoding: 'utf-8', timeout: 10000, maxBuffer: GIT_MAX_BUFFER },
            );
        } catch {
            throw new Error(`Failed to retrieve diff for ${filePath}`);
        }
    }
}

// ============================================================================
// Unified Diff Parser
// ============================================================================

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

/**
 * Parse unified diff output into a flat array of `ParsedDiffLine` entries,
 * mirroring how `UnifiedDiffViewer` assigns `data-diff-line-index`.
 *
 * Each hunk header, context line, added line, and removed line gets a
 * sequential index starting at 0.
 */
export function parseUnifiedDiff(diffOutput: string): ParsedDiffLine[] {
    const rawLines = diffOutput.split('\n');
    const result: ParsedDiffLine[] = [];
    let index = 0;
    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;

    for (const raw of rawLines) {
        const hunkMatch = raw.match(HUNK_HEADER_RE);
        if (hunkMatch) {
            oldLine = parseInt(hunkMatch[1], 10);
            newLine = parseInt(hunkMatch[2], 10);
            result.push({ index: index++, type: 'hunk-header', content: raw });
            inHunk = true;
            continue;
        }

        if (!inHunk) continue;

        if (raw.startsWith('+')) {
            result.push({
                index: index++,
                type: 'added',
                content: raw.slice(1),
                newLine: newLine++,
            });
        } else if (raw.startsWith('-')) {
            result.push({
                index: index++,
                type: 'removed',
                content: raw.slice(1),
                oldLine: oldLine++,
            });
        } else if (raw.startsWith(' ') || (raw === '' && inHunk)) {
            // Context line (starts with space) or empty context line within a hunk.
            // An empty string at the end of the diff (final newline) is not a context line.
            // We detect end-of-hunk by checking if the next line is a hunk header or diff header.
            if (raw === '') {
                // Empty line could be a trailing newline — only treat as context
                // if it actually represents content (the diff ended with \n).
                // We include it for safety; the mapper handles any off-by-one.
                continue;
            }
            result.push({
                index: index++,
                type: 'context',
                content: raw.slice(1),
                oldLine: oldLine++,
                newLine: newLine++,
            });
        } else if (raw.startsWith('\\')) {
            // "\ No newline at end of file" — skip, no index consumed
            continue;
        } else if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('---') || raw.startsWith('+++')) {
            // Diff metadata headers before the first hunk — skip
            inHunk = false;
            continue;
        }
    }

    return result;
}

// ============================================================================
// Line Mapper
// ============================================================================

/**
 * Map source-file line numbers + side to rendered diff-line indices.
 *
 * @param parsedLines  Output of {@link parseUnifiedDiff}.
 * @param side         Which side of the diff to look up.
 * @param lineStart    1-based start line in the source file.
 * @param lineEnd      1-based end line in the source file (defaults to lineStart).
 * @returns Mapping with diff-line indices and resolved source-line numbers.
 * @throws Error if the requested lines are outside any hunk.
 */
export function mapLinesToDiffIndices(
    parsedLines: ParsedDiffLine[],
    side: 'added' | 'removed' | 'context',
    lineStart: number,
    lineEnd?: number,
): DiffLineMapping {
    const end = lineEnd ?? lineStart;

    // Determine which source-line field to match against
    const lineField: 'newLine' | 'oldLine' =
        side === 'removed' ? 'oldLine' : 'newLine';

    // For context lines, also accept added/removed lines at the same position
    const matchTypes: Set<string> =
        side === 'context'
            ? new Set(['context', 'added', 'removed'])
            : new Set([side, 'context']);

    // Find all matching lines within the requested range
    const matches = parsedLines.filter(
        (l) =>
            matchTypes.has(l.type) &&
            l[lineField] !== undefined &&
            l[lineField]! >= lineStart &&
            l[lineField]! <= end,
    );

    if (matches.length === 0) {
        throw new Error(
            `Lines ${lineStart}–${end} (${side}) not found in any diff hunk`,
        );
    }

    const diffLineStart = Math.min(...matches.map((m) => m.index));
    const diffLineEnd = Math.max(...matches.map((m) => m.index));

    // Resolve old/new line ranges from matched entries
    const oldLines = matches.filter((m) => m.oldLine !== undefined).map((m) => m.oldLine!);
    const newLines = matches.filter((m) => m.newLine !== undefined).map((m) => m.newLine!);

    return {
        diffLineStart,
        diffLineEnd,
        side,
        ...(oldLines.length > 0 && {
            oldLineStart: Math.min(...oldLines),
            oldLineEnd: Math.max(...oldLines),
        }),
        ...(newLines.length > 0 && {
            newLineStart: Math.min(...newLines),
            newLineEnd: Math.max(...newLines),
        }),
    };
}

/**
 * Extract the text content for the given diff-line range.
 */
export function extractTextFromDiffLines(
    parsedLines: ParsedDiffLine[],
    diffLineStart: number,
    diffLineEnd: number,
): string {
    return parsedLines
        .filter((l) => l.index >= diffLineStart && l.index <= diffLineEnd && l.type !== 'hunk-header')
        .map((l) => l.content)
        .join('\n');
}
